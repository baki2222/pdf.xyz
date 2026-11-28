// @native-canvas
/**
 * Audit wave 2 pdf-to-word#2 (2026-11-28): `provesDocxTextTables`, the
 * heartbeat's `docxTextTables`. A table with no column of figures (a staff
 * list of names, departments and offices) was always written as tabbed
 * rows; it is now one Word table, and a numbered list of short steps on the
 * same page is still not one.
 *
 * Read at the point of consumption: the .docx is unzipped and
 * `word/document.xml` is parsed here for its `w:tbl`, `w:tr` and `w:tc`
 * elements and each cell's text, independently of `./docx-structure`
 * (which the probe itself reads with).
 *
 * Only the stand-in extractor runs here (`flowStandIn`): the worker image's
 * poppler answers in the daemon's start-up probe, and that proof is owed
 * after the publish workflow ships the image.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { flowPageText, type PdfFlowText } from "../pdf-text/flow";
import {
  DOCX_TEXT_TABLES_PROBE,
  docxTextTablesProbePdf,
  docxTextTablesProblem,
  provesDocxTextTables,
} from "./capability";
import { PDF_TO_WORD_TOOL, runPdfOfficeExport } from "./engine";
import { scanPdfPages } from "./page-scan";

const PROBE_DEPS = { extractFlow: flowStandIn, scanPages: scanPdfPages };

async function probeDocx(deps = PROBE_DEPS) {
  const pdf = await docxTextTablesProbePdf();
  const out = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, deps);
  if (!out.ok) throw new Error(`${out.kind}: ${out.message}`);
  const flow = await deps.extractFlow(pdf);
  return { docx: out.output, flow };
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Each top-level `w:tbl` of document.xml as rows of cell texts. */
async function tablesInDocumentXml(docx: Uint8Array): Promise<string[][][]> {
  const zip = await JSZip.loadAsync(docx);
  const xml = await zip.file("word/document.xml")!.async("string");
  const textOf = (frag: string) =>
    [...frag.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
      .map((m) => decode(m[1]!))
      .join("");
  return [...xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].map((t) =>
    [...t[1]!.matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)].map((r) =>
      [...r[1]!.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((c) =>
        textOf(c[1]!),
      ),
    ),
  );
}

describe("provesDocxTextTables (pdf-to-word#2)", () => {
  it("is true for the engine in this tree, and its check finds nothing", async () => {
    await expect(provesDocxTextTables(PROBE_DEPS)).resolves.toBe(true);
    const { docx, flow } = await probeDocx();
    await expect(
      docxTextTablesProblem(docx, flow.pages.map(flowPageText)),
    ).resolves.toBeNull();
  });

  it("document.xml holds ONE w:tbl of 5 rows x 3 cells, each the page's text; the list and its heading stay outside it", async () => {
    const { docx } = await probeDocx();
    const tables = await tablesInDocumentXml(docx);
    // Health: the parser sees tables at all (a blind regex reports []).
    expect(tables.length).toBeGreaterThan(0);
    expect(tables).toEqual([DOCX_TEXT_TABLES_PROBE.rows.map((r) => [...r])]);
    const zip = await JSZip.loadAsync(docx);
    const xml = await zip.file("word/document.xml")!.async("string");
    const outside = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, "");
    for (const step of DOCX_TEXT_TABLES_PROBE.steps)
      expect(outside).toContain(step);
    expect(outside).toContain(DOCX_TEXT_TABLES_PROBE.sentence);
  });

  it("NEGATIVE: an extractor that finds no table (an older image's tabbed rows) fails on the SHAPE, and the probe answers false", async () => {
    const noTables = async (pdf: Uint8Array): Promise<PdfFlowText> => {
      const flow = await flowStandIn(pdf);
      return {
        ...flow,
        pages: flow.pages.map((p) => ({
          ...p,
          ...(p.tables ? { tables: p.tables.map(() => undefined) } : {}),
        })),
      };
    };
    const deps = { ...PROBE_DEPS, extractFlow: noTables };
    const { docx, flow } = await probeDocx(deps);
    await expect(
      docxTextTablesProblem(docx, flow.pages.map(flowPageText)),
    ).resolves.toBe("shape");
    await expect(provesDocxTextTables(deps)).resolves.toBe(false);
  });

  it("NEGATIVE: no extractor or no page reader answers false", async () => {
    await expect(
      provesDocxTextTables({ ...PROBE_DEPS, extractFlow: undefined }),
    ).resolves.toBe(false);
    await expect(
      provesDocxTextTables({ ...PROBE_DEPS, scanPages: undefined }),
    ).resolves.toBe(false);
  });
});
