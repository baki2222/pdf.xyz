// Same-process, same-moment yardsticks for the hostile suite's time bounds.
//
// WHY. A lone wall-clock constant is a number with nothing to constrain it
// (CLAUDE.md, rule 3): the same child that takes 8 s on a quiet Windows box
// took 30.2 s on a loaded CI runner (2026-11-15, run 43629904891), and a
// 30,000 ms bound read that as a defect. What a time bound actually claims is
// RELATIVE: "this refusal costs about as much as reading the budget's bytes",
// not "this refusal takes under 30 s on whatever machine runs it". So the
// claim is measured against work this machine does in the same process, just
// before, and a generous absolute ceiling stays beside it to catch a hang.
//
// The yardstick here is the irreducible part of a stream preflight: inflate
// Flate through `DecompressionStream` (the API pdfjs-guard.ts's decoder
// uses) and look at every output byte once in a JS loop. It shares no code
// with the guard, so a guard that got uniformly slower still reads slower
// against it.
import { zeroBomb } from "./page-structure.raw";

const MiB = 1024 * 1024;

export interface Yardstick {
  /** Median ms of the reps, for `sampleMiB` MiB of output. */
  ms: number;
  sampleMiB: number;
  reps: number[];
  /** ms per MiB of output: the figure a bound scales. */
  msPerMiB: number;
}

/** One pass: inflate `sample` (a zlib stream) and touch every output byte. */
async function pass(
  sample: Uint8Array,
): Promise<{ ms: number; seen: number; acc: number }> {
  const t0 = performance.now();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sample);
      controller.close();
    },
  }).pipeThrough(
    new DecompressionStream("deflate") as unknown as TransformStream<
      Uint8Array,
      Uint8Array
    >,
  );
  const reader = stream.getReader();
  let seen = 0;
  let acc = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // A small state machine, so the loop cannot be folded away: the guard's
    // scanners branch on every byte too.
    for (let i = 0; i < value.length; i += 1) {
      const b = value[i]!;
      acc = b === 0x3e ? acc + 1 : (acc ^ b) & 0xffff;
    }
    seen += value.length;
  }
  // `acc` is returned so the work is observable.
  return { ms: performance.now() - t0, seen, acc };
}

/**
 * Inflate-and-scan `sampleMiB` MiB of zeros `reps` times; report the median.
 * The fixture (a zlib stream of zeros, a few hundred KB) is built before the
 * clock starts. The output size is asserted: a yardstick that read nothing
 * would make every bound against it vacuous (rule 1's health check).
 */
export async function inflateScanYardstick(
  sampleMiB = 64,
  reps = 3,
): Promise<Yardstick> {
  const sample = zeroBomb(sampleMiB);
  const times: number[] = [];
  for (let r = 0; r < reps; r += 1) {
    const { ms, seen } = await pass(sample);
    if (seen !== sampleMiB * MiB) {
      throw new Error(`yardstick read ${seen} bytes, not ${sampleMiB} MiB`);
    }
    times.push(ms);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const ms = sorted[Math.floor(sorted.length / 2)]!;
  return { ms, sampleMiB, reps: times, msPerMiB: ms / sampleMiB };
}
