import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handoffCapabilityFor } from "@/lib/handoff/capability";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import {
  PDFJS_READER_KINDS,
  getRunnerKind,
  opensRestrictedPdfs,
} from "@/lib/pdf/registry";
import { getToolBySlug } from "@/lib/tools";
import { RUNNER_FILE_CEILINGS, toolFileCeilingBytes } from "./file-ceilings";
import { midRunFetches, runnerReadsWithPdfjs } from "./tool-facts";

/**
 * Edit PDF Bookmarks REUSES the `metadata` runner kind (with Edit PDF
 * Metadata and Remove Annotations), so it inherits every table keyed by
 * `getRunnerKind` — rows written for another tool. Each row is pinned here
 * as a property of THIS tool, beside the reason it is true of it, so a
 * change to the shared row for a sibling's sake is a change this page has
 * to answer for:
 *
 *  - MODE_BY_KIND `single`: one PDF in, through SinglePdfRunner, no batch.
 *  - RUNNER_FILE_CEILINGS `MAX_PDF_BYTES`: SinglePdfRunner's own gate.
 *  - RUNNER_MID_RUN_FETCHES `[]`: v1 reads and writes with pdf-lib only —
 *    no thumbnails, no headings, so no pdf.js, fonts or network. A later
 *    "from headings" feature needs pdf.js, and with it its own kind or a
 *    per-slug override; this test goes red first.
 *  - PDFJS_READER_KINDS: not a pdf.js reader, so a restricted (encrypted)
 *    PDF is refused, as pdf-lib refuses /Encrypt.
 *  - runnerFaq: no `metadata` case, so no FAQ written for a sibling.
 *  - output-honesty's kind walk and tool-page-content's runnerFileForKind
 *    read `metadata-runner.tsx`: one `<SinglePdfRunner>` (one input) and no
 *    archive — both true here, a PDF in and a PDF out.
 */

const SLUG = "edit-pdf-bookmarks";
const RUNNER_DIR = "src/components/tools/runner";
const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), rel), "utf8");
const PANEL = [
  `${RUNNER_DIR}/bookmarks-host.tsx`,
  `${RUNNER_DIR}/bookmarks-editor.tsx`,
];

describe("Edit PDF Bookmarks' inherited kind rows", () => {
  it("is on the metadata kind, mounted by slug inside MetadataRunner", () => {
    expect(getRunnerKind(SLUG)).toBe("metadata");
    expect(read(`${RUNNER_DIR}/metadata-runner.tsx`)).toMatch(
      /slug === "edit-pdf-bookmarks"\)\s*\{\s*return <BookmarksRunner \/>/,
    );
  });

  it("MODE_BY_KIND: one file — SinglePdfRunner with no batch", () => {
    expect(handoffCapabilityFor(SLUG).mode).toBe("single");
    const host = read(PANEL[0]!);
    expect(host).toMatch(/<SinglePdfRunner\b/);
    expect(host).not.toMatch(/\bbatch=/);
  });

  it("RUNNER_FILE_CEILINGS: MAX_PDF_BYTES — SinglePdfRunner's own gate", () => {
    expect(RUNNER_FILE_CEILINGS.metadata).toBe(MAX_PDF_BYTES);
    expect(toolFileCeilingBytes(getToolBySlug(SLUG)!)).toBe(MAX_PDF_BYTES);
  });

  it("RUNNER_MID_RUN_FETCHES: none — no pdf.js, no fonts, no network in its modules", () => {
    expect(midRunFetches(SLUG)).toEqual([]);
    expect(runnerReadsWithPdfjs(SLUG)).toBe(false);
    for (const file of [
      ...PANEL,
      "src/lib/pdf/bookmarks.ts",
      "src/lib/pdf/bookmark-tree.ts",
      "src/lib/pdf/bookmark-labels.ts",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /pdfjs|fetch\(|font-network|noto|use-page-image/i,
      );
    }
  });

  it("PDFJS_READER_KINDS: not a pdf.js reader — restricted PDFs are refused, as pdf-lib refuses /Encrypt", () => {
    expect(PDFJS_READER_KINDS.has("metadata")).toBe(false);
    expect(opensRestrictedPdfs(SLUG)).toBe(false);
    for (const file of PANEL) {
      expect(read(file), file).not.toMatch(/reader="pdfjs"/);
    }
  });

  it("runnerFaq: no case for the kind, so no FAQ written for a sibling reaches this page", () => {
    const facts = read("src/lib/tools/tool-facts.ts");
    const body = facts.slice(facts.indexOf("function runnerFaq("));
    expect(body.slice(0, body.indexOf("\n}\n"))).not.toMatch(
      /case\s+"metadata"/,
    );
  });

  it("the dispatcher's module for the kind takes one file and makes no archive", () => {
    const host = read(`${RUNNER_DIR}/metadata-runner.tsx`);
    expect(host.match(/<SinglePdfRunner\b/g)).toHaveLength(1);
    for (const file of [`${RUNNER_DIR}/metadata-runner.tsx`, ...PANEL]) {
      expect(read(file), file).not.toMatch(/zipFiles|useZipDownload/);
    }
  });
});
