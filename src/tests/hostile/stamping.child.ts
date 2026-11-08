/**
 * Runs ONE stamping matrix cell in its own process and prints its outcome as
 * a JSON line. `stamping.hostile.test.ts` spawns it (`node --import tsx`, so
 * no wrapper process sits between the bound and the work) for the cells that
 * may hang or blow the heap, kills it at the time bound, and records a hang
 * or a memory death as a finding instead of freezing or crashing the run.
 *
 * Usage: node --import tsx stamping.child.ts <engine|reader> <input-id>
 *  - `<engine>`: one of ENGINES; reports the engine's outcome, its peak RSS,
 *    and the output read back (pdf-lib + pdfjs).
 *  - `reader`: reads the INPUT through pdfjs (our previews' engine) only.
 *
 * `@@ENGINE` is printed before the output is read back, so a reader that
 * hangs on the OUTPUT is told apart from an engine that hangs.
 */

import {
  checkOutput,
  inputById,
  runCell,
  type EngineId,
} from "./stamping.cells";

/** Pipes are asynchronous on Windows: wait for the line to leave before exiting. */
const emit = (line: string) =>
  new Promise<void>((resolve) => {
    process.stdout.write(line + "\n", () => resolve());
  });

async function main(): Promise<void> {
  const [mode, id] = process.argv.slice(-2) as [string, string];
  const { bytes } = await inputById(id);
  if (mode === "reader") {
    const { readAsViewer } = await import("../pdfjs-viewer");
    const t0 = performance.now();
    const pages = await readAsViewer(bytes).then(
      (seen) => seen.length,
      () => -1,
    );
    await emit(
      "@@OUTCOME" +
        JSON.stringify({
          kind: "output",
          viewerPages: pages,
          ms: performance.now() - t0,
        }),
    );
    process.exit(0);
  }
  // Peak resident memory while the ENGINE runs, sampled: a 1 MB upload that
  // costs gigabytes is a finding even when it completes.
  let peak = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 20);
  const { outcome: raw, output } = await runCell(
    mode as EngineId,
    bytes,
    600_000,
  );
  clearInterval(sampler);
  peak = Math.max(peak, process.memoryUsage().rss);
  const outcome = { ...raw, peakRssMB: Math.round(peak / 2 ** 20) };
  await emit("@@ENGINE" + JSON.stringify(outcome));
  const check = output
    ? await checkOutput(mode as EngineId, output)
    : undefined;
  await emit("@@OUTCOME" + JSON.stringify({ ...outcome, check }));
  process.exit(0);
}

void main();
