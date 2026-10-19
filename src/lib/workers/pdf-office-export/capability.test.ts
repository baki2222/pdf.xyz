// @native-canvas
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  docxProbePdf,
  provesDocxPictures,
  provesPptxPictures,
  provesPptxPresentationChain,
} from "./capability";
import {
  movePictureDown,
  movePictureUp,
  replacePictureMedia,
  stretchFirstPicture,
} from "@/tests/docx-hand-built";
import { docxTextOnly20261017 } from "@/tests/docx-text-only-2026-10-17";
import { noPictures } from "@/tests/page-scan-stubs";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import type { runPdfOfficeExport } from "./engine";
import { scanPdfPages, type PdfPageScanner } from "./page-scan";
import { encodePngImage } from "./png-encode";
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

/**
 * A BLANK PICTURE IS NOT THE PICTURE. Until 2026-10-11 this probe read the
 * delivered image's PNG signature and its IHDR width and height, and
 * nothing else: the review zeroed every re-encoded picture's pixels in the
 * encoder (a 40 × 30 PNG, every byte 0) and the probe still said `true`, as
 * did the production verdict and the whole local suite. The picture is now
 * decoded and its two colours sampled.
 */
describe("provesPptxPictures decodes the picture", () => {
  const blanking =
    (layout: "rgba8" | "rgb8"): PdfPageScanner =>
    async (bytes, options) => {
      const scan = await scanPdfPages(bytes, options);
      for (const item of scan.pages[0]!.items)
        if (item.kind === "picture" && item.role === "image") {
          const { pixelWidth: w, pixelHeight: h } = item.media;
          // Same box, same pixel size, same format: no colour in it.
          const samples = new Uint8Array(w * h * (layout === "rgba8" ? 4 : 3));
          item.media = {
            ...item.media,
            bytes: encodePngImage(w, h, layout, samples),
            ext: "png",
          };
        }
      return scan;
    };

  it("NEGATIVE CONTROL: false when the picture is a transparent PNG of the same size", async () => {
    await expect(
      provesPptxPictures(undefined, blanking("rgba8")),
    ).resolves.toBe(false);
  });

  it("NEGATIVE CONTROL: false when the picture is a black PNG of the same size", async () => {
    await expect(provesPptxPictures(undefined, blanking("rgb8"))).resolves.toBe(
      false,
    );
  });
});

/**
 * THE WORD PROBE (2026-10-17). The question production answered "no" to —
 * the owner's 37 pictures, none in the .docx — asked of the running image.
 * Here poppler's reading order is stood in for (`@/tests/poppler-flow-standin`,
 * in poppler's frame); the daemon passes the image's own extractor.
 */
describe("provesDocxPictures", () => {
  /** The job's deps as these tests stand them in: poppler's order, the real reader. */
  const PROBE_DEPS = { extractFlow: flowStandIn, scanPages: scanPdfPages };
  /** The real engine, with the .docx it wrote rewritten by `edit`. */
  const wordThen =
    (edit: (docx: Uint8Array) => Promise<Uint8Array>): Run =>
    async (tool, input, deps) => {
      const { runPdfOfficeExport: real } = await import("./engine");
      const run = await real(tool, input, deps);
      if (!run.ok) return run;
      return { ...run, output: await edit(run.output) };
    };

  it("is true for the engine in this tree", async () => {
    await expect(
      provesDocxPictures({ extractFlow: flowStandIn, scanPages: scanPdfPages }),
    ).resolves.toBe(true);
  });

  it("NEGATIVE CONTROL: is false for the text-only .docx shipped until 2026-10-17", async () => {
    const textOnly = wordThen(async () =>
      docxTextOnly20261017((await flowStandIn(await docxProbePdf())).pages),
    );
    await expect(provesDocxPictures(PROBE_DEPS, textOnly)).resolves.toBe(false);
  });

  it("is false for a picture moved below its caption or above its heading, rescaled, or swapped for other pixels", async () => {
    await expect(
      provesDocxPictures(PROBE_DEPS, wordThen(movePictureDown)),
    ).resolves.toBe(false);
    // Each side of the picture is asked: the mutation check of 2026-10-17
    // removed the "after the line above" half and only this control saw it.
    await expect(
      provesDocxPictures(PROBE_DEPS, wordThen(movePictureUp)),
    ).resolves.toBe(false);
    await expect(
      provesDocxPictures(PROBE_DEPS, wordThen(stretchFirstPicture)),
    ).resolves.toBe(false);
    // Same place, same size, same format: a black PNG of the probe's size.
    const black = encodePngImage(40, 30, "rgb8", new Uint8Array(40 * 30 * 3));
    await expect(
      provesDocxPictures(
        PROBE_DEPS,
        wordThen((docx) => replacePictureMedia(docx, 0, black)),
      ),
    ).resolves.toBe(false);
  });

  /**
   * The review of 2026-10-17: the probe was handed the image's extractor
   * and ran the module's own page reader, with no limits — so it could
   * answer `true` for an image whose jobs, run on the worker's deps, have no
   * page reader (and answer `unsupported`), or a budget that leaves the
   * picture out. It now takes the job's deps whole.
   */
  it("runs the engine on the job's OWN deps — the same object, limits and all", async () => {
    const deps = {
      extractFlow: flowStandIn,
      scanPages: scanPdfPages,
      limits: { maxOutputBytes: 10_000_000 },
    };
    const seen: unknown[] = [];
    const spy: Run = async (tool, input, given) => {
      seen.push(given);
      const { runPdfOfficeExport: real } = await import("./engine");
      return real(tool, input, given);
    };
    await expect(provesDocxPictures(deps, spy)).resolves.toBe(true);
    expect(seen).toEqual([deps]);
    expect(seen[0]).toBe(deps);
    // A job whose deps leave the picture out cannot be called proven.
    await expect(
      provesDocxPictures({ ...deps, limits: { maxPictures: 0 } }),
    ).resolves.toBe(false);
    // Nor one whose deps have no page reader (its jobs answer unsupported).
    await expect(
      provesDocxPictures({ extractFlow: flowStandIn }),
    ).resolves.toBe(false);
  });

  it("is false without the text extractor, or with a page reader that finds no picture", async () => {
    await expect(provesDocxPictures({ scanPages: scanPdfPages })).resolves.toBe(
      false,
    );
    await expect(
      provesDocxPictures({ extractFlow: flowStandIn, scanPages: noPictures }),
    ).resolves.toBe(false);
  });
});
