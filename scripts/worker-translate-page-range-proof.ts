/**
 * `pnpm worker:translate-page-range-proof` — Translate PDF's page range inside
 * the built worker image: the start-up proof the heartbeat publishes as
 * `translatePageRange` (`src/lib/workers/translate/page-range-capability.ts`),
 * run on the image's REAL Translate extractor, each check printed by step,
 * with its wall time (it runs at daemon start-up beside the other proofs).
 *
 * A 5-page PDF whose page 1 is blank goes through the executor's order with a
 * RECORDING provider and a recording PDF dep: no AI call, no spend, no
 * Chromium, no secret, queue, store or user document.
 *
 * Exit codes: 0 = proven; 1 = a check failed (or the image has no
 * pdftotext). Run by `.github/workflows/container.yml`.
 */
import { runTranslatePageRangeProof } from "@/lib/workers/translate/page-range-capability";

async function main(): Promise<number> {
  const started = Date.now();
  const result = await runTranslatePageRangeProof(process.env);
  for (const line of result.lines) console.log(line);
  console.log(`proof ran in ${Date.now() - started} ms`);
  console.log(result.ok ? "PROVEN" : `FAIL ${result.failed.join(", ")}`);
  return result.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`FAIL — ${(error as Error).message.split("\n")[0]}`);
    process.exit(1);
  },
);
