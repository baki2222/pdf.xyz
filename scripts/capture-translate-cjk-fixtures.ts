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
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { TranslateLanguage } from "@/lib/jobs/translate-pdf";
import { nativeTranslatePdfRender } from "@/lib/workers/translate/native";
import { probeTranslatePdfLanguages } from "@/lib/workers/translate/pdf-capability";
import { nativePdfProbeReaders } from "@/lib/workers/translate/pdf-readers";

const LANGUAGES: readonly TranslateLanguage[] = ["zh", "ja", "ko", "en", "bn"];

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
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`threw: ${error instanceof Error ? error.message : "unknown"}`);
    process.exit(1);
  },
);
