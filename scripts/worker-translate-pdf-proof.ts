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
 *  1b. The ToUnicode rewrite at the point of consumption (review
 *     2026-11-16): texts that literally contain a Kangxi radical, and texts
 *     whose characters share a radical's glyph with a NON-equivalent
 *     ideograph (户 in SC, 戸 in JP), each rendered as a real job and read by
 *     pdftotext AND pdf.js. Every case must deliver, pdftotext must read the
 *     radicals that were written, and pdf.js must read the named characters
 *     and none of the forbidden ones. Plus the measured cmap facts the
 *     rewrite is derived from (`radical-glyph-facts.json`), re-measured from
 *     this image's faces: any difference fails.
 *  2. The render cost at delivery size: three chunks at the per-call ceiling
 *     in en, bn, ja, zh, ko, ar and th, three times each, through the job's
 *     own per-job conservation check. Prints p50 and max milliseconds, bytes
 *     and pages, and the false-drop count (which must be 0).
 *
 * Exit codes: 0 = proven; 1 = English, Spanish, Bengali, Arabic, Chinese,
 * Japanese or Korean not proven, a 1b case failed, the facts differ (the
 * last two since 2026-11-16; Arabic since 2026-11-15, when the direction
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
import { RADICAL_GLYPH_FACTS } from "@/lib/workers/translate/radical-equivalents";
import {
  diffRadicalGlyphFacts,
  measureRadicalGlyphFacts,
} from "@/lib/workers/translate/radical-glyph-measure";
import { cjkFontFiles } from "./cjk-font-files";

/**
 * 1b's cases, built from code points so no editor or tool layer can fold a
 * radical into its ideograph (NFKC would): 0x2f42 is KANGXI RADICAL SCRIPT,
 * 0x6587 the ideograph that shares its glyph.
 */
const t = (...cps: number[]) => String.fromCodePoint(...cps);
const SP = 0x20;
const REWRITE_CASES: readonly {
  name: string;
  target: TranslateLanguage;
  text: string;
  viewerHas: string;
  viewerLacks: string;
}[] = [
  {
    name: "en literal radical U+2F42",
    target: "en",
    text: `Radical only: ${t(0x2f42)} here.`,
    viewerHas: t(0x2f42),
    viewerLacks: t(0x6587),
  },
  {
    name: "en radical U+2F42 + ideograph U+6587",
    target: "en",
    text: `Mixed: ${t(0x2f42)} and ${t(0x6587)} here.`,
    viewerHas: t(0x2f42),
    viewerLacks: "",
  },
  {
    name: "zh radical U+2F42 + ideographs",
    target: "zh",
    text: t(0x2f42, SP, 0x6587, SP, 0x4e00, SP, 0x4eba),
    viewerHas: t(0x2f42, 0x4e00, 0x4eba),
    viewerLacks: t(0x2f00, 0x2f08),
  },
  {
    name: "ja radical U+2F08 + ideographs",
    target: "ja",
    text: t(0x2f08, SP, 0x4eba, SP, 0x65e5, 0x672c),
    viewerHas: t(0x2f08, 0x65e5),
    viewerLacks: t(0x2f47),
  },
  {
    name: "zh no radical",
    target: "zh",
    text: t(0x6587, 0x5b57, SP, 0x4e00, 0x4e2a, 0x4eba),
    viewerHas: t(0x6587, 0x4e00, 0x4eba),
    viewerLacks: t(0x2f42, 0x2f00, 0x2f08),
  },
  {
    name: "zh U+6237 (SC: shares U+2F3E's glyph)",
    target: "zh",
    text: t(
      0x7528,
      0x6237,
      SP,
      0x5ba2,
      0x6237,
      SP,
      0x8d26,
      0x6237,
      SP,
      0x6237,
      0x53e3,
    ),
    viewerHas: t(0x6237, 0x7528, 0x53e3),
    viewerLacks: t(0x6236, 0x2f3e, 0x2f64, 0x2f1d),
  },
  {
    name: "ja U+6238 (JP: shares U+2F3E's glyph)",
    target: "ja",
    text: t(0x6238, 0x7c4d, SP, 0x6c5f, 0x6238, SP, 0x6238, 0x53e3),
    viewerHas: t(0x6238, 0x53e3),
    viewerLacks: t(0x6236, 0x2f3e, 0x2f1d),
  },
];

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

  let rewriteFailures = 0;
  console.log("ToUnicode rewrite at the point of consumption:");
  for (const c of REWRITE_CASES) {
    const result = await render({
      input: {
        parts: [{ kind: "body", pages: [1], text: c.text }],
        target: c.target,
        sourceName: "proof.pdf",
      },
    });
    if (!result.ok) {
      rewriteFailures += 1;
      console.log(`  ${c.name}: FAIL (${result.reason})`);
      continue;
    }
    const poppler = new Set(await readers.text(result.bytes));
    const viewer = new Set(
      readers.viewerText ? await readers.viewerText(result.bytes) : "",
    );
    const written = [...new Set(c.text.replace(/\s/g, ""))];
    const popplerMissed = written.filter((ch) => !poppler.has(ch));
    const viewerMissed = [...c.viewerHas].filter((ch) => !viewer.has(ch));
    const viewerWrong = [...c.viewerLacks].filter((ch) => viewer.has(ch));
    const ok =
      popplerMissed.length === 0 &&
      viewerMissed.length === 0 &&
      viewerWrong.length === 0;
    if (!ok) rewriteFailures += 1;
    const u = (chs: string[]) =>
      chs
        .map((ch) => `${ch} U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`)
        .join(" ");
    console.log(
      `  ${c.name}: ${ok ? "PASS" : "FAIL"} delivered; pdftotext ${written.length - popplerMissed.length}/${written.length}${popplerMissed.length ? ` missed ${u(popplerMissed)}` : ""}; pdf.js reads [${u([...c.viewerHas].filter((ch) => viewer.has(ch)))}]${viewerMissed.length ? ` missed ${u(viewerMissed)}` : ""}${viewerWrong.length ? ` WRONG ${u(viewerWrong)}` : ""}`,
    );
  }

  const factsDiff = diffRadicalGlyphFacts(
    RADICAL_GLYPH_FACTS,
    await measureRadicalGlyphFacts(cjkFontFiles()),
  );
  console.log(
    `radical glyph facts: ${factsDiff.length === 0 ? `SAME as vendored (${Object.keys(RADICAL_GLYPH_FACTS.faces).length} faces)` : "DIFFER"}`,
  );
  for (const line of factsDiff) console.log(`  differs: ${line}`);

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
  if (rewriteFailures > 0) {
    console.log(`FAIL — ${rewriteFailures} ToUnicode rewrite case(s)`);
    return 1;
  }
  if (factsDiff.length > 0) {
    console.log("FAIL — the image's faces no longer give the vendored facts");
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
