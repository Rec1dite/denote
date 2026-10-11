// Simple unbounded async queue with optional timeout and abort-aware reads.
export class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: ((value: T | undefined) => void)[] = [];

  push(item: T) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  async shift(timeoutMs?: number, signal?: AbortSignal): Promise<T | undefined> {
    if (this.items.length) return this.items.shift();
    return await new Promise<T | undefined>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        signal?.removeEventListener("abort", onAbort);
      };
      const waiter = (value: T | undefined) => {
        cleanup();
        resolve(value);
      };
      const onAbort = () => {
        cleanup();
        resolve(undefined);
      };
      if (timeoutMs !== undefined) {
        // Must remove the waiter on timeout, otherwise the next push feeds this already-resolved
        // waiter and the item is silently dropped.
        timer = setTimeout(() => {
          cleanup();
          resolve(undefined);
        }, Math.max(0, timeoutMs));
      }
      if (signal) {
        if (signal.aborted) {
          cleanup();
          resolve(undefined);
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
