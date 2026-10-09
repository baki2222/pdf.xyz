import { describe, expect, it } from "vitest";
import { isLikelyMarkdownFile } from "@/components/tools/runner/markdown-to-pdf-runner";
import { isLikelyTextFile } from "@/components/tools/runner/text-to-pdf-runner";
import { formatOf, toolAcceptsFormat } from "@/lib/intent/formats";
import { isLikelyPdf } from "@/lib/pdf/files";
import { isImageAllowedForKind } from "@/lib/pdf/image-to-pdf";
import {
  getRunnerKind,
  supportedToolSlugs,
  type RunnerKind,
} from "@/lib/pdf/registry";
import { getToolBySlug } from "@/lib/tools";
import { eligibleFilesFor, handoffCapabilityFor } from "./capability";

describe("handoffCapabilityFor", () => {
  it("maps merge to collect, compress and image-to-pdf to batch", () => {
    expect(handoffCapabilityFor("merge-pdf")).toMatchObject({
      mode: "collect",
      supported: true,
      minFiles: 2,
    });
    expect(handoffCapabilityFor("compress-pdf")).toMatchObject({
      mode: "batch",
      supported: true,
      minFiles: 1,
    });
    expect(handoffCapabilityFor("jpg-to-pdf")).toMatchObject({
      mode: "batch",
      supported: true,
      minFiles: 1,
    });
    expect(handoffCapabilityFor("compare-pdf")).toMatchObject({
      mode: "collect",
      supported: true,
      minFiles: 2,
    });
  });

  it("maps every single-file runner to single (max one file)", () => {
    for (const slug of [
      "rotate-pdf",
      "organize-pages",
      "split-pdf",
      "remove-pages",
      "extract-pages",
      "pdf-to-text",
      "pdf-to-markdown",
      "text-to-pdf",
      "markdown-to-pdf",
      "pdf-to-jpg",
      "pdf-to-png",
      "page-numbers",
      "watermark-pdf",
      "header-footer",
      "crop-pdf",
      "sign-pdf",
      "flatten-pdf",
      "overlay-pdf",
      "grayscale-pdf",
      "redact-pdf",
      "fill-forms",
      "create-forms",
      "annotate-pdf",
      "edit-pdf",
      "extract-images",
    ]) {
      expect(handoffCapabilityFor(slug)).toMatchObject({
        mode: "single",
        supported: true,
        maxFiles: 1,
      });
    }
  });

  it("reports unsupported for worker/AI tools and unknown slugs", () => {
    for (const slug of [
      "ocr-pdf",
      "word-to-pdf",
      "chat-with-pdf",
      "does-not-exist",
    ]) {
      expect(handoffCapabilityFor(slug)).toMatchObject({
        mode: "none",
        supported: false,
      });
    }
  });
});

describe("eligibleFilesFor", () => {
  const pdf = { name: "a.pdf", type: "application/pdf" };
  const pdfByExt = { name: "b.PDF", type: "" };
  const png = { name: "c.png", type: "image/png" };

  it("keeps only PDFs for a supported PDF tool", () => {
    expect(eligibleFilesFor("merge-pdf", [pdf, png, pdfByExt])).toEqual([
      pdf,
      pdfByExt,
    ]);
  });

  it("keeps only PDFs for the PDF-to-image tools", () => {
    expect(eligibleFilesFor("pdf-to-jpg", [pdf, png, pdfByExt])).toEqual([
      pdf,
      pdfByExt,
    ]);
    expect(eligibleFilesFor("pdf-to-png", [pdf, png, pdfByExt])).toEqual([
      pdf,
      pdfByExt,
    ]);
  });

  it("keeps only text files for text-to-pdf", () => {
    const txt = { name: "notes.txt", type: "text/plain" };
    const textByExt = { name: "readme.TEXT", type: "" };
    expect(eligibleFilesFor("text-to-pdf", [pdf, txt, png, textByExt])).toEqual(
      [txt, textByExt],
    );
  });

  it("keeps Markdown files for markdown-to-pdf", () => {
    const markdown = { name: "README.md", type: "text/markdown" };
    const markdownByExt = { name: "notes.MARKDOWN", type: "" };
    const plainMarkdown = { name: "draft.md", type: "text/plain" };
    const textButWrongExt = { name: "notes.txt", type: "text/plain" };
    expect(
      eligibleFilesFor("markdown-to-pdf", [
        pdf,
        markdown,
        png,
        markdownByExt,
        plainMarkdown,
        textButWrongExt,
      ]),
    ).toEqual([markdown, markdownByExt, plainMarkdown]);
  });

  it("keeps every PNG and JPEG for both image-to-pdf tools", () => {
    const jpg = { name: "photo.jpeg", type: "image/jpeg" };
    const jpgByExt = { name: "scan.JPG", type: "" };
    const webp = { name: "pic.webp", type: "image/webp" };
    // INVERTED. JPG to PDF used to keep only JPEGs and PNG to PDF only PNGs, so
    // "Turn your 5 images into a PDF" handed a mixed set to a tool that
    // silently dropped the other format. Both engines embed both now.
    expect(
      eligibleFilesFor("jpg-to-pdf", [pdf, jpg, jpgByExt, png, webp]),
    ).toEqual([jpg, jpgByExt, png]);
    expect(eligibleFilesFor("png-to-pdf", [pdf, jpg, png, webp])).toEqual([
      jpg,
      png,
    ]);
  });

  it("returns nothing for an unsupported tool", () => {
    expect(eligibleFilesFor("ocr-pdf", [pdf, pdfByExt])).toEqual([]);
  });
});

/**
 * ELIGIBILITY IS THE TOOL'S `accept` ROW, read through one recogniser.
 *
 * WAS: a branch per slug — a regex for Text to PDF, another for Markdown, a
 * MIME list for the two image tools, `isLikelyPdf` for everything else. Each
 * was a second statement of what the catalogue's `accept` already said, and
 * nothing held the two together: a tool whose row changed kept receiving the
 * old files. Measured against the row read through `formatOf`, the branches
 * disagreed on files a browser really produces — a `.md` typed `text/plain`
 * went to Text to PDF (it is Markdown), and a `.docx` declared as a PDF went
 * to every PDF tool.
 *
 * Two properties, both over a corpus that holds every verdict:
 *  1. eligibility IS `toolAcceptsFormat(accept, formatOf(file))` for every
 *     tool with a runner — derived from the registry, not named;
 *  2. a carried file is one that tool's RUNNER opens, by the runner's own
 *     check. The direction that matters: a runner taking a file the hand-off
 *     does not carry costs a pick; the reverse is a refusal on arrival.
 */
const CORPUS: { name: string; type: string }[] = [
  { name: "a.pdf", type: "application/pdf" },
  { name: "b.PDF", type: "" },
  { name: "c", type: "application/pdf" },
  { name: "letter.docx", type: "application/pdf" },
  { name: "photo.jpeg", type: "image/jpeg" },
  { name: "scan.JPG", type: "" },
  { name: "logo.png", type: "image/png" },
  { name: "pic.webp", type: "image/webp" },
  { name: "IMG_1.heic", type: "image/heic" },
  { name: "notes.txt", type: "text/plain" },
  { name: "readme.TEXT", type: "" },
  { name: "README.md", type: "text/markdown" },
  { name: "draft.md", type: "text/plain" },
  { name: "notes.MARKDOWN", type: "" },
  { name: "guide.mdown", type: "" },
  { name: "x", type: "text/x-markdown" },
  { name: "sheet.csv", type: "text/csv" },
  { name: "page.html", type: "text/html" },
  { name: "deck.pptx", type: "" },
  { name: "archive.zip", type: "application/zip" },
  { name: "unknown", type: "" },
];

/**
 * What each runner opens, by its OWN check. Exhaustive over RunnerKind (the
 * type fails to compile when a kind is added without a decision); every PDF
 * runner validates through `validatePdfFile`/`partitionPdfFiles`, whose test
 * is `isLikelyPdf`.
 */
const RUNNER_OPENS: Record<
  RunnerKind,
  (file: { name: string; type: string }) => boolean
> = {
  merge: isLikelyPdf,
  split: isLikelyPdf,
  rotate: isLikelyPdf,
  "delete-pages": isLikelyPdf,
  "extract-pages": isLikelyPdf,
  organize: isLikelyPdf,
  compress: isLikelyPdf,
  "pdf-to-text": isLikelyPdf,
  "pdf-to-markdown": isLikelyPdf,
  "text-to-pdf": isLikelyTextFile,
  "markdown-to-pdf": isLikelyMarkdownFile,
  "image-to-pdf": (file) => isImageAllowedForKind("jpg", file),
  "pdf-to-image": isLikelyPdf,
  "page-numbers": isLikelyPdf,
  watermark: isLikelyPdf,
  "header-footer": isLikelyPdf,
  crop: isLikelyPdf,
  sign: isLikelyPdf,
  flatten: isLikelyPdf,
  overlay: isLikelyPdf,
  grayscale: isLikelyPdf,
  redact: isLikelyPdf,
  "fill-forms": isLikelyPdf,
  "create-forms": isLikelyPdf,
  annotate: isLikelyPdf,
  edit: isLikelyPdf,
  "extract-images": isLikelyPdf,
  compare: isLikelyPdf,
};

const carried = (slug: string, file: { name: string; type: string }) =>
  eligibleFilesFor(slug, [file]).length === 1;

describe("eligibility is derived from the catalogue's accept row", () => {
  it("finds every runner-backed tool, and a corpus that every one of them takes from (health)", () => {
    expect(supportedToolSlugs.length).toBeGreaterThanOrEqual(25);
    const starved = supportedToolSlugs.filter(
      (slug) => !CORPUS.some((file) => carried(slug, file)),
    );
    expect(starved).toEqual([]);
    // And refuses from: no tool takes everything.
    const greedy = supportedToolSlugs.filter((slug) =>
      CORPUS.every((file) => carried(slug, file)),
    );
    expect(greedy).toEqual([]);
  });

  it("carries exactly the files the tool's accept row names, for every runner-backed tool", () => {
    const disagreements = supportedToolSlugs.flatMap((slug) => {
      const accept = getToolBySlug(slug)!.accept;
      return CORPUS.filter(
        (file) =>
          carried(slug, file) !==
          toolAcceptsFormat(accept, formatOf(file).format),
      ).map(
        (file) =>
          `${slug}: ${file.name} (${file.type || "no type"}) is ${carried(slug, file) ? "carried" : "left"}`,
      );
    });
    expect(disagreements).toEqual([]);
  });

  it("carries only files the receiving runner opens, by the runner's own check", () => {
    const refusals = supportedToolSlugs.flatMap((slug) => {
      const opens = RUNNER_OPENS[getRunnerKind(slug)!];
      return CORPUS.filter((file) => carried(slug, file) && !opens(file)).map(
        (file) => `${slug} would refuse ${file.name}`,
      );
    });
    expect(refusals).toEqual([]);
  });

  it("sends a Markdown file typed text/plain to Markdown to PDF, not Text to PDF", () => {
    // The per-slug regexes sent it to both: Text to PDF matched the declared
    // type, Markdown to PDF the name. The name is the more specific claim.
    const draft = { name: "draft.md", type: "text/plain" };
    expect(carried("markdown-to-pdf", draft)).toBe(true);
    expect(carried("text-to-pdf", draft)).toBe(false);
  });
});
