/**
 * PS-02 adversarial verification child. Builds a one-page PDF whose content
 * stream is a FlateDecode zero bomb of N MiB (optionally double-deflated),
 * runs nUpPdf (perSheet 4) and prints one JSON line with outcome, ms, and
 * peak RSS sampled every 10 ms. The parent kills it at a time/RSS bound.
 *
 * Usage: node --import tsx ps02-verify.child.ts <mebibytes> <plain|chained|control>
 */
import { ONE_PAGE, rawPdf, reflate, zeroBomb } from "./page-structure.raw";

async function main(): Promise<void> {
  const [mibRaw, mode] = process.argv.slice(2) as [string, string];
  const mib = Number(mibRaw);
  const stream =
    mode === "control"
      ? new TextEncoder().encode("0 0 m 10 10 l S")
      : mode === "chained"
        ? reflate(zeroBomb(mib))
        : zeroBomb(mib);
  const filter =
    mode === "control"
      ? ""
      : mode === "chained"
        ? "/Filter [/FlateDecode /FlateDecode]"
        : "/Filter /FlateDecode";
  const bytes = rawPdf({
    objects: [
      ONE_PAGE[0]!,
      ONE_PAGE[1]!,
      ONE_PAGE[2]!,
      { dict: filter, stream },
    ],
  });
  const { nUpPdf, DEFAULT_N_UP_OPTIONS } = await import("../../lib/pdf/n-up");
  let peak = process.memoryUsage().rss;
  const timer = setInterval(() => {
    const r = process.memoryUsage().rss;
    if (r > peak) peak = r;
    process.stderr.write(`rss ${Math.round(r / 2 ** 20)}\n`);
  }, 10);
  const t0 = performance.now();
  let outcome: string;
  try {
    const out = await nUpPdf(bytes, { ...DEFAULT_N_UP_OPTIONS, perSheet: 4 });
    outcome = `ok ${JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v instanceof Uint8Array ? v.length : v])))}`;
  } catch (e) {
    outcome = `threw ${(e as Error).name}: ${(e as Error).message}`;
  }
  clearInterval(timer);
  const r = process.memoryUsage().rss;
  if (r > peak) peak = r;
  process.stdout.write(
    JSON.stringify({
      mib,
      mode,
      inputBytes: bytes.length,
      outcome,
      ms: Math.round(performance.now() - t0),
      peakRssMiB: Math.round(peak / 2 ** 20),
    }) + "\n",
  );
}

void main();
