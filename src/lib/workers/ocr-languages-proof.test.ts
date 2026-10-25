// @vitest-environment node
/**
 * The in-image OCR languages proof must be able to FAIL on each thing it
 * claims to check — a pack the image lacks, a word OCR dropped, and the
 * defect right-to-left text is prone to: words that come back reversed or out
 * of reading order. Run here on stubs, since this machine has no Tesseract;
 * the real engines are only in the image (`pnpm worker:ocr-languages-proof`).
 */
import { describe, expect, it } from "vitest";
import { OCR_LANGUAGE_CODES } from "@/lib/jobs/ocr";
import {
  OCR_LANGUAGE_SAMPLES,
  parseListLangs,
  runOcrLanguagesProof,
  sampleVerdict,
  type OcrLanguagesProofDeps,
} from "./ocr-languages-proof";
import type { Processor, ProcessorResult } from "./processor/types";

const sample = (code: string) =>
  OCR_LANGUAGE_SAMPLES.find((s) => s.code === code)!;

/** Each word's characters reversed: what a visual-order text layer yields. */
const reversedWords = (t: string) =>
  t
    .split(" ")
    .map((w) => [...w].reverse().join(""))
    .join(" ");

describe("sampleVerdict", () => {
  it("passes the words in order, with layout noise around them", () => {
    const heb = sample("heb");
    expect(sampleVerdict(heb, `\n${heb.text}\n\f`).ok).toBe(true);
    expect(sampleVerdict(sample("ell"), "ΚΑΛΗΜΕΡΑ κοσμε, σημερα.").ok).toBe(
      true,
    );
  });

  it("fails RTL words reversed, and words out of reading order", () => {
    const ara = sample("ara");
    expect(sampleVerdict(ara, reversedWords(ara.text)).ok).toBe(false);
    const backwards = ara.text.split(" ").reverse().join(" ");
    const verdict = sampleVerdict(ara, backwards);
    expect(verdict).toMatchObject({ ok: false });
    expect(verdict.detail).toMatch(/not in reading order/);
  });

  it("fails a missing word, naming how many", () => {
    const tam = sample("tam");
    const two = tam.text.split(" ").slice(0, 2).join(" ");
    expect(sampleVerdict(tam, two).detail).toMatch(/^1 of 3 words missing/);
  });

  it("compares an unspaced script by its run of characters", () => {
    const zh = sample("chi_tra");
    expect(sampleVerdict(zh, "繁 體 中 文 測 試").ok).toBe(true);
    // The Simplified spelling of the same words is not the Traditional text.
    expect(sampleVerdict(zh, "繁体中文测试").ok).toBe(false);
  });

  it("every sample is an offered language, and the set is not trivially small", () => {
    expect(OCR_LANGUAGE_SAMPLES.length).toBeGreaterThanOrEqual(10);
    for (const s of OCR_LANGUAGE_SAMPLES)
      expect(OCR_LANGUAGE_CODES).toContain(s.code);
    expect(OCR_LANGUAGE_SAMPLES.filter((s) => s.rtl).length).toBeGreaterThan(1);
  });
});

describe("parseListLangs", () => {
  it("reads Tesseract's listing, header and osd excluded", () => {
    const out =
      'List of available languages in "/usr/share/tesseract-ocr/5/tessdata/" (3):\neng\nosd\nchi_tra\n';
    expect(parseListLangs(out)).toEqual(["eng", "chi_tra"]);
  });
});

// ── the proof, on stubs ─────────────────────────────────────────────────────

const enc = (t: string) => new TextEncoder().encode(t);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** A "PDF" whose text is the sample words; a scan is the same bytes tagged. */
function stubDeps(
  over: {
    installed?: readonly string[];
    ocrText?: (code: string, words: string) => string;
    docxText?: (words: string) => string;
  } = {},
): { deps: OcrLanguagesProofDeps; lines: string[] } {
  const lines: string[] = [];
  const wordsOf = (html: string) => /<p>(.*)<\/p>/.exec(html)![1]!;
  const ocrText = over.ocrText ?? ((code, words) => words);
  const ocr: Processor = {
    id: "ocr",
    tools: ["ocr-pdf"],
    supports: () => true,
    capability: () => ({
      id: "ocr",
      tools: ["ocr-pdf"],
      ready: true,
      detail: "",
    }),
    async process(input): Promise<ProcessorResult> {
      const words = dec(input.inputs[0]!.bytes).replace(/^SCAN:/, "");
      const code = (input.options.languages as string[])[0]!;
      const text = ocrText(code, words);
      return {
        ok: true,
        artifacts: [
          {
            filename: "a.pdf",
            contentType: "application/pdf",
            bytes: enc(`TEXT:${text}`),
          },
          { filename: "a.txt", contentType: "text/plain", bytes: enc(text) },
        ],
        results: undefined,
      } as unknown as ProcessorResult;
    },
  };
  const docxText = over.docxText ?? ((w: string) => w);
  const pdfToWord: Processor = {
    ...ocr,
    id: "pdf-office-export",
    async process(input): Promise<ProcessorResult> {
      const words = dec(input.inputs[0]!.bytes).replace(/^SCAN:/, "");
      return {
        ok: true,
        artifacts: [
          {
            filename: "a.docx",
            contentType: "application/zip",
            bytes: enc(docxText(words)),
          },
        ],
      } as unknown as ProcessorResult;
    },
  };
  return {
    lines,
    deps: {
      listLangs: async () =>
        `List of available languages:\n${(over.installed ?? OCR_LANGUAGE_CODES).join("\n")}\nosd\n`,
      renderHtml: async (html) => enc(`TEXT:${wordsOf(dec(html))}`),
      scan: async (typed) => enc(`SCAN:${dec(typed).replace(/^TEXT:/, "")}`),
      // A typed page or OCR output has text; a scan has none.
      pdfText: async (pdf) =>
        dec(pdf).startsWith("TEXT:") ? dec(pdf).slice(5) : "",
      ocr,
      pdfToWord,
      docxText: async (d) => dec(d),
      log: (l) => lines.push(l),
    },
  };
}

/** English "reads" Greek as Latin lookalikes; every right pack reads it. */
const honestEngine = (code: string, words: string) =>
  code === "eng" ? "Kaliuepa koaue anuepa" : words;

describe("runOcrLanguagesProof", () => {
  it("passes when every pack is listed and every sample reads back in order", async () => {
    const { deps, lines } = stubDeps({ ocrText: honestEngine });
    expect(await runOcrLanguagesProof(deps)).toBe(0);
    expect(lines.at(-1)).toBe("OCR LANGUAGES PROOF: PASS");
    expect(lines).toContain(
      "PASS POSITIVE CONTROL: Greek read as English fails the verdict: 3 of 3 words missing (καλημερα κοσμε σημερα); 3 words read",
    );
    // Each sample reached all three readers.
    for (const s of OCR_LANGUAGE_SAMPLES)
      expect(
        lines.some((l) => l.startsWith(`PASS ${s.code}`) && l.includes("DOCX")),
        s.code,
      ).toBe(true);
  });

  it("fails a pack the image does not list, by name", async () => {
    const { deps, lines } = stubDeps({
      ocrText: honestEngine,
      installed: OCR_LANGUAGE_CODES.filter((c) => c !== "tel"),
    });
    expect(await runOcrLanguagesProof(deps)).toBe(1);
    expect(lines).toContain(
      "FAIL every offered language is installed: missing tel",
    );
  });

  it("fails a DOCX whose right-to-left words came back reversed", async () => {
    const rtl = new Set(
      OCR_LANGUAGE_SAMPLES.filter((s) => s.rtl).map((s) => s.text),
    );
    const { deps, lines } = stubDeps({
      ocrText: honestEngine,
      docxText: (w) => (rtl.has(w) ? reversedWords(w) : w),
    });
    expect(await runOcrLanguagesProof(deps)).toBe(1);
    expect(
      lines.filter((l) => /^FAIL .*\(rtl\) pdf-to-word \(ocr\) DOCX/.test(l)),
    ).toHaveLength(rtl.size);
  });

  it("fails when the wrong-language control READS the words — the verdict is then blind", async () => {
    const { deps, lines } = stubDeps({ ocrText: (_c, w) => w });
    expect(await runOcrLanguagesProof(deps)).toBe(1);
    expect(lines.some((l) => l.startsWith("FAIL POSITIVE CONTROL"))).toBe(true);
  });

  it("is 2 (cannot conclude), never a pass, without Tesseract or Chromium", async () => {
    const none = stubDeps({ ocrText: honestEngine });
    none.deps.listLangs = async () => null;
    expect(await runOcrLanguagesProof(none.deps)).toBe(2);
    const noChromium = stubDeps({ ocrText: honestEngine });
    noChromium.deps.renderHtml = null;
    expect(await runOcrLanguagesProof(noChromium.deps)).toBe(2);
  });
});
