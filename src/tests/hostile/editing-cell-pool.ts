import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { CellOutcome } from "./editing-cell-worker";

/**
 * One worker thread that runs editing cells one at a time, replaced whenever
 * a cell outlives its bound (terminate = HANG) or exhausts the worker's heap
 * (ERR_WORKER_OUT_OF_MEMORY = MEMORY). A synchronous infinite loop inside
 * pdf-lib never yields, so a vitest timeout alone could not record it — the
 * whole run would freeze instead.
 */

export type BoundedOutcome =
  | CellOutcome
  | { status: "hang"; ms: number }
  | { status: "memory"; message: string }
  | { status: "crash"; message: string };

const WORKER = fileURLToPath(
  new URL("./editing-cell-worker.ts", import.meta.url),
);

/** Heap ceiling per worker: a runaway allocation is a finding, not a dead run. */
export const WORKER_HEAP_MB = 768;

export class CellPool {
  private worker: Worker | null = null;
  private seq = 0;
  private fresh = false;

  private spawn(): Worker {
    const w = new Worker(WORKER, {
      execArgv: ["--import", "tsx"],
      workerData: { hostileCell: true },
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
    });
    w.unref();
    this.worker = w;
    this.fresh = true;
    return w;
  }

  /** Run `op` on `bytes`; never rejects, never outlives `ms` (+ worker start). */
  async run(
    op: string,
    bytes: Uint8Array,
    ms: number,
    plan?: unknown,
    measureQ = false,
  ): Promise<BoundedOutcome> {
    const w = this.worker ?? this.spawn();
    const id = (this.seq += 1);
    return new Promise<BoundedOutcome>((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const done = (outcome: BoundedOutcome, kill: boolean) => {
        if (timer) clearTimeout(timer);
        w.off("message", onMessage);
        w.off("error", onError);
        w.off("exit", onExit);
        if (kill) {
          void w.terminate();
          if (this.worker === w) this.worker = null;
        }
        resolve(outcome);
      };
      const onMessage = (msg: { id: number; outcome: CellOutcome }) => {
        if (msg.id === id) done(msg.outcome, false);
      };
      const onError = (err: Error & { code?: string }) => {
        if (err.code === "ERR_WORKER_OUT_OF_MEMORY")
          done({ status: "memory", message: err.message }, true);
        else
          done(
            { status: "crash", message: `${err.name}: ${err.message}` },
            true,
          );
      };
      const onExit = (code: number) =>
        done({ status: "crash", message: `worker exited ${code}` }, true);
      w.on("message", onMessage);
      w.on("error", onError);
      w.on("exit", onExit);
      // The first cell on a fresh worker also pays for loading tsx + pdf-lib.
      const startup = this.fresh ? 30_000 : 0;
      this.fresh = false;
      timer = setTimeout(
        () => done({ status: "hang", ms }, true),
        ms + startup,
      );
      w.postMessage({ id, op, bytes: bytes.slice(), plan, measureQ });
    });
  }

  async close(): Promise<void> {
    if (this.worker) await this.worker.terminate();
    this.worker = null;
  }
}
