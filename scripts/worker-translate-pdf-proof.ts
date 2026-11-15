/**
 * `pnpm worker:translate-pdf-proof` — Translate PDF's reflowed PDF inside the
 * built worker image (competitor audit #29 slice 1, 2026-11-15).
 *
 *  1. The start-up language proof the heartbeat publishes
 *     (`translatePdfLanguages`): one translate-pdf job per target language
 *     through the executor's order on the image's REAL Chromium and
 *     `pdftotext`, each PDF judged by independent readers (every font
 *     embedded with ToUnicode; a Noto face for the script, or — Chinese,
 *     Japanese and Korean only — Type 3 glyphs that are vector outlines of
 *     the regional Noto CJK face, never .notdef boxes; the sample read back;
 *     ink on the page; Arabic right to left; and for Chinese, Japanese and
 *     Korean the sample in pdf.js's extracted text). Prints each language's
 *     verdict, the total wall time, and for each CJK language the judged code
 *     points pdf.js read back, naming any it missed.
 *  2. The render cost at delivery size: three chunks at the per-call ceiling
 *     in en, bn, ja, zh, ko, ar and th, three times each, through the job's
 *     own per-job conservation check. Prints p50 and max milliseconds, bytes
 *     and pages, and the false-drop count (which must be 0).
 *
 * Exit codes: 0 = proven; 1 = English, Spanish, Bengali, Arabic, Chinese,
 * Japanese or Korean not proven (Arabic since 2026-11-15, when the direction
 * check stopped refusing poppler's visual-order words; Chinese, Japanese and
 * Korean since the same day, when Type 3 CJK glyphs began to be judged by
 * their property), or any false drop; 2 = Chromium or poppler is not
 * available in this image. Run by
 * `.github/workflows/container.yml`; no secret, queue, store, network, model
 * or user document is touched — the model is a stub and the text synthetic.
 */
import { nativeTranslatePdfRender } from "@/lib/workers/translate/native";
import { nativePdfProbeReaders } from "@/lib/workers/translate/pdf-readers";
import {
  LANGUAGE_SAMPLES,
  probeJudgedText,
  probeTranslatePdfLanguages,
} from "@/lib/workers/translate/pdf-capability";
import { measureDeliverySizeRenders } from "@/lib/workers/translate/pdf-measure";
import type { TranslateLanguage } from "@/lib/jobs/translate-pdf";

const REQUIRED: readonly TranslateLanguage[] = [
  "en",
  "es",
  "bn",
  "ar",
  "zh",
  "ja",
  "ko",
];
const MEASURED: readonly TranslateLanguage[] = [
  "en",
  "bn",
  "ja",
  "zh",
  "ko",
  "ar",
  "th",
];
const CJK: readonly TranslateLanguage[] = ["zh", "ja", "ko"];

async function main(): Promise<number> {
  const render = nativeTranslatePdfRender(process.env);
  const readers = nativePdfProbeReaders();
  if (!render || !readers) {
    console.log(
      `CANNOT CONCLUDE — ${!render ? "Chromium or pdftotext" : "pdffonts or pdftotext"} is not available in this image.`,
    );
    return 2;
  }

  const cjkPdfs = new Map<TranslateLanguage, Uint8Array>();
  const probe = await probeTranslatePdfLanguages({
    render,
    readers,
    env: process.env,
    onPdf: (language, bytes) => {
      if (CJK.includes(language)) cjkPdfs.set(language, bytes);
    },
  });
  console.log(`language proof: ${probe.totalMs} ms total`);
  for (const r of probe.results)
    console.log(
      `  ${r.language}: ${r.ok ? "PASS" : `FAIL (${r.failed})`} ${r.ms} ms${r.pdfBytes !== undefined ? ` ${r.pdfBytes} B` : ""}`,
    );
  console.log(`  passing: ${probe.passing.join(", ") || "(none)"}`);
  for (const language of CJK) {
    const bytes = cjkPdfs.get(language);
    const judged = [
      ...new Set(
        probeJudgedText(language, LANGUAGE_SAMPLES[language]).replace(
          /\s/g,
          "",
        ),
      ),
    ];
    if (!bytes || !readers.viewerText) {
      console.log(`  ${language} viewer text: not read (no PDF or no pdf.js)`);
      continue;
    }
    const seen = new Set(await readers.viewerText(bytes));
    const missed = judged.filter((ch) => !seen.has(ch));
    console.log(
      `  ${language} viewer text: ${judged.length - missed.length}/${judged.length} sample code points${missed.length ? `, missed: ${missed.map((ch) => `${ch} U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`).join(" ")}` : ""}`,
    );
  }

  const summary = await measureDeliverySizeRenders(render, MEASURED, 3);
  console.log(
    `render at delivery size: p50 ${summary.p50Ms} ms, max ${summary.maxMs} ms, false drops ${summary.falseDrops}`,
  );
  for (const r of summary.runs)
    console.log(
      `  ${r.language}: ${r.ok ? "ok" : `DROPPED (${r.reason})`} ${r.ms} ms ${r.characters} chars${r.ok ? ` ${r.bytes} B ${r.pages} pages` : ""}`,
    );

  const missing = REQUIRED.filter((l) => !probe.passing.includes(l));
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
