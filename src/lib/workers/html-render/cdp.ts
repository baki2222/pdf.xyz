/**
 * A minimal Chrome DevTools Protocol client over `--remote-debugging-pipe`.
 *
 * Pipe, not a port: the browser reads commands on fd 3 and writes replies on
 * fd 4, each message a JSON object terminated by NUL. Nothing listens on a
 * socket, so nothing else on the worker host can attach to a render — and no
 * dependency is needed for the half-dozen commands a PDF render uses.
 */

export interface CdpPipe {
  write(message: string): void;
  onData(listener: (chunk: Buffer) => void): void;
  onClose(listener: (reason: string) => void): void;
}

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  method: string;
}

export class CdpConnection {
  private nextId = 0;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: CdpEvent) => void>();
  private closedReason: string | null = null;

  constructor(private readonly pipe: CdpPipe) {
    pipe.onData((chunk) => this.receive(chunk));
    pipe.onClose((reason) => this.close(reason));
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    if (this.closedReason !== null)
      return Promise.reject(
        new Error(`CDP ${method}: connection closed (${this.closedReason})`),
      );
    const id = ++this.nextId;
    const message = JSON.stringify({
      id,
      method,
      params,
      ...(sessionId ? { sessionId } : {}),
    });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: Record<string, unknown>) => void,
        reject,
        method,
      });
      try {
        this.pipe.write(`${message}\0`);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  on(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(reason: string): void {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    for (const [, p] of this.pending)
      p.reject(new Error(`CDP ${p.method}: connection closed (${reason})`));
    this.pending.clear();
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let end: number;
    while ((end = this.buffer.indexOf(0)) >= 0) {
      const raw = this.buffer.subarray(0, end).toString("utf8");
      this.buffer = this.buffer.subarray(end + 1);
      let message: {
        id?: number;
        result?: Record<string, unknown>;
        error?: { message?: string };
        method?: string;
        params?: Record<string, unknown>;
        sessionId?: string;
      };
      try {
        message = JSON.parse(raw);
      } catch {
        continue;
      }
      if (typeof message.id === "number") {
        const p = this.pending.get(message.id);
        if (!p) continue;
        this.pending.delete(message.id);
        if (message.error)
          p.reject(
            new Error(`CDP ${p.method}: ${message.error.message ?? "error"}`),
          );
        else p.resolve(message.result ?? {});
      } else if (typeof message.method === "string") {
        const event: CdpEvent = {
          method: message.method,
          params: message.params ?? {},
          ...(message.sessionId ? { sessionId: message.sessionId } : {}),
        };
        for (const listener of this.listeners) listener(event);
      }
    }
  }
}
