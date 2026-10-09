// @vitest-environment node
/**
 * Confidence measurement for OCR — the only signal the product has that a run may
 * have produced nonsense.
 *
 * A wrong-language OCR does not fail. Tesseract matches glyph shapes against whatever
 * model it was handed and returns fluent-looking rubbish, the job completes, and a
 * valid searchable PDF is produced. `meanConfidence` was hardcoded `null`, so nothing
 * anywhere could tell the difference between that and a good run.
 *
 * Two things are worth pinning here, and the second is the one that bites:
 *  - which TSV rows count (words only, real confidences only), and
 *  - the units. Tesseract reports 0-100; the meta contract is [0, 1]. Skip the
 *    conversion and nothing throws — `buildOcrResultMeta` rejects every real value as
 *    out of range and nulls the field, putting it straight back to invisible with a
 *    green suite.
 */
import { describe, expect, it } from "vitest";
import {
  buildOcrResultMeta,
  ocrConfidenceLooksLow,
  OCR_LOW_CONFIDENCE_WORD_THRESHOLD,
} from "@/lib/jobs/ocr";
import { nativeOcrArgs, parseTesseractConfidence } from "./ocr-native";

const HEADER =
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

/** One TSV row. `level` 5 is a word; anything else is layout structure. */
function row(level: number, conf: number, text: string): string {
  return [level, 1, 1, 1, 1, 1, 0, 0, 10, 10, conf, text].join("\t");
}

function tsv(...rows: string[]): Uint8Array {
  return new TextEncoder().encode([HEADER, ...rows].join("\n"));
}

describe("parseTesseractConfidence", () => {
  it("converts from Tesseract's 0-100 scale to the [0, 1] contract", () => {
    // The units trap, named explicitly: 90 and 80 must become 0.85, not 85.
    const result = parseTesseractConfidence(
      tsv(row(5, 90, "hello"), row(5, 80, "world")),
    );
    expect(result?.meanConfidence).toBe(0.85);
    expect(result?.recognizedWords).toBe(2);
  });

  it("survives the round trip into the meta contract", () => {
    // The regression this pairs with: a parser that forgot `/100` would hand 85 to
    // buildOcrResultMeta, which would null it silently. Drive the real path.
    const parsed = parseTesseractConfidence(
      tsv(row(5, 90, "hello"), row(5, 80, "world")),
    )!;
    const meta = buildOcrResultMeta({
      engine: "tesseract",
      languages: ["eng"],
      outputMode: "text",
      producedSearchablePdf: false,
      producedTextSidecar: true,
      ...parsed,
    });
    expect(meta.meanConfidence).toBe(0.85);
    expect(meta.recognizedWords).toBe(2);
  });

  it("rejects a raw 0-100 value that reaches the meta builder", () => {
    // If a future change hands through an unconverted number, this is where it dies —
    // rather than becoming an invisible null in production.
    const meta = buildOcrResultMeta({
      engine: "tesseract",
      languages: ["eng"],
      outputMode: "text",
      producedSearchablePdf: false,
      producedTextSidecar: true,
      meanConfidence: 85,
    });
    expect(meta.meanConfidence).toBeNull();
  });

  it("counts only word rows with a real confidence and real text", () => {
    const result = parseTesseractConfidence(
      tsv(
        row(1, -1, ""), // page
        row(4, -1, ""), // line
        row(5, 100, "  "), // blank word — spacing, not recognition
        row(5, -1, "x"), // no confidence reported
        row(5, 50, "maybe"),
        row(5, 70, "likely"),
      ),
    );
    expect(result?.recognizedWords).toBe(2);
    expect(result?.meanConfidence).toBe(0.6);
  });

  it("reports the share of low-confidence words, not just the average", () => {
    // The mean alone hides shape: a soft-but-correct scan clusters just under the
    // threshold, while a wrong-language run has a long low tail. Same mean, different
    // documents — the ratio is what separates them.
    const result = parseTesseractConfidence(
      tsv(row(5, 95, "a"), row(5, 95, "b"), row(5, 10, "c"), row(5, 20, "d")),
    );
    expect(result?.lowConfidenceWordRatio).toBe(0.5);
    expect(OCR_LOW_CONFIDENCE_WORD_THRESHOLD).toBe(60);
  });

  it("returns null rather than a fabricated score when nothing qualifies", () => {
    for (const bytes of [
      new Uint8Array(0),
      tsv(),
      tsv(row(1, -1, "")),
      new TextEncoder().encode("not a tsv at all"),
    ]) {
      expect(parseTesseractConfidence(bytes)).toBeNull();
    }
  });

  it("never returns the recognized text it read", () => {
    const result = parseTesseractConfidence(
      tsv(row(5, 90, "CONFIDENTIAL-SALARY")),
    );
    expect(JSON.stringify(result)).not.toContain("CONFIDENTIAL");
  });
});

describe("ocrConfidenceLooksLow — a quality signal, never a language verdict", () => {
  const meta = (over: Partial<Parameters<typeof buildOcrResultMeta>[0]>) =>
    buildOcrResultMeta({
      engine: "tesseract",
      languages: ["eng"],
      outputMode: "text",
      producedSearchablePdf: false,
      producedTextSidecar: true,
      ...over,
    });

  it("says nothing at all when there are too few words to mean anything", () => {
    // A five-word receipt read badly is one misread token, not evidence. Staying quiet
    // is the honest answer; a warning here would train users to ignore the warning.
    expect(
      ocrConfidenceLooksLow(
        meta({
          meanConfidence: 0.2,
          lowConfidenceWordRatio: 0.9,
          recognizedWords: 5,
        }),
      ),
    ).toBe(false);
  });

  it("flags a uniformly poor read via the mean", () => {
    expect(
      ocrConfidenceLooksLow(
        meta({
          meanConfidence: 0.55,
          lowConfidenceWordRatio: 0.1,
          recognizedWords: 300,
        }),
      ),
    ).toBe(true);
  });

  it("flags a long low tail the mean would average away", () => {
    // The wrong-language shape: plenty of confident junk plus a heavy low tail. The
    // mean alone clears the bar; the distribution does not.
    expect(
      ocrConfidenceLooksLow(
        meta({
          meanConfidence: 0.78,
          lowConfidenceWordRatio: 0.5,
          recognizedWords: 300,
        }),
      ),
    ).toBe(true);
  });

  it("stays quiet on a healthy read", () => {
    expect(
      ocrConfidenceLooksLow(
        meta({
          meanConfidence: 0.93,
          lowConfidenceWordRatio: 0.04,
          recognizedWords: 300,
        }),
      ),
    ).toBe(false);
  });

  it("stays quiet when nothing was measured, which is every PDF input", () => {
    // OCRmyPDF reports no confidence. Absence must never be read as low confidence —
    // that would put a permanent warning on the most common input the tool takes.
    expect(ocrConfidenceLooksLow(meta({}))).toBe(false);
  });
});

describe("the TSV renderer is requested only where it can be read", () => {
  it("asks Tesseract for a TSV alongside the outputs the user wanted", () => {
    const inv = nativeOcrArgs("tesseract", "tesseract", {
      inputPath: "/tmp/j/input.png",
      workDir: "/tmp/j",
      languages: ["ben", "eng"],
      redoOcr: false,
      wantPdf: true,
      wantText: false,
    });
    // One recognition pass serves every renderer, so this costs serialization only.
    expect(inv.args).toContain("tsv");
    // Compared against the PDF path rather than a literal, so the assertion holds on
    // Windows too — `path.join` picks the host separator.
    expect(inv.tsvOut).toBe(inv.pdfOut.replace(/\.pdf$/, ".tsv"));
  });

  it("asks OCRmyPDF for nothing of the kind", () => {
    // OCRmyPDF owns its own Tesseract sub-invocation and writes into a private temp
    // dir. Reaching into it would be undocumented and version-fragile, and re-OCRing
    // a PDF purely to score it would double the cost of the slowest tool we ship.
    const inv = nativeOcrArgs("ocrmypdf", "ocrmypdf", {
      inputPath: "/tmp/j/input.pdf",
      workDir: "/tmp/j",
      languages: ["eng"],
      redoOcr: false,
      wantPdf: true,
      wantText: true,
    });
    expect(inv.tsvOut).toBeNull();
    expect(inv.args).not.toContain("tsv");
  });
});
