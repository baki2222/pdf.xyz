// @native-canvas
/**
 * #28 slice 2 (tables), added 2026-11-15: `provesDocxTables`, the
 * heartbeat's `docxTables`. The probe PDF through the real engine, in the
 * executor's order, read back by `./docx-structure`; one negative per way a
 * table can be lost, each shown failing on ITS OWN check through
 * `docxTablesProblem` (the reason the probe's verdict stands on).
 *
 * Only the stand-in extractor runs here (`flowStandIn`, which joins every
 * same-baseline item into one line): no capture of the probe through the
 * worker image's poppler exists on this host, and the container step
 * (`worker:docx-tables-proof`) is where real poppler answers.
 */
import { describe, expect, it } from "vitest";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { resolveWorkerArtifactManifest } from "../artifacts";
import { flowPageText, type PdfFlowText } from "../pdf-text/flow";
import { ProcessorRegistry } from "../processor/registry";
import type { Processor } from "../processor/types";
import { resolveWorkerSoundness } from "../soundness";
import {
  DOCX_TABLES_PROBE,
  docxTablesProbePdf,
  docxTablesProblem,
  provesDocxTables,
} from "./capability";
import type { DocxDocument, DocxTableBlock } from "./docx-layout";
import { docxPackage } from "./docx-package";
import { docxPageTexts, readDocxStructure } from "./docx-structure";
import { PDF_TO_WORD_TOOL, type runPdfOfficeExport } from "./engine";
import { scanPdfPages } from "./page-scan";

type Run = typeof runPdfOfficeExport;
const PROBE_DEPS = { extractFlow: flowStandIn, scanPages: scanPdfPages };

/** The real engine with its writer handed `doc` changed by `change`. */
const writing =
  (change: (doc: DocxDocument) => DocxDocument): Run =>
  async (tool, input, deps) => {
    const { runPdfOfficeExport: real } = await import("./engine");
    return real(tool, input, {
      ...deps,
      writeDocx: (doc) => docxPackage(change(doc)),
    });
  };

const eachTable = (
  doc: DocxDocument,
  f: (t: DocxTableBlock) => DocxDocument["pages"][number][number][],
): DocxDocument => ({
  ...doc,
  pages: doc.pages.map((blocks) =>
    blocks.flatMap((b) => (b.kind === "table" ? f(b) : [b])),
  ),
});

/** The probe's .docx through `run` (the engine as is when undefined). */
async function probeDocx(run?: Run, deps = PROBE_DEPS) {
  const { runPdfOfficeExport: real } = await import("./engine");
  const pdf = await docxTablesProbePdf();
  // The engine's own conservation check runs here; a writer change that
  // breaks it fails the JOB, which the probe already reads as false.
  const out = await (run ?? real)(PDF_TO_WORD_TOOL, pdf, deps);
  if (!out.ok) throw new Error(`${out.kind}: ${out.message}`);
  const flow = await deps.extractFlow(pdf);
  return { docx: out.output, flow };
}

async function problemOf(run?: Run, deps = PROBE_DEPS) {
  const { docx, flow } = await probeDocx(run, deps);
  return docxTablesProblem(docx, flow.pages.map(flowPageText));
}

const textOf = (runs: readonly { text: string }[]) =>
  runs.map((r) => r.text).join("");

describe("provesDocxTables", () => {
  it("is true for the engine in this tree, and its check finds nothing", async () => {
    await expect(provesDocxTables(PROBE_DEPS)).resolves.toBe(true);
    await expect(problemOf()).resolves.toBeNull();
  });

  it("health: the probe's page is what the probe expects — one table of the probe's rows", async () => {
    const { docx } = await probeDocx();
    const body = await readDocxStructure(docx);
    const tables = body.blocks.filter((b) => b.kind === "tbl");
    expect(tables).toHaveLength(1);
    expect(DOCX_TABLES_PROBE.rows).toHaveLength(4);
  });

  it("NEGATIVE (a): tables written back as tabbed paragraphs fail on the table's SHAPE", async () => {
    const tabbed = writing((doc) =>
      eachTable(doc, (t) =>
        t.rows.map((r) => {
          const cells = r.slots.flatMap((s) => s ?? []);
          return {
            kind: "text" as const,
            cells: cells.map(textOf),
            runs: cells,
          };
        }),
      ),
    );
    await expect(problemOf(tabbed)).resolves.toBe("shape");
  });

  it("NEGATIVE (b): empty cells dropped and values shifted left fail on the CELLS — and conservation alone passes on that file", async () => {
    const shifted = writing((doc) =>
      eachTable(doc, (t) => [
        {
          ...t,
          rows: t.rows.map((r) => {
            const kept = r.slots.filter((s) => s !== null);
            return {
              slots: [...kept, ...r.slots.map(() => null)].slice(
                0,
                r.slots.length,
              ),
            };
          }),
        },
      ]),
    );
    await expect(problemOf(shifted)).resolves.toBe("cells");
    const { docx, flow } = await probeDocx(shifted);
    expect(docxPageTexts(await readDocxStructure(docx))).toEqual(
      flow.pages.map(flowPageText),
    );
  });

  it("NEGATIVE (c): columns assigned by index (in the flow) fail on the CELLS", async () => {
    const byIndex = async (pdf: Uint8Array): Promise<PdfFlowText> => {
      const flow = await flowStandIn(pdf);
      return {
        ...flow,
        pages: flow.pages.map((p) => ({
          ...p,
          ...(p.tables
            ? {
                tables: p.tables.map((row, i) =>
                  row
                    ? { ...row, col: p.paragraphs[i]!.map((_, c) => c) }
                    : row,
                ),
              }
            : {}),
        })),
      };
    };
    await expect(
      problemOf(undefined, { ...PROBE_DEPS, extractFlow: byIndex }),
    ).resolves.toBe("cells");
    await expect(
      provesDocxTables({ ...PROBE_DEPS, extractFlow: byIndex }),
    ).resolves.toBe(false);
  });

  it("NEGATIVE (d): the header's run properties stripped fail on BOLD", async () => {
    const plain = writing((doc) =>
      eachTable(doc, (t) => [
        {
          ...t,
          rows: t.rows.map((r, k) =>
            k === 0
              ? {
                  slots: r.slots.map(
                    (s) =>
                      s?.map((runs) =>
                        runs.map((x) => ({ ...x, style: null })),
                      ) ?? null,
                  ),
                }
              : r,
          ),
        },
      ]),
    );
    await expect(problemOf(plain)).resolves.toBe("bold");
  });

  it("NEGATIVE (e): a grid collapsed to one column fails on the SHAPE", async () => {
    const collapsed = writing((doc) =>
      eachTable(doc, (t) => [
        {
          ...t,
          columns: [t.columns.reduce((s, w) => s + w, 0)],
          rows: t.rows.map((r) => ({
            slots: [r.slots.flatMap((s) => s ?? [])],
          })),
        },
      ]),
    );
    await expect(problemOf(collapsed)).resolves.toBe("shape");
  });

  /**
   * The stand-in reads the wide-gapped line as two one-cell paragraphs (two
   * blocks, the right half last in reading order), so moving its halves
   * into the table as a row changes the page's text: the ENGINE's own
   * conservation check refuses that job (the probe reads a refused job as
   * false). The table split in two keeps the text and is caught by the
   * probe's SHAPE check.
   */
  it("NEGATIVE (f): the wide-gapped line written as a row of the table fails the job; the table split in two on the SHAPE", async () => {
    const lone: readonly string[] = DOCX_TABLES_PROBE.lone;
    const withLone = writing((doc) => ({
      ...doc,
      pages: doc.pages.map((blocks) => {
        const halves = blocks.filter(
          (b) => b.kind === "text" && lone.includes(b.cells[0]!),
        );
        const table = blocks.find(
          (b): b is DocxTableBlock => b.kind === "table",
        );
        if (halves.length !== 2 || !table) return blocks;
        const row = {
          slots: table.columns.map((_, k) => {
            const half = halves[k];
            return half && half.kind === "text"
              ? [half.runs?.[0] ?? [{ text: half.cells[0]!, style: null }]]
              : null;
          }),
        };
        return blocks
          .filter((b) => !halves.includes(b))
          .map((b) =>
            b === table ? { ...table, rows: [row, ...table.rows] } : b,
          );
      }),
    }));
    // The engine's own conservation check refuses that job before
    // delivery, and the probe reads a refused job as false.
    await expect(problemOf(withLone)).rejects.toThrow(/incomplete_output/);
    await expect(provesDocxTables(PROBE_DEPS, withLone)).resolves.toBe(false);
    const split = writing((doc) =>
      eachTable(doc, (t) => [
        { ...t, rows: t.rows.slice(0, 2) },
        { ...t, rows: t.rows.slice(2) },
      ]),
    );
    await expect(problemOf(split)).resolves.toBe("shape");
  });

  describe("(g) each link of the executor's chain", () => {
    const real = resolveWorkerSoundness({});
    it("POSITIVE CONTROL: a pass-through soundness gate and the daemon's manifest gate say YES", async () => {
      await expect(
        provesDocxTables(PROBE_DEPS, undefined, {
          soundness: { capability: real.capability, check: real.check },
          manifest: resolveWorkerArtifactManifest({}),
        }),
      ).resolves.toBe(true);
    });
    it("is false with a registry that has no PDF to Word", async () => {
      await expect(
        provesDocxTables(PROBE_DEPS, undefined, {
          registry: new ProcessorRegistry(),
        }),
      ).resolves.toBe(false);
    });
    it("is false when the soundness gate refuses the input", async () => {
      await expect(
        provesDocxTables(PROBE_DEPS, undefined, {
          soundness: {
            capability: real.capability,
            check: (input) => ({
              ...real.check(input),
              verdict: "unsound",
              checked: true,
              reason: "unsupported_family",
            }),
          },
        }),
      ).resolves.toBe(false);
    });
    it("is false when the manifest gate refuses the artifact (text/plain named .docx), though its bytes are a good .docx", async () => {
      const { createPdfOfficeExportProcessor } =
        await import("../processor/pdf-office-export");
      const inner = createPdfOfficeExportProcessor(PROBE_DEPS);
      const mistyped: Processor = {
        ...inner,
        async process(input) {
          const result = await inner.process(input);
          if (!result.ok) return result;
          return {
            ...result,
            artifacts: result.artifacts.map((a) => ({
              ...a,
              contentType: "text/plain",
            })),
          };
        },
      };
      await expect(
        provesDocxTables(PROBE_DEPS, undefined, {
          registry: new ProcessorRegistry().register(mistyped),
        }),
      ).resolves.toBe(false);
      // Control: the same wrapper, types untouched, says YES.
      const untouched = new ProcessorRegistry().register({
        ...inner,
        process: (input) => inner.process(input),
      });
      await expect(
        provesDocxTables(PROBE_DEPS, undefined, { registry: untouched }),
      ).resolves.toBe(true);
    });
  });

  it("(h) is false without the page reader, or without the extractor", async () => {
    await expect(provesDocxTables({ scanPages: scanPdfPages })).resolves.toBe(
      false,
    );
    await expect(provesDocxTables({ extractFlow: flowStandIn })).resolves.toBe(
      false,
    );
  });
});
