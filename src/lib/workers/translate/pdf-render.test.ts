// @vitest-environment node
/**
 * `renderTranslationPdf`: every way the print can go wrong is a typed reason,
 * and the per-job conservation check withholds a PDF that lost text.
 *
 * MUTATION (2026-11-15, on a scratchpad copy restored by `cp` and compared by
 * `cmp`): replacing the `sameCodePoints(...)` condition with `false` turned
 * "a PDF missing a block is withheld" red, and nothing else.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { AttemptAbortedError } from "../attempt-abort";
import type { ChromiumPackageRunner } from "../html-render/engine";
import type { TranslationPart } from "./assembly";
import {
  renderTranslationPdf,
  sameCodePoints,
  TRANSLATE_PDF_PRODUCER,
  type PdfTextReader,
} from "./pdf-render";
import { typesetText, type TypesetInput } from "./typeset";

const PARTS: TranslationPart[] = [
  { kind: "body", pages: [1], text: "# Bonjour\n\nPremier bloc." },
  { kind: "body", pages: [2], text: "Second bloc, qui doit survivre." },
];
const INPUT: TypesetInput = { parts: PARTS, target: "fr", sourceName: "a.pdf" };

async function blankPdf(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return doc.save();
}

const chromiumReturning = (
  make: () => Promise<Uint8Array[]>,
): ChromiumPackageRunner => ({ renderPackage: () => make() });

const faithful: PdfTextReader = async () => typesetText(INPUT);

describe("renderTranslationPdf", () => {
  it("prints, stamps the metadata, and passes conservation", async () => {
    const pdf = await blankPdf(2);
    const result = await renderTranslationPdf({
      chromium: chromiumReturning(async () => [pdf]),
      readBack: faithful,
      input: INPUT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toBe(2);
    // `updateMetadata: false`, or pdf-lib stamps itself as producer on load.
    const reread = await PDFDocument.load(result.bytes, {
      updateMetadata: false,
    });
    expect(reread.getProducer()).toBe(TRANSLATE_PDF_PRODUCER);
    expect(reread.getTitle()).toBe("a.pdf");
  });

  it("a renderer that throws is render_failed", async () => {
    const result = await renderTranslationPdf({
      chromium: chromiumReturning(async () => {
        throw new Error("Chromium HTML rendering failed: crash");
      }),
      readBack: faithful,
      input: INPUT,
    });
    expect(result).toEqual({ ok: false, reason: "render_failed" });
  });

  it("a renderer that reports its own deadline is timeout", async () => {
    const err = new Error("rendering timed out after 60 s");
    err.name = "RenderTimeoutError";
    const result = await renderTranslationPdf({
      chromium: chromiumReturning(async () => {
        throw err;
      }),
      readBack: faithful,
      input: INPUT,
    });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("a renderer that never answers is timeout at the bound it was given", async () => {
    const started = Date.now();
    const result = await renderTranslationPdf({
      chromium: chromiumReturning(() => new Promise(() => {})),
      readBack: faithful,
      input: INPUT,
      timeoutMs: 20,
    });
    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  // 2026-11-15, review r1: the deadline used to bound `chromium.renderPackage`
  // ALONE. The pdf-lib metadata pass and the `pdftotext` read-back ran after
  // it, bounded only by the reader's own 120 s timeout, so the PDF stage could
  // take ~180 s while the browser's wait added 60 s for it. A read-back that
  // never answered left this promise pending forever — the test below was red
  // on that code. One deadline now covers the whole stage.
  it("the deadline bounds the WHOLE stage: a read-back that never answers is timeout", async () => {
    const pdf = await blankPdf(1);
    let readSignal: AbortSignal | undefined;
    const started = Date.now();
    const result = await renderTranslationPdf({
      chromium: chromiumReturning(async () => [pdf]),
      readBack: (_bytes, run) => {
        readSignal = run?.signal;
        return new Promise<string>(() => {});
      },
      input: INPUT,
      timeoutMs: 50,
    });
    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(5_000);
    // The reader's child is killed, not left running past the stage.
    expect(readSignal?.aborted).toBe(true);
  });

  it("the stage deadline is not an attempt abort: no attempt signal, still timeout", async () => {
    // The stage aborts its own children at the deadline; their AbortError must
    // read as the deadline, never be rethrown as a lost lease.
    const pdf = await blankPdf(1);
    const result = await renderTranslationPdf({
      chromium: chromiumReturning(async () => [pdf]),
      readBack: (_bytes, run) =>
        new Promise<string>((_, reject) => {
          run?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
      input: INPUT,
      timeoutMs: 30,
    });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("an attempt abort during the read-back is rethrown, not classified", async () => {
    const pdf = await blankPdf(1);
    const attempt = new AbortController();
    await expect(
      renderTranslationPdf({
        chromium: chromiumReturning(async () => [pdf]),
        readBack: (_bytes, run) =>
          new Promise<string>((_, reject) => {
            run?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
            attempt.abort();
          }),
        input: INPUT,
        signal: attempt.signal,
      }),
    ).rejects.toBeInstanceOf(AttemptAbortedError);
  });

  it("oversize bytes are too_large", async () => {
    const pdf = await blankPdf(1);
    const result = await renderTranslationPdf({
      chromium: chromiumReturning(async () => [pdf]),
      readBack: faithful,
      input: INPUT,
      maxOutputBytes: 10,
    });
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("more than one printed part is render_failed", async () => {
    const pdf = await blankPdf(1);
    const result = await renderTranslationPdf({
      chromium: chromiumReturning(async () => [pdf, pdf]),
      readBack: faithful,
      input: INPUT,
    });
    expect(result).toEqual({ ok: false, reason: "render_failed" });
  });

  it("a PDF missing a block is withheld as not_conserved", async () => {
    const pdf = await blankPdf(1);
    const lossy: PdfTextReader = async () =>
      typesetText(INPUT).replace("Second bloc, qui doit survivre.", "");
    const result = await renderTranslationPdf({
      chromium: chromiumReturning(async () => [pdf]),
      readBack: lossy,
      input: INPUT,
    });
    expect(result).toEqual({ ok: false, reason: "not_conserved" });
  });

  it("a reader that fails is not_conserved, never a pass", async () => {
    const pdf = await blankPdf(1);
    const result = await renderTranslationPdf({
      chromium: chromiumReturning(async () => [pdf]),
      readBack: async () => {
        throw new Error("pdftotext exited 1");
      },
      input: INPUT,
    });
    expect(result).toEqual({ ok: false, reason: "not_conserved" });
  });

  it("an attempt abort is rethrown, not classified", async () => {
    await expect(
      renderTranslationPdf({
        chromium: chromiumReturning(async () => {
          throw new AttemptAbortedError();
        }),
        readBack: faithful,
        input: INPUT,
      }),
    ).rejects.toBeInstanceOf(AttemptAbortedError);
  });
});

describe("sameCodePoints", () => {
  it("ignores whitespace and format characters, and normalises to NFC", () => {
    expect(sameCodePoints("a b\nc", "abc")).toBe(true);
    expect(sameCodePoints(`a${String.fromCharCode(0x200d)}b`, "ab")).toBe(true);
    // U+09CB vs U+09C7 U+09BE: the same Bengali vowel sign, two spellings.
    expect(
      sameCodePoints(
        String.fromCharCode(0x0995, 0x09cb),
        String.fromCharCode(0x0995, 0x09c7, 0x09be),
      ),
    ).toBe(true);
  });

  it("counts, so a duplicated or a missing character is a difference", () => {
    expect(sameCodePoints("aab", "ab")).toBe(false);
    expect(sameCodePoints("ab", "abb")).toBe(false);
    expect(sameCodePoints("ab", "ba")).toBe(true);
  });
});
