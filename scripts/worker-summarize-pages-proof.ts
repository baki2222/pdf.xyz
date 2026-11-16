/**
 * `pnpm worker:summarize-pages-proof` — Summarize PDF's page range inside the
 * built worker image: the start-up proof the heartbeat publishes as
 * `summarizePages` (`src/lib/workers/summarize/pages-capability.ts`), run on
 * the image's REAL `pdftotext`, each check printed by step.
 *
 * A 4-page PDF whose page 2 is blank goes through the executor's order with
 * a RECORDING provider: no AI call, no spend, no secret, queue, store or
 * user document.
 *
 * Exit codes: 0 = proven; 1 = a check failed (or the image has no
 * pdftotext). Run by `.github/workflows/container.yml`.
 */
import { runSummarizePagesProof } from "@/lib/workers/summarize/pages-capability";

async function main(): Promise<number> {
  const started = Date.now();
  const result = await runSummarizePagesProof(process.env);
  for (const line of result.lines) console.log(line);
  console.log(`proof ran in ${Date.now() - started} ms`);
  console.log(result.ok ? "PROVEN" : "FAIL");
  return result.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`FAIL — ${(error as Error).message.split("\n")[0]}`);
    process.exit(1);
  },
);
