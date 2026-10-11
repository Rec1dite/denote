import * as crypto from "crypto";

// Jupyter wire protocol message framing (HMAC-signed), mirroring JupyterLab/nteract.

const DELIMITER = "<IDS|MSG>";

export interface IConnectionFile {
  transport: "tcp" | "ipc";
  ip: string;
  shell_port: number;
  iopub_port: number;
  stdin_port: number;
  control_port: number;
  hb_port: number;
  signature_scheme: "hmac-sha256";
  key: string;
  kernel_name: string;
}

export interface IMessageHeader {
  msg_id: string;
  username: string;
  session: string;
  date: string;
  msg_type: string;
  version: string;
}

export interface IKernelMessage<T = unknown> {
  header: IMessageHeader;
  parent_header: Partial<IMessageHeader>;
  metadata: Record<string, unknown>;
  content: T;
  channel?: KernelChannel;
}

export type KernelChannel = "shell" | "iopub" | "control" | "stdin";

// Content shapes for the messages we consume.
export interface IStreamContent {
  name: "stdout" | "stderr";
  text: string;
}
export interface IDisplayContent {
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  transient?: { display_id?: string };
}
export interface IErrorContent {
  ename: string;
  evalue: string;
  traceback: string[];
}
export type ExecutionState = "starting" | "busy" | "idle" | "restarting" | "dead";
export interface IStatusContent {
  execution_state: ExecutionState;
}
export interface IExecuteInputContent {
  code: string;
  execution_count: number;
}
export interface IExecuteReplyContent {
  status: "ok" | "error" | "abort";
  execution_count?: number;
}
export interface IKernelInfoReplyContent {
  implementation?: string;
  implementation_version?: string;
  language_info?: { name?: string };
}
export interface IInterruptReplyContent {
  status: "ok";
}

export function createHeader(msgType: string, session: string): IMessageHeader {
  return {
    msg_id: crypto.randomUUID(),
    username: "denote",
    session,
    date: new Date().toISOString(),
    msg_type: msgType,
    version: "5.3",
  };
}

function sign(key: string, parts: string[]): string {
  if (!key) return "";
  return crypto.createHmac("sha256", key).update(parts.join("")).digest("hex");
}

export function encodeMessage(message: IKernelMessage, key: string): Buffer[] {
  const parts = [message.header, message.parent_header, message.metadata, message.content].map((p) =>
    JSON.stringify(p),
  );
  return [DELIMITER, sign(key, parts), ...parts].map((s) => Buffer.from(s, "utf8"));
}

export function decodeMessage(frames: Buffer[]): IKernelMessage {
  const strs = frames.map((f) => f.toString("utf8"));
  const delimiterIndex = strs.indexOf(DELIMITER);
  if (delimiterIndex >= 0) {
    strs.splice(0, delimiterIndex + 1);
  }
  const [signature, header, parentHeader, metadata, content] = strs.slice(-5);
  if (signature === undefined || header === undefined) {
    throw new Error("malformed Jupyter message");
  }
  return {
    header: JSON.parse(header),
    parent_header: JSON.parse(parentHeader),
    metadata: JSON.parse(metadata),
    content: JSON.parse(content),
  };
}
