import { describe, expect, it } from "vitest";
import { isLikelyMarkdownFile } from "@/components/tools/runner/markdown-to-pdf-runner";
import { isLikelyTextFile } from "@/components/tools/runner/text-to-pdf-runner";
import {
  EXTRA_MIMES,
  UNSUPPORTED_SIGNS,
  formatOf,
  toolAcceptsFormat,
} from "@/lib/intent/formats";
import {
  EXTENSIONS_BY_FORMAT,
  MIME_BY_FORMAT,
} from "@/lib/jobs/mime-by-format";
import { isLikelyPdf } from "@/lib/pdf/files";
import { isImageAllowedForKind } from "@/lib/pdf/image-to-pdf";
import {
  getRunnerKind,
  supportedToolSlugs,
  type RunnerKind,
} from "@/lib/pdf/registry";
import { getAllToolSlugs, getToolBySlug } from "@/lib/tools";
import { panelDispatchArms } from "@/tests/worker-panel-dispatch";
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

  /*
   * INVERTED in WP-10. This said "reports unsupported for worker/AI tools":
   * ocr-pdf, word-to-pdf and chat-with-pdf mapped to `none`, because a
   * worker panel had no way to take a file it did not upload — so a result
   * could never continue into one, and an encrypted PDF's remedy was a plain
   * link to Unlock that dropped the file. The panels now STAGE a carried
   * file (it waits in the panel; nothing is uploaded until Run), so every
   * panel that takes files takes a hand-off. A tool with no runner and no
   * file input (webpage-to-pdf: a URL) still has nothing to carry into.
   */
  it("reports unsupported for unknown slugs and the URL-only worker tool", () => {
    for (const slug of ["does-not-exist", "webpage-to-pdf"]) {
      expect(handoffCapabilityFor(slug)).toMatchObject({
        mode: "none",
        supported: false,
      });
    }
  });

  it("stages a file for exactly the worker panels that take files (derived both ways)", () => {
    const routed = panelDispatchArms().flatMap((arm) => arm.slugs);
    expect(routed.length).toBeGreaterThanOrEqual(20);
    const takesFiles = routed.filter(
      (slug) =>
        !getToolBySlug(slug)!.accept.every((f) => f.toUpperCase() === "URL"),
    );
    // Health: the URL tool is the one exclusion, and it is in the set.
    expect(routed.length - takesFiles.length).toBe(1);
    const staged = getAllToolSlugs().filter(
      (slug) => handoffCapabilityFor(slug).mode === "stage",
    );
    expect(new Set(staged)).toEqual(new Set(takesFiles));
    for (const slug of staged)
      expect(handoffCapabilityFor(slug)).toMatchObject({
        supported: true,
        minFiles: 1,
        maxFiles: 1,
      });
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
    const heic = { name: "pic.heic", type: "image/heic" };
    // INVERTED. JPG to PDF used to keep only JPEGs and PNG to PDF only PNGs, so
    // "Turn your 5 images into a PDF" handed a mixed set to a tool that
    // silently dropped the other format. Both engines embed both now.
    // INVERTED AGAIN 2026-10-30: the WebP was dropped here until both tools
    // began decoding it; a HEIC is what is dropped now.
    expect(
      eligibleFilesFor("jpg-to-pdf", [pdf, jpg, jpgByExt, png, webp, heic]),
    ).toEqual([jpg, jpgByExt, png, webp]);
    expect(eligibleFilesFor("png-to-pdf", [pdf, jpg, png, webp, heic])).toEqual(
      [jpg, png, webp],
    );
  });

  // WAS `eligibleFilesFor("ocr-pdf", …)` → [], when a worker panel could not
  // take a hand-off. OCR PDF stages one now (WP-10); the URL tool cannot.
  it("returns nothing for a tool that takes no file", () => {
    expect(eligibleFilesFor("webpage-to-pdf", [pdf, pdfByExt])).toEqual([]);
  });

  it("stages a worker panel's file by its accept row", () => {
    expect(eligibleFilesFor("ocr-pdf", [pdf, png, pdfByExt])).toEqual([
      pdf,
      png,
      pdfByExt,
    ]);
    expect(eligibleFilesFor("unlock-pdf", [pdf, png])).toEqual([pdf]);
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
 *
 * THE CORPUS IS DERIVED from the tables that decide what a file is
 * ({@link DERIVED}), with the hand-typed rows kept as an adversarial extra
 * ({@link TYPED}). Until 2026-10-09 it was only the 21 typed rows, while
 * `mime-by-format.ts` told its reader that a WIDER extension list "would
 * carry a file the runner refuses, which capability.test.ts holds" — and it
 * did not: TXT widened to `["txt", "text", "log"]` and PDF to
 * `["pdf", "pdfx"]`, which carries `notes.log` to Text to PDF (its runner
 * refuses it) and `x.pdfx` to every PDF runner, left this file, formats.test.ts
 * and mime-by-format.test.ts green, 117 of 117 (review of WP-03). A typed
 * corpus cannot see a file it does not name.
 *
 * MUTATION, run against the derived corpus on 2026-10-09 (each edit applied
 * to `mime-by-format.ts`, grepped back, then restored from a copy):
 *  - TXT widened to `["txt", "text", "log"]` alone: "carries only files the
 *    receiving runner opens" went red with 30 refusals, `text-to-pdf would
 *    refuse file.log` and `… FILE.LOG`, 15 each (no declared type, and every
 *    type but `text/plain`, which its runner does open);
 *  - with PDF widened to `["pdf", "pdfx"]` as well: 810, the other 780 being
 *    `.pdfx` refused by every PDF runner (`merge-pdf would refuse file.pdfx`…).
 * In both runs "carries exactly the files the tool's accept row names"
 * stayed green, as it must — eligibility still equals the widened accept
 * rule, and only a runner's own check can say the rule is wrong — and so did
 * formats.test.ts and mime-by-format.test.ts: 117 other tests passed.
 */
type FileMeta = { name: string; type: string };

/**
 * One file per thing the tables recognise: every extension in
 * `EXTENSIONS_BY_FORMAT`, lower and upper case, with no declared type and
 * with each type `MIME_BY_FORMAT` knows (its own and every other format's,
 * since a browser's declaration and a name can disagree); one nameless file
 * per type in `MIME_BY_FORMAT` and `EXTRA_MIMES`; and every extension and
 * type the unsupported formats are recognised by.
 */
function derivedCorpus(): FileMeta[] {
  const files: FileMeta[] = [];
  const mimes = [
    ...new Set([
      ...Object.values(MIME_BY_FORMAT).flat(),
      ...Object.keys(EXTRA_MIMES),
    ]),
  ];
  for (const extensions of Object.values(EXTENSIONS_BY_FORMAT)) {
    for (const ext of extensions) {
      for (const name of [`file.${ext}`, `FILE.${ext.toUpperCase()}`]) {
        files.push({ name, type: "" });
        for (const type of mimes) files.push({ name, type });
      }
    }
  }
  for (const type of mimes) files.push({ name: "upload", type });
  for (const signs of Object.values(UNSUPPORTED_SIGNS)) {
    for (const ext of signs.extensions) {
      files.push({ name: `file.${ext}`, type: "" });
      for (const type of signs.mimes) files.push({ name: `file.${ext}`, type });
    }
    for (const type of signs.mimes) files.push({ name: "upload", type });
  }
  return files;
}

const DERIVED = derivedCorpus();

const TYPED: FileMeta[] = [
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

const CORPUS: FileMeta[] = [...DERIVED, ...TYPED];

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
  scan: (file) => isImageAllowedForKind("jpg", file),
  metadata: isLikelyPdf,
  resize: isLikelyPdf,
  "n-up": isLikelyPdf,
  "split-half": isLikelyPdf,
};

const carried = (slug: string, file: { name: string; type: string }) =>
  eligibleFilesFor(slug, [file]).length === 1;

describe("eligibility is derived from the catalogue's accept row", () => {
  it("builds its corpus from the tables, at a plausible size (health)", () => {
    // Measured 2026-10-09: 16 labels, 18 extensions and 15 distinct types
    // (text/x-markdown among them), so 18 x 2 cases x 16 = 576 named files,
    // 15 nameless ones and 54 for the unsupported formats: 645. A corpus that
    // quietly shrinks reports the strongest pass there is; one that
    // explodes is a derivation bug.
    expect(Object.keys(EXTENSIONS_BY_FORMAT).length).toBeGreaterThanOrEqual(
      Object.keys(MIME_BY_FORMAT).length,
    );
    expect(DERIVED.length).toBeGreaterThanOrEqual(600);
    expect(DERIVED.length).toBeLessThanOrEqual(2000);
    // Every recognised extension is in it, so a widened table widens it.
    const names = new Set(DERIVED.map((f) => f.name));
    const missing = Object.values(EXTENSIONS_BY_FORMAT)
      .flat()
      .filter((ext) => !names.has(`file.${ext}`));
    expect(missing).toEqual([]);
  });

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
