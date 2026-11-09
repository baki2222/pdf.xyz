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
 * Remove Annotations REUSES the `metadata` runner kind, so it inherits every
 * table keyed by `getRunnerKind` — rows written for Edit PDF Metadata. Each
 * row is pinned here as a property of THIS tool, beside the reason it is
 * true of it, so a change to the shared row for the other tool's sake is a
 * change this tool's page has to answer for.
 */

const SLUG = "remove-annotations";
const RUNNER_DIR = "src/components/tools/runner";
const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

describe("Remove Annotations' inherited kind rows", () => {
  it("is on the metadata kind", () => {
    expect(getRunnerKind(SLUG)).toBe("metadata");
  });

  it("MODE_BY_KIND: one file — SinglePdfRunner with no batch", () => {
    expect(handoffCapabilityFor(SLUG).mode).toBe("single");
    const editor = read(`${RUNNER_DIR}/remove-annotations-editor.tsx`);
    expect(editor).toMatch(/<SinglePdfRunner\b/);
    expect(editor).not.toMatch(/\bbatch=/);
  });

  it("RUNNER_FILE_CEILINGS: MAX_PDF_BYTES — SinglePdfRunner's own gate", () => {
    expect(RUNNER_FILE_CEILINGS.metadata).toBe(MAX_PDF_BYTES);
    expect(toolFileCeilingBytes(getToolBySlug(SLUG)!)).toBe(MAX_PDF_BYTES);
  });

  it("RUNNER_MID_RUN_FETCHES: none — no pdf.js, no fonts, no network in its modules", () => {
    expect(midRunFetches(SLUG)).toEqual([]);
    expect(runnerReadsWithPdfjs(SLUG)).toBe(false);
    for (const file of [
      `${RUNNER_DIR}/remove-annotations-editor.tsx`,
      "src/lib/pdf/remove-annotations.ts",
      "src/lib/pdf/annotation-groups.ts",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/pdfjs|fetch\(|font-network|noto/i);
    }
  });

  it("PDFJS_READER_KINDS: not a pdf.js reader — restricted PDFs are refused, as pdf-lib refuses /Encrypt", () => {
    expect(PDFJS_READER_KINDS.has("metadata")).toBe(false);
    expect(opensRestrictedPdfs(SLUG)).toBe(false);
    expect(read(`${RUNNER_DIR}/remove-annotations-editor.tsx`)).not.toMatch(
      /reader="pdfjs"/,
    );
  });

  it("runnerFaq: no case for the kind, so no FAQ written for Edit PDF Metadata reaches this page", () => {
    const facts = read("src/lib/tools/tool-facts.ts");
    const body = facts.slice(facts.indexOf("function runnerFaq("));
    expect(body.slice(0, body.indexOf("\n}\n"))).not.toMatch(
      /case\s+"metadata"/,
    );
  });
});
