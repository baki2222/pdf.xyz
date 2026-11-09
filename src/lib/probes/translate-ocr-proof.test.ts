// @vitest-environment node
// @native-canvas
/**
 * The "translate-pdf (ocr, scan)" proof must be able to FAIL (a proof that
 * cannot fail is a comment): on a missing word, on OCR that did not run for
 * the scan, and on OCR that DID run for the typed control. And the harness
 * must declare what the panel sends: nothing for a scan, the count for a
 * typed page — made the way the script makes it (a Buffer, the default
 * extractor).
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { JobResults } from "@/lib/jobs/results";
import { imageOnlyPdf, textPdf } from "@/tests/pdf-text-fixtures";
import { browserTranslateOcrDeclaration } from "./ai-proof-declaration";
import { TRANSLATE_OCR_PROOF_SPECS } from "@/tests/ai-proof-specs";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import {
  AI_DELIVERY_LIMITS,
  aiReservationGiven,
} from "@/lib/jobs/delivery-cap";
import {
  TRANSLATE_OCR_PROOF_SENTENCES,
  TRANSLATE_OCR_PROOF_WORDS,
  translateOcrProofVerdict,
} from "./translate-ocr-proof";

async function zipOf(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("translation.txt", text);
  return zip.generateAsync({ type: "uint8array" });
}

const GOOD =
  "The dog sleeps in the garden. The cat drinks cold milk. The bicycle in front of the house is red.";
const OCR_RAN = { ocr: { languages: ["deu"] } } as unknown as JobResults;

describe("translateOcrProofVerdict", () => {
  it("passes the scan run: every word, and OCR on the record", async () => {
    const v = await translateOcrProofVerdict(await zipOf(GOOD), OCR_RAN, "ran");
    expect(v.ok, v.detail).toBe(true);
  });

  it("passes the control: every word, and NO OCR on the record", async () => {
    const v = await translateOcrProofVerdict(
      await zipOf(GOOD),
      undefined,
      "skipped",
    );
    expect(v.ok, v.detail).toBe(true);
  });

  it.each(TRANSLATE_OCR_PROOF_WORDS)(
    "fails when %s is missing (OCR in the wrong language reads as gibberish)",
    async (word) => {
      const text = GOOD.replace(new RegExp(word, "gi"), "xxxx");
      const v = await translateOcrProofVerdict(
        await zipOf(text),
        OCR_RAN,
        "ran",
      );
      expect(v.ok).toBe(false);
      expect(v.detail).toContain(word);
    },
  );

  it("fails the scan run when the record says no OCR ran", async () => {
    const v = await translateOcrProofVerdict(await zipOf(GOOD), {}, "ran");
    expect(v.ok).toBe(false);
  });

  it("fails the control when OCR ran on a typed page", async () => {
    const v = await translateOcrProofVerdict(
      await zipOf(GOOD),
      OCR_RAN,
      "skipped",
    );
    expect(v.ok).toBe(false);
  });

  it("fails a package with no translation.txt", async () => {
    const zip = new JSZip();
    zip.file("README.txt", GOOD);
    const v = await translateOcrProofVerdict(
      await zip.generateAsync({ type: "uint8array" }),
      OCR_RAN,
      "ran",
    );
    expect(v.ok).toBe(false);
  });

  it("the page holds German, not the English it is judged by", () => {
    const words = TRANSLATE_OCR_PROOF_SENTENCES.join(" ")
      .toLowerCase()
      .split(/[^a-zäöüß]+/);
    expect(words.length).toBeGreaterThan(10);
    for (const word of TRANSLATE_OCR_PROOF_WORDS)
      expect(words).not.toContain(word);
  });
});

describe("browserTranslateOcrDeclaration, made as the harness makes it", () => {
  it("a scan goes undeclared, as the panel sends it", async () => {
    const bytes = Buffer.from(await imageOnlyPdf(1));
    const verdict = await browserTranslateOcrDeclaration(bytes);
    expect(verdict).toEqual({ kind: "declared", declaration: {} });
  }, 60_000);

  it("control: a typed page is declared with its count", async () => {
    const bytes = Buffer.from(await textPdf([800]));
    const verdict = await browserTranslateOcrDeclaration(bytes);
    expect(verdict.kind).toBe("declared");
    if (verdict.kind === "declared")
      expect(verdict.declaration.declaredCharacters).toBeGreaterThan(500);
  }, 60_000);
});

describe("the translate-ocr proof group, as the harness runs it", () => {
  it("has its two specs: the scan and the typed control (health)", () => {
    expect(TRANSLATE_OCR_PROOF_SPECS.map((s) => s.label)).toEqual([
      "translate-pdf (ocr, scan)",
      "translate-pdf (ocr requested, typed page: control)",
    ]);
  });

  it("the scan fixture IS a scan to the browser (undeclared), the control is typed (counted), and the group fits one day", async () => {
    let total = 0;
    for (const spec of TRANSLATE_OCR_PROOF_SPECS) {
      const bytes = Buffer.from(await spec.make());
      const verdict = await browserTranslateOcrDeclaration(bytes);
      expect(verdict.kind, JSON.stringify(verdict)).toBe("declared");
      if (verdict.kind !== "declared") return;
      if (spec.label!.includes("(ocr, scan)"))
        expect(verdict.declaration).toEqual({});
      else expect(verdict.declaration.declaredCharacters).toBeGreaterThan(50);
      total += aiReservationGiven(
        spec.tool,
        { ...verdict.declaration, options: spec.options },
        AI_DELIVERY_LIMITS,
        false,
      ).charge;
    }
    expect(total).toBeLessThanOrEqual(AI_CHARACTER_ALLOWANCE);
  }, 120_000);
});
