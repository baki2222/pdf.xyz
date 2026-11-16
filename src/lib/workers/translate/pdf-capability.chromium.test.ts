// @vitest-environment node
// @native-canvas
/**
 * The reflowed PDF on a REAL Chromium, read back by a REAL `pdftotext`.
 *
 * Two suites, each SKIPPED — visibly — where its tools are missing, never a
 * pass it did not run:
 *
 *  1. "conservation at delivery size" needs Chromium and `pdftotext`: a
 *     synthetic translation the size the tool delivers (three chunks of about
 *     10,258 characters, the per-call ceiling) in English, Bengali, Japanese,
 *     Arabic and Thai, printed and read back through the same per-job
 *     conservation check the jobs run. Any refusal is a false drop — a bug,
 *     not a rate. It records render time and size beside the bound they are
 *     held to (`TRANSLATE_PDF_RENDER_TIMEOUT_MS`).
 *  2. "the language proof" also needs `pdffonts`: the start-up proof itself,
 *     for en, bn, ja and ar, plus the Private Use Area control. A desktop
 *     Chromium prints CJK with TrueType system faces, never the Type 3 fonts
 *     the worker image prints (2026-11-16), so the CJK Type 3 path is proven
 *     only by `pdf-glyphs.test.ts` (real image fixtures) and the prod-image
 *     proof — not here.
 *
 * MEASURED 2026-11-15 on the development machine (Windows 11, Playwright's
 * chrome-headless-shell 1234, xpdf 4.00 pdftotext with `-enc UTF-8`, Windows
 * system fonts — not the worker image's Noto faces): suite 1 printed every
 * language with 0 false drops, each render well inside the bound. The
 * worker-image figures are measured in the image, not here.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { TranslateLanguage } from "@/lib/jobs/translate-pdf";
import {
  TRANSLATE_PDF_MAX_OUTPUT_BYTES,
  TRANSLATE_PDF_RENDER_TIMEOUT_MS,
} from "@/lib/jobs/translate-pdf-render";
import {
  createNativeChromiumPdfRunner,
  resolveOnPath,
} from "../html-render/native";
import { findChromium } from "../html-render/test-chromium";
import { resolveNativePdfTextReader } from "../pdf-text/native";
import { LANGUAGE_SAMPLES, probeTranslatePdfLanguages } from "./pdf-capability";
import { nativePdfProbeReaders } from "./pdf-readers";
import { renderTranslationPdf } from "./pdf-render";
import { measureDeliverySizeRenders } from "./pdf-measure";

const BIN = findChromium(resolveOnPath);
const readBack = resolveNativePdfTextReader({});
const readers = nativePdfProbeReaders();

const work = mkdtempSync(path.join(tmpdir(), "pdfxyz-tpdf-"));
afterAll(() => {
  try {
    rmSync(work, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch {
    /* the OS temp cleaner owns it now */
  }
});

const chromium = createNativeChromiumPdfRunner(
  {
    enabled: true,
    candidates: [BIN ?? "chromium"],
    overridden: true,
    timeoutMs: TRANSLATE_PDF_RENDER_TIMEOUT_MS,
    maxInputBytes: 20 * 1024 * 1024,
    maxOutputBytes: TRANSLATE_PDF_MAX_OUTPUT_BYTES,
    tmpDir: work,
  },
  { fileExists: () => true },
);

const render = (
  args: Parameters<
    NonNullable<Parameters<typeof probeTranslatePdfLanguages>[0]["render"]>
  >[0],
) => renderTranslationPdf({ chromium, readBack: readBack!, input: args.input });

const MEASURED: TranslateLanguage[] = ["en", "bn", "ja", "ar", "th"];

describe.skipIf(!BIN || !readBack)(
  "conservation at delivery size (Chromium + pdftotext)",
  { timeout: 5 * TRANSLATE_PDF_RENDER_TIMEOUT_MS },
  () => {
    it("three chunks at the per-call ceiling print in every measured script, with no false drop", async () => {
      const summary = await measureDeliverySizeRenders(render, MEASURED, 1);
      expect(
        summary.runs.filter((r) => !r.ok),
        JSON.stringify(summary.runs),
      ).toEqual([]);
      expect(summary.falseDrops).toBe(0);
      for (const run of summary.runs) {
        expect(run.pages).toBeGreaterThan(1);
        expect(run.bytes).toBeLessThan(TRANSLATE_PDF_MAX_OUTPUT_BYTES);
        // Relative to the bound it is held to, never a typed duration.
        expect(run.ms).toBeLessThan(TRANSLATE_PDF_RENDER_TIMEOUT_MS);
      }
    });
  },
);

describe.skipIf(!BIN || !readBack || !readers)(
  "the language proof (Chromium + poppler)",
  { timeout: 10 * TRANSLATE_PDF_RENDER_TIMEOUT_MS },
  () => {
    it("proves en, bn, ja and ar on this host's real renderer and readers", async () => {
      const probe = await probeTranslatePdfLanguages({
        render,
        readers,
        only: ["en", "bn", "ja", "ar"],
      });
      expect(
        probe.results.filter((r) => !r.ok),
        JSON.stringify(probe.results),
      ).toEqual([]);
    });

    it("positive control: a Private Use Area sample is not proven", async () => {
      const PUA = String.fromCharCode(0xe000, 0xe001);
      const probe = await probeTranslatePdfLanguages({
        render,
        readers,
        samples: { ...LANGUAGE_SAMPLES, ja: `${PUA} ${PUA}` },
        only: ["ja"],
      });
      expect(probe.passing).toEqual([]);
      // Print WHY: on the worker image a PUA glyph is a Type 3 .notdef box
      // (`glyphs`); a desktop with TrueType CJK faces may refuse it earlier.
      console.log(`PUA control failed: ${probe.results[0]?.failed}`);
    });
  },
);
