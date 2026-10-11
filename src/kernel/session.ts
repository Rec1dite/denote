import * as crypto from "crypto";
import * as vscode from "vscode";
import { Dealer, Subscriber } from "zeromq";
import { AsyncQueue } from "./queue";
import {
  IConnectionFile,
  IExecuteInputContent,
  IExecuteReplyContent,
  IKernelMessage,
  IStatusContent,
  createHeader,
  decodeMessage,
  encodeMessage,
} from "./protocol";

export interface IExecuteResult {
  status: "ok" | "error" | "abort";
  executionCount: number;
}

const EXECUTE_TIMEOUT = 10 * 60 * 1000;
const CONTROL_TIMEOUT = 15 * 1000;
// Grace period to keep draining iopub after `status: idle` (the Deno kernel can flush stdout late).
const TRAILING_OUTPUT_QUIET_MS = 250;

type SocketChannel = "shell" | "control";

// Jupyter client session: one shell + iopub + control ZMQ channel set to a single kernel.
// Single reader per socket, HMAC wire protocol, event-driven completion (status idle).
export class JupyterSession implements vscode.Disposable {
  private readonly session = crypto.randomUUID();
  private shell?: Dealer;
  private iopub?: Subscriber;
  private control?: Dealer;

  private readonly shellQueue = new AsyncQueue<IKernelMessage>();
  private readonly iopubQueue = new AsyncQueue<IKernelMessage>();
  private readonly controlQueue = new AsyncQueue<IKernelMessage>();

  private readonly busyEmitter = new vscode.EventEmitter<boolean>();
  readonly onDidChangeBusy = this.busyEmitter.event;
  private busy = false;

  private closed = false;
  private executionChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly connection: IConnectionFile,
    private readonly log: (...args: unknown[]) => void,
  ) {}

  private address(port: number): string {
    const delimiter = this.connection.transport === "tcp" ? ":" : "-";
    return `${this.connection.transport}://${this.connection.ip}${delimiter}${port}`;
  }

  async start(): Promise<void> {
    const { connection } = this;
    this.shell = new Dealer({ sendHighWaterMark: 0, receiveHighWaterMark: 0 });
    this.iopub = new Subscriber({ receiveHighWaterMark: 0 });
    this.control = new Dealer({ sendHighWaterMark: 0, receiveHighWaterMark: 0 });

    this.shell.connect(this.address(connection.shell_port));
    this.iopub.connect(this.address(connection.iopub_port));
    this.control.connect(this.address(connection.control_port));
    this.iopub.subscribe();

    this.readLoop(this.shell, this.shellQueue, "shell");
    this.readLoop(this.iopub, this.iopubQueue, "iopub");
    this.readLoop(this.control, this.controlQueue, "control");

    await this.waitForReady();
  }

  private async readLoop(
    socket: Dealer | Subscriber,
    queue: AsyncQueue<IKernelMessage>,
    channel: "shell" | "iopub" | "control",
  ) {
    try {
      for await (const frames of socket) {
        if (this.closed) break;
        const parts = (Array.isArray(frames) ? frames : [frames]) as Buffer[];
        const message = decodeMessage(parts);
        message.channel = channel;
        if (channel === "iopub") this.trackBusy(message);
        queue.push(message);
      }
    } catch (err) {
      if (!this.closed) this.log(`socket read error on ${channel}`, err);
    }
  }

  private trackBusy(message: IKernelMessage) {
    if (message.header.msg_type !== "status") return;
    const busy = (message.content as IStatusContent).execution_state === "busy";
    if (busy !== this.busy) {
      this.busy = busy;
      this.busyEmitter.fire(busy);
    }
  }

  private send(channel: SocketChannel, msgType: string, content: Record<string, unknown>): IKernelMessage {
    const message: IKernelMessage = {
      header: createHeader(msgType, this.session),
      parent_header: {},
      metadata: {},
      content,
    };
    const socket = channel === "shell" ? this.shell : this.control;
    socket?.send(encodeMessage(message, this.connection.key)).catch((err) => {
      this.log(`failed to send ${msgType} on ${channel}`, err);
    });
    return message;
  }

  private async awaitReply(
    queue: AsyncQueue<IKernelMessage>,
    parentId: string,
    msgType: string,
    timeout = CONTROL_TIMEOUT,
  ): Promise<IKernelMessage | undefined> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const message = await queue.shift(deadline - Date.now());
      if (!message) break;
      if (message.header.msg_type === msgType && message.parent_header?.msg_id === parentId) {
        return message;
      }
    }
    return undefined;
  }

  private async waitForReady(): Promise<void> {
    // Send kernel_info repeatedly until we both get the shell reply AND observe the iopub
    // subscription go live. Retrying converges quickly and avoids the ZMQ slow-joiner stall.
    for (let attempt = 0; attempt < 20; attempt++) {
      const request = this.send("shell", "kernel_info_request", {});
      const reply = await this.awaitReply(this.shellQueue, request.header.msg_id, "kernel_info_reply", 5000);
      if (!reply) continue;

      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        const message = await this.iopubQueue.shift(deadline - Date.now());
        if (!message) break;
        if (
          message.header.msg_type === "status" &&
          (message.content as IStatusContent).execution_state === "idle" &&
          message.parent_header?.msg_id === request.header.msg_id
        ) {
          this.log("kernel ready");
          return;
        }
      }
    }
    throw new Error("Deno kernel did not become ready (no kernel_info/iopub within timeout)");
  }

  public execute(
    code: string,
    onMessage: (message: IKernelMessage) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<IExecuteResult> {
    const run = async (): Promise<IExecuteResult> => {
      const request = this.send("shell", "execute_request", {
        code,
        silent: false,
        store_history: true,
        user_expressions: {},
        allow_stdin: false,
        stop_on_error: true,
      });
      const msgId = request.header.msg_id;

      const deadline = Date.now() + EXECUTE_TIMEOUT;
      let sawIdle = false;
      let executionCount = 0;
      for (;;) {
        if (signal?.aborted) return { status: "abort", executionCount };
        // After idle keep draining until iopub goes quiet; the kernel can emit `status: idle`
        // before it has flushed all stdout, otherwise the trailing stream lines are lost.
        const timeout = sawIdle ? TRAILING_OUTPUT_QUIET_MS : Math.max(0, deadline - Date.now());
        const message = await this.iopubQueue.shift(timeout, signal);
        if (signal?.aborted) return { status: "abort", executionCount };
        if (!message) {
          if (sawIdle) break;
          throw new Error("timed out waiting for kernel output");
        }
        if (message.parent_header?.msg_id !== msgId) continue;
        if (message.header.msg_type === "execute_input") {
          executionCount = (message.content as IExecuteInputContent).execution_count ?? executionCount;
        }
        await onMessage(message);
        if (message.header.msg_type === "status" && (message.content as IStatusContent).execution_state === "idle") {
          sawIdle = true;
        }
      }

      const reply = await this.awaitReply(this.shellQueue, msgId, "execute_reply", EXECUTE_TIMEOUT);
      const replyContent = reply?.content as IExecuteReplyContent | undefined;
      return {
        status: replyContent?.status ?? "ok",
        executionCount: replyContent?.execution_count ?? executionCount,
      };
    };

    const next = this.executionChain.then(run, run);
    this.executionChain = next.catch(() => undefined);
    return next;
  }

  async interrupt(): Promise<void> {
    const request = this.send("control", "interrupt_request", {});
    await this.awaitReply(this.controlQueue, request.header.msg_id, "interrupt_reply");
  }

  // Resolves true once the kernel reports idle, false if it is still busy after the grace period.
  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (!this.busy) return true;
    return await new Promise<boolean>((resolve) => {
      const subscription = this.onDidChangeBusy((busy) => {
        if (!busy) {
          clearTimeout(timer);
          subscription.dispose();
          resolve(true);
        }
      });
      const timer = setTimeout(() => {
        subscription.dispose();
        resolve(false);
      }, timeoutMs);
    });
  }

  async shutdown(): Promise<void> {
    const request = this.send("control", "shutdown_request", { restart: false });
    await this.awaitReply(this.controlQueue, request.header.msg_id, "shutdown_reply", 5000);
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.busyEmitter.dispose();
    try {
      this.shell?.close();
      this.iopub?.close();
      this.control?.close();
    } catch (err) {
      this.log("error closing sockets", err);
    }
  }
}
