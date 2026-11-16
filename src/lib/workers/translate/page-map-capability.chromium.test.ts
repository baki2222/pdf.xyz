// @vitest-environment node
// @native-canvas
/**
 * The `translatePageMap` probe on a REAL Chromium, read back by a REAL
 * `pdftotext`, with Translate's real extractor. Gated like
 * `pdf-capability.chromium.test.ts`: each suite SKIPS — visibly, the label
 * says why — where its tools are missing, never a pass it did not run.
 *
 *  1. "both arms on real binaries" needs Chromium and `pdftotext`: the probe
 *     with this host's renderer and the engine's read-back, the language set
 *     stubbed to the one target it prints ("es"), so no `pdffonts` is needed.
 *     Plus the positive control: a model that drops the markers in arm A too
 *     must fail exactly `control`, `pdf_a` and `wire_a` on the real reader.
 *  2. "provesTranslatePageMap" also needs poppler's `pdffonts` (the language
 *     memo it awaits): the heartbeat's own entry point is true.
 *
 * The shipped binaries are checked by
 * `scripts/worker-translate-page-map-proof.ts` inside the built worker image
 * (`.github/workflows/container.yml`), which is what makes the key true of
 * the image rather than of this host.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import type { TranslatePdfDeps } from "./engine";
import { translateDeps } from "./native";
import {
  probeTranslatePageMap,
  provesTranslatePageMap,
  stripSeparatorsAnswer,
} from "./page-map-capability";
import { resetTranslatePdfLanguagesForTests } from "./pdf-languages";
import { nativePdfProbeReaders } from "./pdf-readers";
import { renderTranslationPdf } from "./pdf-render";

const BIN = findChromium(resolveOnPath);
const readBack = resolveNativePdfTextReader({});
const extract = translateDeps({}).extract;
const readers = nativePdfProbeReaders();

const work = mkdtempSync(path.join(tmpdir(), "pdfxyz-pagemap-"));
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

const pdf: TranslatePdfDeps = {
  languages: () => new Set(["es"]),
  render: ({ input }) =>
    renderTranslationPdf({ chromium, readBack: readBack!, input }),
};

const both = !!BIN && !!readBack && !!extract;
describe.skipIf(!both)(
  both
    ? "translatePageMap: both arms on real binaries (Chromium + pdftotext)"
    : "translatePageMap: both arms on real binaries (SKIPPED: no Chromium or no pdftotext found)",
  { timeout: 6 * TRANSLATE_PDF_RENDER_TIMEOUT_MS },
  () => {
    it("the probe holds: every check passes, page headings in arm A, the range in arm B", async () => {
      const verdict = await probeTranslatePageMap({
        extract,
        pdf,
        readPdfText: readBack,
      });
      console.log(
        `page-map probe: failed=[${verdict.failed.join(",")}] a=${JSON.stringify(verdict.arms?.a.headings)} b=${JSON.stringify(verdict.arms?.b.headings)}`,
      );
      expect(verdict.failed).toEqual([]);
      expect(verdict.ok).toBe(true);
      expect(verdict.target).toBe("es");
    });

    it("POSITIVE CONTROL on the real reader: arm A's model drops the markers too → exactly control, pdf_a, wire_a", async () => {
      const verdict = await probeTranslatePageMap({
        extract,
        pdf,
        readPdfText: readBack,
        answerA: stripSeparatorsAnswer,
      });
      expect([...verdict.failed].sort()).toEqual([
        "control",
        "pdf_a",
        "wire_a",
      ]);
    });
  },
);

const proves = both && !!readers;
describe.skipIf(!proves)(
  proves
    ? "provesTranslatePageMap on real binaries (Chromium + poppler)"
    : "provesTranslatePageMap on real binaries (SKIPPED: needs Chromium, pdftotext and poppler's pdffonts)",
  { timeout: 30 * TRANSLATE_PDF_RENDER_TIMEOUT_MS },
  () => {
    beforeAll(() => resetTranslatePdfLanguagesForTests());
    afterAll(() => resetTranslatePdfLanguagesForTests());

    it("is true: the heartbeat's own entry point, after the language memo settles", async () => {
      await expect(
        provesTranslatePageMap({ PDFXYZ_HTML_RENDER_CHROMIUM_BIN: BIN! }),
      ).resolves.toBe(true);
    });
  },
);
