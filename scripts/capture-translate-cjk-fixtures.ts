/**
 * Capture the Translate PDF probe's own PDFs as test fixtures — run INSIDE the
 * worker image, where Chromium prints Noto CJK as Type 3 fonts (a desktop
 * Chromium with system TrueType CJK fonts never does):
 *
 *   docker run --rm --network none -v <tree>:/app-x:ro -v <out>:/out -w /app-x \
 *     --entrypoint npx ghcr.io/baki2222/pdfxyz-worker:latest \
 *     tsx scripts/capture-translate-cjk-fixtures.ts /out
 *
 * Each language runs through the real start-up probe chain
 * (`probeTranslatePdfLanguages`), so a fixture is byte-for-byte what the
 * probe judged; its verdict is printed beside it. No secret, network, model
 * or user document is touched — the model is the probe's stub.
 *
 * Then (review 2026-11-16) the `*.printed.pdf` fixtures: Chromium's OWN bytes
 * for texts that literally hold a Kangxi radical, or characters that share
 * U+2F3E's glyph in SC (户) and JP (戸), captured BEFORE the render pass's
 * pdf-lib post-process, so the composed-chain test can run that pass on them.
 * Each also runs the whole real job (real pdftotext conservation) and prints
 * its verdict.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { TranslateLanguage } from "@/lib/jobs/translate-pdf";
import { resolveNativeHtmlRenderConfig } from "@/lib/workers/html-render/native-config";
import { createNativeChromiumPdfRunner } from "@/lib/workers/html-render/native";
import { resolveNativePdfTextReader } from "@/lib/workers/pdf-text/native";
import {
  nativeTranslatePdfRender,
  translatePdfRenderConfig,
} from "@/lib/workers/translate/native";
import { renderTranslationPdf } from "@/lib/workers/translate/pdf-render";
import { probeTranslatePdfLanguages } from "@/lib/workers/translate/pdf-capability";
import { nativePdfProbeReaders } from "@/lib/workers/translate/pdf-readers";

const LANGUAGES: readonly TranslateLanguage[] = ["zh", "ja", "ko", "en", "bn"];

/** Built from code points: no tool layer can fold a radical (NFKC would). */
const t = (...cps: number[]) => String.fromCodePoint(...cps);
const SP = 0x20;
export const PRINTED_CASES: readonly {
  file: string;
  target: TranslateLanguage;
  text: string;
}[] = [
  // ⽂ 文 一 人 用户 户口
  {
    file: "zh-radicals.printed.pdf",
    target: "zh",
    text: t(
      0x2f42,
      SP,
      0x6587,
      SP,
      0x4e00,
      SP,
      0x4eba,
      SP,
      0x7528,
      0x6237,
      SP,
      0x6237,
      0x53e3,
    ),
  },
  // ⼈ 人 日本 戸籍 江戸
  {
    file: "ja-radicals.printed.pdf",
    target: "ja",
    text: t(
      0x2f08,
      SP,
      0x4eba,
      SP,
      0x65e5,
      0x672c,
      SP,
      0x6238,
      0x7c4d,
      SP,
      0x6c5f,
      0x6238,
    ),
  },
  // Radical only: ⽂ here.
  {
    file: "en-radical.printed.pdf",
    target: "en",
    text: `Radical only: ${t(0x2f42)} here.`,
  },
];

async function main(): Promise<number> {
  const out = process.argv[2];
  if (!out) {
    console.log("usage: capture-translate-cjk-fixtures.ts <out dir>");
    return 2;
  }
  const render = nativeTranslatePdfRender(process.env);
  const readers = nativePdfProbeReaders();
  if (!render || !readers) {
    console.log("CANNOT CAPTURE — Chromium or poppler is missing here.");
    return 2;
  }
  const probe = await probeTranslatePdfLanguages({
    render,
    readers,
    env: process.env,
    only: LANGUAGES,
    onPdf: (language, bytes) => {
      writeFileSync(path.join(out, `${language}-probe.pdf`), bytes);
    },
  });
  for (const r of probe.results)
    console.log(
      `${r.language}: ${r.ok ? "PASS" : `FAIL (${r.failed})`} ${r.pdfBytes ?? 0} B`,
    );

  const html = translatePdfRenderConfig(
    resolveNativeHtmlRenderConfig(process.env),
  );
  const runner = createNativeChromiumPdfRunner(html);
  const readBack = resolveNativePdfTextReader(process.env);
  if (!readBack) return 2;
  for (const c of PRINTED_CASES) {
    let printed: Uint8Array | null = null;
    const result = await renderTranslationPdf({
      chromium: {
        renderPackage: async (pkg, run) => {
          const parts = await runner.renderPackage(pkg, run);
          printed = parts[0] ?? null;
          return parts;
        },
      },
      readBack,
      input: {
        parts: [{ kind: "body", pages: [1], text: c.text, chosen: null }],
        target: c.target,
        sourceName: "probe.pdf",
      },
    });
    if (printed) writeFileSync(path.join(out, c.file), printed);
    console.log(
      `${c.file}: job ${result.ok ? "ok" : `FAIL (${result.reason})`}, printed ${printed ? (printed as Uint8Array).byteLength : 0} B`,
    );
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`threw: ${error instanceof Error ? error.message : "unknown"}`);
    process.exit(1);
  },
);
