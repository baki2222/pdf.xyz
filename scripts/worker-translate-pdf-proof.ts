/**
 * `pnpm worker:translate-pdf-proof` — Translate PDF's reflowed PDF inside the
 * built worker image (competitor audit #29 slice 1, 2026-11-15).
 *
 *  1. The start-up language proof the heartbeat publishes
 *     (`translatePdfLanguages`): one translate-pdf job per target language
 *     through the executor's order on the image's REAL Chromium and
 *     `pdftotext`, each PDF judged by poppler (fonts embedded with a Noto
 *     face for the script, the sample read back, ink on the page, Arabic
 *     right to left). Prints each language's verdict and the total wall time.
 *  2. The render cost at delivery size: three chunks at the per-call ceiling
 *     in en, bn, ja, ar and th, three times each, through the job's own
 *     per-job conservation check. Prints p50 and max milliseconds, bytes and
 *     pages, and the false-drop count (which must be 0).
 *
 * Exit codes: 0 = proven; 1 = a language in `TRANSLATE_PDF_CI_REQUIRED` not
 * proven, or any false drop; 2 = Chromium or poppler is not available in this image. Run by
 * `.github/workflows/container.yml`; no secret, queue, store, network, model
 * or user document is touched — the model is a stub and the text synthetic.
 */
import { nativeTranslatePdfRender } from "@/lib/workers/translate/native";
import { nativePdfProbeReaders } from "@/lib/workers/translate/pdf-readers";
import { probeTranslatePdfLanguages } from "@/lib/workers/translate/pdf-capability";
import { measureDeliverySizeRenders } from "@/lib/workers/translate/pdf-measure";
import {
  TRANSLATE_PDF_CI_REQUIRED,
  type TranslateLanguage,
} from "@/lib/jobs/translate-pdf";

// The required set is NOT typed here (2026-11-15, audit #29 slice 2): the
// static copy names the languages that get a PDF from the same constant, so
// this gate is what keeps that copy true. See TRANSLATE_PDF_CI_REQUIRED.
const MEASURED: readonly TranslateLanguage[] = ["en", "bn", "ja", "ar", "th"];

async function main(): Promise<number> {
  const render = nativeTranslatePdfRender(process.env);
  const readers = nativePdfProbeReaders();
  if (!render || !readers) {
    console.log(
      `CANNOT CONCLUDE — ${!render ? "Chromium or pdftotext" : "pdffonts or pdftotext"} is not available in this image.`,
    );
    return 2;
  }

  const probe = await probeTranslatePdfLanguages({
    render,
    readers,
    env: process.env,
  });
  console.log(`language proof: ${probe.totalMs} ms total`);
  for (const r of probe.results)
    console.log(
      `  ${r.language}: ${r.ok ? "PASS" : `FAIL (${r.failed})`} ${r.ms} ms${r.pdfBytes !== undefined ? ` ${r.pdfBytes} B` : ""}`,
    );
  console.log(`  passing: ${probe.passing.join(", ") || "(none)"}`);

  const summary = await measureDeliverySizeRenders(render, MEASURED, 3);
  console.log(
    `render at delivery size: p50 ${summary.p50Ms} ms, max ${summary.maxMs} ms, false drops ${summary.falseDrops}`,
  );
  for (const r of summary.runs)
    console.log(
      `  ${r.language}: ${r.ok ? "ok" : `DROPPED (${r.reason})`} ${r.ms} ms ${r.characters} chars${r.ok ? ` ${r.bytes} B ${r.pages} pages` : ""}`,
    );

  const missing = TRANSLATE_PDF_CI_REQUIRED.filter(
    (l) => !probe.passing.includes(l),
  );
  if (missing.length > 0) {
    console.log(`FAIL — not proven: ${missing.join(", ")}`);
    return 1;
  }
  if (summary.falseDrops > 0) {
    console.log(`FAIL — ${summary.falseDrops} false drop(s) at delivery size`);
    return 1;
  }
  console.log("PASS");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(
      `FAIL — the proof threw: ${error instanceof Error ? error.name : "unknown"}`,
    );
    process.exit(1);
  },
);
