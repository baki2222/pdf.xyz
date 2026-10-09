// @vitest-environment node
/**
 * The sample PDF is a real PDF with the facts its button promises: three
 * pages, text a reader can select, and a form with two fields — read back
 * through the same probe and ranking the desk uses, so "Fill forms first,
 * for its two fields" is measured, not asserted by whoever built it.
 */
import { describe, expect, it } from "vitest";
import { inspectFormFields } from "@/lib/pdf/forms";
import { probePdf } from "@/lib/pdf/probe";
import { extractPdfText } from "@/lib/pdf/text";
import { renderEvidence } from "./evidence";
import { quickFacts, type FileFacts } from "./facts";
import { rankForFiles } from "./rank";
import { buildSamplePdf, SAMPLE_FIELDS, SAMPLE_PDF_NAME } from "./sample-pdf";
import { buildToolIndex } from "./tool-index";

const NO_CEILING = { maxBytes: Number.MAX_SAFE_INTEGER };
/** pdf.js's legacy build, the one Node runs (as probe.test.ts does). */
const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;

describe("buildSamplePdf", () => {
  it("is a named PDF file", async () => {
    const file = await buildSamplePdf();
    expect(file.name).toBe(SAMPLE_PDF_NAME);
    expect(file.type).toBe("application/pdf");
    const head = new TextDecoder().decode(
      new Uint8Array(await file.slice(0, 5).arrayBuffer()),
    );
    expect(head).toBe("%PDF-");
  });

  it("measures as three pages of text with two form fields", async () => {
    const bytes = new Uint8Array(await (await buildSamplePdf()).arrayBuffer());
    const probe = await probePdf(bytes, NO_CEILING);
    expect(probe).toMatchObject({
      read: "ok",
      lock: "none",
      pages: 3,
      formFields: SAMPLE_FIELDS.length,
    });
    expect(probe.sample).toEqual(["text", "text", "text"]);
    // Independently of the probe: the form reader sees the same two fields.
    const { fields } = await inspectFormFields(bytes);
    expect(fields.map((f) => f.name).sort()).toEqual(
      SAMPLE_FIELDS.map((f) => f.name).sort(),
    );
  });

  it("its words are selectable text, read back by the text extractor", async () => {
    const bytes = new Uint8Array(await (await buildSamplePdf()).arrayBuffer());
    const { pageCount, pages } = await extractPdfText(bytes, legacy);
    expect(pageCount).toBe(3);
    expect(pages[0]!.text).toContain("A sample document");
    expect(pages[1]!.text).toContain("A second page of text");
  });

  it("the desk ranks Fill forms first for it, on its two fields", async () => {
    const file = await buildSamplePdf();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const facts: FileFacts = {
      ...quickFacts(file, "s"),
      bytes: "PDF",
      pdf: { state: "checked", probe: await probePdf(bytes, NO_CEILING) },
    };
    const { top } = rankForFiles([facts], buildToolIndex());
    expect(top[0]!.slug).toBe("fill-forms");
    expect(top[0]!.evidence.map(renderEvidence)).toContain(
      `${SAMPLE_PDF_NAME} has ${SAMPLE_FIELDS.length} form fields`,
    );
  });
});
