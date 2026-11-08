/**
 * SIB-04 verify child: run `loadPdf` (src/lib/pdf/engine.ts) on one hostile
 * fixture inside a worker thread while the main thread samples process RSS,
 * so a synchronous inflate cannot starve the sampler. Prints one JSON line.
 *
 *   npx tsx src/tests/hostile/sib04-verify.child.ts <case> [capMiB] [timeoutMs]
 */
import {
  Worker,
  isMainThread,
  workerData,
  parentPort,
} from "node:worker_threads";

type Case = "bomb" | "wzero" | "size20" | "control";

async function build(c: Case): Promise<Uint8Array> {
  const f = await import("./security-in-browser.fixtures");
  switch (c) {
    case "bomb":
      return f.xrefStreamPdf({
        objects: f.ONE_PAGE,
        xrefBody: f.zeroBomb(1024),
        xrefDict: "/Filter /FlateDecode",
      });
    case "wzero":
      return f.xrefStreamPdf({
        objects: f.ONE_PAGE,
        w: "[0 0 0]",
        index: "[0 2147483647]",
      });
    case "size20":
      return f.xrefStreamPdf({
        objects: f.ONE_PAGE,
        size: "99999999999999999999",
      });
    case "control":
      return f.xrefStreamPdf({ objects: f.ONE_PAGE });
  }
}

if (isMainThread) {
  const c = (process.argv[2] ?? "control") as Case;
  const capMiB = Number(process.argv[3] ?? 3072);
  const timeoutMs = Number(process.argv[4] ?? 90_000);
  const base = process.memoryUsage().rss;
  let peak = base;
  const t0 = Date.now();
  const w = new Worker(new URL(import.meta.url), {
    workerData: { c },
    execArgv: process.execArgv,
  });
  const done = (r: Record<string, unknown>) => {
    const out = {
      case: c,
      ...r,
      baseMiB: Math.round(base / 2 ** 20),
      peakMiB: Math.round(peak / 2 ** 20),
      growthMiB: Math.round((peak - base) / 2 ** 20),
      ms: Date.now() - t0,
    };
    process.stdout.write(`${JSON.stringify(out)}\n`);
    process.exit(0);
  };
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peak) peak = rss;
    if (rss > capMiB * 2 ** 20) done({ outcome: `killed-above-${capMiB}MiB` });
    if (Date.now() - t0 > timeoutMs)
      done({ outcome: `timeout-${timeoutMs}ms` });
  }, 20);
  timer.unref?.();
  w.on("message", (m) => done(m as Record<string, unknown>));
  w.on("error", (e) =>
    done({ outcome: "worker-error", error: String(e).slice(0, 200) }),
  );
} else {
  void (async () => {
    const bytes = await build((workerData as { c: Case }).c);
    const { loadPdf } = await import("@/lib/pdf/engine");
    try {
      const doc = await loadPdf(bytes);
      parentPort!.postMessage({
        outcome: "loaded",
        bytes: bytes.length,
        pages: doc.getPageCount(),
      });
    } catch (e) {
      parentPort!.postMessage({
        outcome: "threw",
        bytes: bytes.length,
        error: `${(e as Error).name}: ${(e as Error).message}`.slice(0, 200),
      });
    }
  })();
}
