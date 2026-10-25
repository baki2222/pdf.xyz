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
const RTL_TEXTS = new Set(
  OCR_LANGUAGE_SAMPLES.filter((s) => s.rtl).map((s) => s.text),
);

/**
 * "PDFs" whose text is the sample words; a scan is the same bytes tagged.
 * By default the searchable PDF's text layer holds right-to-left words
 * REVERSED — what the first in-image run measured — and a DOCX carries the
 * words of whatever it converted.
 */
function stubDeps(
  over: {
    installed?: readonly string[];
    ocrText?: (code: string, words: string) => string;
    rtlLayerInOrder?: boolean;
    docxText?: (words: string) => string;
  } = {},
): { deps: OcrLanguagesProofDeps; lines: string[] } {
  const lines: string[] = [];
  const wordsOf = (html: string) => /<p>(.*)<\/p>/.exec(html)![1]!;
  const ocrText = over.ocrText ?? ((_code, words) => words);
  const layerOf = (text: string) =>
    RTL_TEXTS.has(text) && !over.rtlLayerInOrder ? reversedWords(text) : text;
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
            bytes: enc(`TEXT:${layerOf(text)}`),
          },
          { filename: "a.txt", contentType: "text/plain", bytes: enc(text) },
        ],
      } as unknown as ProcessorResult;
    },
  };
  const docxText = over.docxText ?? ((w: string) => w);
  const pdfToWord: Processor = {
    ...ocr,
    id: "pdf-office-export",
    async process(input): Promise<ProcessorResult> {
      const raw = dec(input.inputs[0]!.bytes);
      // OCR on: the scan's words, through the text layer OCR writes.
      // OCR off: the text layer of the PDF it was given.
      const words = raw.startsWith("SCAN:")
        ? layerOf(raw.slice(5))
        : raw.replace(/^TEXT:/, "");
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
  it("passes the image as measured: every sidecar in order, RTL layers known out of order", async () => {
    const { deps, lines } = stubDeps({ ocrText: honestEngine });
    expect(await runOcrLanguagesProof(deps)).toBe(0);
    expect(lines.at(-1)).toBe("OCR LANGUAGES PROOF: PASS");
    expect(
      lines.some((l) =>
        l.startsWith(
          "PASS POSITIVE CONTROL: Greek read as English fails the verdict: 3 of 3 words missing (καλημερα κοσμε σημερα)",
        ),
      ),
    ).toBe(true);
    for (const s of OCR_LANGUAGE_SAMPLES) {
      expect(
        lines.some(
          (l) => l.startsWith(`PASS ${s.code}`) && l.includes("sidecar"),
        ),
        s.code,
      ).toBe(true);
      // Every offered-to-Word sample reached the DOCX; every withheld one
      // was checked to still be out of order there.
      const docx = s.rtl
        ? (l: string) => l.includes("pdf-to-word is still out of order")
        : (l: string) => l.includes("pdf-to-word (ocr) DOCX");
      expect(
        lines.some((l) => l.startsWith(`PASS ${s.code}`) && docx(l)),
        s.code,
      ).toBe(true);
    }
    expect(
      lines.filter((l) => /REVERSED/.test(l)).length,
      "the verdict names a reversed layer as reversed",
    ).toBeGreaterThan(0);
  });

  it("FAILS once a right-to-left layer reads in order, so the withholding is revisited", async () => {
    const { deps, lines } = stubDeps({
      ocrText: honestEngine,
      rtlLayerInOrder: true,
    });
    expect(await runOcrLanguagesProof(deps)).toBe(1);
    expect(
      lines.filter((l) => l.startsWith("FAIL") && /now reads in order/.test(l)),
    ).toHaveLength(RTL_TEXTS.size * 2);
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

  it("fails a DOCX whose words came back reversed", async () => {
    const greek = sample("ell").text;
    const { deps, lines } = stubDeps({
      ocrText: honestEngine,
      docxText: (w) => (w === greek ? reversedWords(w) : w),
    });
    expect(await runOcrLanguagesProof(deps)).toBe(1);
    expect(
      lines.filter((l) => l.startsWith("FAIL ell pdf-to-word (ocr) DOCX")),
    ).toHaveLength(1);
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
