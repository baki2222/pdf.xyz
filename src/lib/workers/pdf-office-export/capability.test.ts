import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { provesPptxPictures, provesPptxPresentationChain } from "./capability";
import type { runPdfOfficeExport } from "./engine";
import { scanPdfPages, type PdfPageScanner } from "./page-scan";
import { pptxBefore20260927 } from "@/tests/pptx-before-2026-09-27";
import { pptxTextOnly20261010 } from "@/tests/pptx-text-only-2026-10-10";

type Run = typeof runPdfOfficeExport;

/** A stand-in engine that returns whatever package it is given. */
function engineReturning(make: () => Promise<Uint8Array>): Run {
  return async (tool, input) => {
    const output = await make();
    return {
      ok: true,
      output,
      filenameExt: "pptx",
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      meta: {
        engine: "pdftotext-office-openxml",
        tool,
        pageCount: 3,
        inputBytes: input.byteLength,
        outputBytes: output.byteLength,
        characterCount: 0,
      },
      coverage: {
        pageCount: 3,
        textPageCount: 2,
        pagesWithoutText: [2],
        littleTextPageCount: 0,
        pagesWithLittleText: [],
      },
    };
  };
}

const PROBE_PAGES = [
  { pageNumber: 1, text: "Capability probe", characterCount: 16 },
  { pageNumber: 2, text: "", characterCount: 0 },
  { pageNumber: 3, text: "Third page", characterCount: 10 },
];

/** The real engine, with its output rewritten by `edit` before the probe reads it. */
function realEngineThen(edit: (zip: JSZip) => Promise<void>): Run {
  return async (tool, input, deps) => {
    const { runPdfOfficeExport: real } = await import("./engine");
    const run = await real(tool, input, deps);
    if (!run.ok) return run;
    const zip = await JSZip.loadAsync(run.output);
    await edit(zip);
    return {
      ...run,
      output: new Uint8Array(await zip.generateAsync({ type: "uint8array" })),
    };
  };
}

describe("provesPptxPresentationChain", () => {
  it("is true for the engine in this tree", async () => {
    await expect(provesPptxPresentationChain()).resolves.toBe(true);
  });

  it("NEGATIVE CONTROL: is false for the engine as it was before 2026-09-27", async () => {
    // The image that was running when PowerPoint refused every export. If the
    // probe said `true` here, the heartbeat would certify exactly that worker.
    const before = engineReturning(() => pptxBefore20260927(PROBE_PAGES));
    await expect(provesPptxPresentationChain(before)).resolves.toBe(false);
  });

  it("is false when the engine refuses or throws, or the page reader is missing", async () => {
    const refuses: Run = async () => ({
      ok: false,
      kind: "failed",
      message: "no",
    });
    const throws: Run = async () => {
      throw new Error("engine missing");
    };
    await expect(provesPptxPresentationChain(refuses)).resolves.toBe(false);
    await expect(provesPptxPresentationChain(throws)).resolves.toBe(false);
    const noReader: PdfPageScanner = async () => {
      throw new Error("pdf.js has no canvas factory in this environment");
    };
    await expect(
      provesPptxPresentationChain(undefined, noReader),
    ).resolves.toBe(false);
  });

  it("is false for a complete package with the wrong number of slides", async () => {
    // A package that is perfectly valid but is not one slide per page is not
    // what the copy promises either; the count is part of the proof. Until
    // 2026-10-10 the short deck came from a one-page extraction; the slides
    // now follow the page reader, so it is the reader that loses a page.
    const losesAPage: PdfPageScanner = async (bytes, options) => {
      const scan = await scanPdfPages(bytes, options);
      return { ...scan, pageCount: 1, pages: scan.pages.slice(0, 1) };
    };
    await expect(
      provesPptxPresentationChain(undefined, losesAPage),
    ).resolves.toBe(false);
  });
});

describe("provesPptxPictures", () => {
  it("is true for the engine in this tree", async () => {
    await expect(provesPptxPictures()).resolves.toBe(true);
  });

  it("NEGATIVE CONTROL: is false for the text-only deck shipped until 2026-10-10", async () => {
    // What the owner reported: a valid deck, every page's text, no pictures.
    // `provesPptxPresentationChain` passes that deck; this must not.
    const textOnly = engineReturning(() => pptxTextOnly20261010(PROBE_PAGES));
    await expect(provesPptxPresentationChain(textOnly)).resolves.toBe(true);
    await expect(provesPptxPictures(textOnly)).resolves.toBe(false);
  });

  it("is false for a picture moved, rescaled or swapped for other pixels", async () => {
    const moved = realEngineThen(async (zip) => {
      const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
      const next = xml.replace(
        /(<p:pic>[\s\S]*?<a:off x=")(\d+)/,
        (_, head: string, x: string) => `${head}${Number(x) + 12_700 * 20}`,
      );
      expect(next).not.toBe(xml);
      zip.file("ppt/slides/slide1.xml", next);
    });
    const rescaled = realEngineThen(async (zip) => {
      const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
      const next = xml.replace(
        /(<p:pic>[\s\S]*?<a:ext cx=")(\d+)/,
        (_, head: string, cx: string) => `${head}${Number(cx) * 2}`,
      );
      expect(next).not.toBe(xml);
      zip.file("ppt/slides/slide1.xml", next);
    });
    const otherPixels: PdfPageScanner = async (bytes, options) => {
      const scan = await scanPdfPages(bytes, options);
      for (const item of scan.pages[0]!.items)
        if (item.kind === "picture" && item.role === "image") {
          // Same box, a different picture: the probe's 40 × 30 pixels gone.
          const bytes = new Uint8Array(item.media.bytes);
          new DataView(bytes.buffer).setUint32(16, 41);
          item.media = { ...item.media, bytes };
        }
      return scan;
    };
    await expect(provesPptxPictures(moved)).resolves.toBe(false);
    await expect(provesPptxPictures(rescaled)).resolves.toBe(false);
    await expect(provesPptxPictures(undefined, otherPixels)).resolves.toBe(
      false,
    );
  });
});
