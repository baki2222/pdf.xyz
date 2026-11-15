// @native-canvas
/**
 * #28 slice 3 (wraps), added 2026-11-16: `provesDocxTableWraps`, the
 * heartbeat's `docxTableWraps`. The probe PDF through the real engine, in
 * the executor's order, read back by `./docx-structure`; one negative per
 * way a wrapped cell can be lost, each shown failing on ITS OWN check
 * through `docxTableWrapsProblem` (the reason the probe's verdict stands on).
 *
 * Two extractors, both asserted: the stand-in (`flowStandIn`) and the
 * worker image's poppler (22.12.0), through its capture of this very page
 * (`IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX`). The image is the one users receive;
 * the stand-in's grouping is not poppler's (slice 2's stand-in predicted 1
 * table where the image printed 0), so a verdict on the stand-in alone
 * would certify a grouping no user gets.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX } from "@/tests/poppler-samples-image";
import { resolveWorkerArtifactManifest } from "../artifacts";
import {
  flowPageText,
  flowText,
  type FlowPiece,
  type PdfFlowText,
  type PdfFlowTextPage,
} from "../pdf-text/flow";
import { parseBboxFlow } from "../pdf-text/parse";
import { ProcessorRegistry } from "../processor/registry";
import type { Processor } from "../processor/types";
import { resolveWorkerSoundness } from "../soundness";
import {
  DOCX_TABLE_WRAPS_PROBE,
  docxTableWrapsProbePdf,
  docxTableWrapsProblem,
  docxTableWrapsSourceWords,
  provesDocxTables,
  provesDocxTableWraps,
} from "./capability";
import type { DocxDocument, DocxTableBlock } from "./docx-layout";
import { docxPackage } from "./docx-package";
import { docxPageTexts, readDocxStructure } from "./docx-structure";
import {
  PDF_TO_WORD_TOOL,
  type PdfOfficeExportDeps,
  type runPdfOfficeExport,
} from "./engine";
import { scanPdfPages } from "./page-scan";

type Run = typeof runPdfOfficeExport;
type Extract = NonNullable<PdfOfficeExportDeps["extractFlow"]>;

const imageFlow = (): PdfFlowText =>
  flowText(parseBboxFlow(IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX));

const STAND_IN = { extractFlow: flowStandIn, scanPages: scanPdfPages };
const IMAGE = {
  extractFlow: (async () => imageFlow()) as Extract,
  scanPages: scanPdfPages,
};
const EXTRACTORS = [
  ["the stand-in", STAND_IN],
  ["the image's poppler (S1 capture)", IMAGE],
] as const;

const B200 = "Replacement pump and housing";
const B200_WRAP = "assembly for model X";
const TOTAL = DOCX_TABLE_WRAPS_PROBE.total;

/** The probe's .docx through `run` (the engine as is when undefined). */
async function probeDocx(run?: Run, deps: PdfOfficeExportDeps = IMAGE) {
  const { runPdfOfficeExport: real } = await import("./engine");
  const pdf = await docxTableWrapsProbePdf();
  const out = await (run ?? real)(PDF_TO_WORD_TOOL, pdf, deps);
  if (!out.ok) throw new Error(`${out.kind}: ${out.message}`);
  const flow = await deps.extractFlow!(pdf);
  return { docx: out.output, flow };
}

async function problemOf(run?: Run, deps: PdfOfficeExportDeps = IMAGE) {
  const { docx, flow } = await probeDocx(run, deps);
  return docxTableWrapsProblem(docx, flow.pages.map(flowPageText));
}

/* ---- flow edits: the defects a FLOW could carry, both sides of check 2 moving together ---- */

interface Para {
  paragraph: readonly string[];
  box?: PdfFlowTextPage["boxes"] extends (infer B)[] | undefined ? B : never;
  pieces?: FlowPiece[][];
  table?: NonNullable<PdfFlowTextPage["tables"]>[number];
}

const paraAt = (page: PdfFlowTextPage, i: number): Para => ({
  paragraph: page.paragraphs[i]!,
  ...(page.boxes ? { box: page.boxes[i]! } : {}),
  ...(page.pieces ? { pieces: page.pieces[i]! } : {}),
  table: page.tables?.[i],
});

/** `page` with paragraph `i` (and its parallel entries) replaced by `items`. */
function spliced(
  page: PdfFlowTextPage,
  i: number,
  remove: number,
  ...items: Para[]
): PdfFlowTextPage {
  const paragraphs = [...page.paragraphs];
  paragraphs.splice(i, remove, ...items.map((x) => x.paragraph));
  const out: PdfFlowTextPage = { ...page, paragraphs };
  if (page.boxes) {
    const boxes = [...page.boxes];
    boxes.splice(i, remove, ...items.map((x) => x.box!));
    out.boxes = boxes;
  }
  if (page.pieces) {
    const pieces = [...page.pieces];
    pieces.splice(i, remove, ...items.map((x) => x.pieces!));
    out.pieces = pieces;
  }
  if (page.tables) {
    const tables = [...page.tables];
    tables.splice(i, remove, ...items.map((x) => x.table));
    out.tables = tables;
  }
  return out;
}

/** A cell's pieces cut after its first `n` words; the tail's head separator dropped so each side concatenates to its text. */
function cutPieces(pieces: readonly FlowPiece[], n: number) {
  const head = pieces.slice(0, n);
  const tail = pieces
    .slice(n)
    .map((p, k) => (k === 0 ? { ...p, text: p.text.replace(/^\s+/, "") } : p));
  const text = (xs: readonly FlowPiece[]) => xs.map((p) => p.text).join("");
  return { head, tail, headText: text(head), tailText: text(tail) };
}

const rowIndex = (page: PdfFlowTextPage, cell: string) => {
  const i = page.paragraphs.findIndex((p) => p[1]?.startsWith(cell));
  if (i < 0) throw new Error(`no row whose Description starts "${cell}"`);
  return i;
};
const totalIndex = (page: PdfFlowTextPage) => {
  const i = page.paragraphs.findIndex((p) => p.length === 1 && p[0] === TOTAL);
  if (i < 0) throw new Error("the total is not a paragraph of its own");
  return i;
};

/** The image's flow with page 1 changed by `edit`. */
const editedFlow =
  (edit: (page: PdfFlowTextPage) => PdfFlowTextPage): Extract =>
  async () => {
    const flow = imageFlow();
    return { ...flow, pages: [edit(flow.pages[0]!), ...flow.pages.slice(1)] };
  };

/** Row B-200's continuation cut out of its cell, returned with the edited row. */
function withoutB200Wrap(page: PdfFlowTextPage) {
  const i = rowIndex(page, B200);
  const row = paraAt(page, i);
  const words = B200.split(" ").length;
  const cut = cutPieces(row.pieces![1]!, words);
  expect(cut.headText).toBe(B200);
  expect(cut.tailText).toBe(B200_WRAP);
  const kept: Para = {
    ...row,
    paragraph: row.paragraph.map((c, k) => (k === 1 ? cut.headText : c)),
    pieces: row.pieces!.map((c, k) => (k === 1 ? cut.head : c)),
  };
  return { i, row, kept, cut };
}

/* ---- writer edits ---- */

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
  f: (t: DocxTableBlock) => DocxTableBlock,
): DocxDocument => ({
  ...doc,
  pages: doc.pages.map((blocks) =>
    blocks.map((b) => (b.kind === "table" ? f(b) : b)),
  ),
});

/** The real engine, its .docx's document.xml rewritten AFTER its own check. */
const editedAfter =
  (edit: (xml: string) => string): Run =>
  async (tool, input, deps) => {
    const { runPdfOfficeExport: real } = await import("./engine");
    const run = await real(tool, input, deps);
    if (!run.ok) return run;
    const zip = await JSZip.loadAsync(run.output);
    const xml = await zip.file("word/document.xml")!.async("string");
    const changed = edit(xml);
    if (changed === xml) throw new Error("the edit did not land");
    zip.file("word/document.xml", changed);
    return {
      ...run,
      output: new Uint8Array(await zip.generateAsync({ type: "uint8array" })),
    };
  };

describe("provesDocxTableWraps (#28 slice 3)", () => {
  for (const [name, deps] of EXTRACTORS) {
    it(`is true for the engine in this tree on ${name}, and its check finds nothing`, async () => {
      await expect(provesDocxTableWraps(deps)).resolves.toBe(true);
      await expect(problemOf(undefined, deps)).resolves.toBeNull();
    });
  }

  it("slice 2's probe stays true beside it (its page has no wrap, so nothing is absorbed there)", async () => {
    await expect(provesDocxTables(STAND_IN)).resolves.toBe(true);
  });

  it("health: on the image's poppler the probe's page is one table of 5 rows, the total outside it", async () => {
    const { docx } = await probeDocx();
    const body = await readDocxStructure(docx);
    const tables = body.blocks.filter((b) => b.kind === "tbl");
    expect(tables).toHaveLength(1);
    expect(tables[0]!.kind === "tbl" && tables[0]!.rows).toHaveLength(5);
    expect(DOCX_TABLE_WRAPS_PROBE.rows).toHaveLength(5);
    expect(imageFlow().pages[0]!.wrapLines).toBe(3);
    // The source bound's own corpus is the page's words, not empty.
    expect(docxTableWrapsSourceWords()).toHaveLength(31);
  });

  it("health: the S1 capture REACHES flow rule 4 — the continuation is the next line in the four-word line's poppler block", () => {
    const layout = parseBboxFlow(IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX);
    const lineText = (l: { words: { text: string }[] }) =>
      l.words.map((w) => w.text).join(" ");
    const block = layout.pages[0]!.blocks.find((b) =>
      b.lines.some((l) => lineText(l) === B200),
    );
    expect(block, "no poppler block holds the four-word line").toBeDefined();
    const lines = block!.lines.map(lineText);
    expect(lines[lines.indexOf(B200) + 1]).toBe(B200_WRAP);
  });

  it("NEGATIVE (a): continuations emitted as rows of their own (empty slots beside them) fail on the SHAPE", async () => {
    const asRows = editedFlow((page) => {
      const { i, row, kept, cut } = withoutB200Wrap(page);
      return spliced(page, i, 1, kept, {
        paragraph: [cut.tailText],
        ...(row.box ? { box: row.box } : {}),
        pieces: [cut.tail],
        table: { ...row.table!, col: [1] },
      });
    });
    await expect(
      problemOf(undefined, { ...IMAGE, extractFlow: asRows }),
    ).resolves.toBe("shape");
  });

  it("NEGATIVE (b): continuations left outside the table as lines (absorption off) fail on the SHAPE", async () => {
    const off: Extract = async () =>
      flowText(parseBboxFlow(IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX), {
        absorbWraps: false,
      });
    await expect(
      problemOf(undefined, { ...IMAGE, extractFlow: off }),
    ).resolves.toBe("shape");
    await expect(
      provesDocxTableWraps({ ...IMAGE, extractFlow: off }),
    ).resolves.toBe(false);
  });

  it("NEGATIVE (c): a continuation absorbed into the row BELOW fails on the CELLS", async () => {
    const below = editedFlow((page) => {
      const { i, kept, cut } = withoutB200Wrap(page);
      const next = paraAt(page, i + 1);
      const moved: Para = {
        ...next,
        paragraph: next.paragraph.map((c, k) =>
          k === 1 ? `${c} ${cut.tailText}` : c,
        ),
        pieces: next.pieces!.map((c, k) =>
          k === 1
            ? [
                ...c,
                ...cut.tail.map((p, j) =>
                  j === 0 ? { ...p, text: ` ${p.text}` } : p,
                ),
              ]
            : c,
        ),
      };
      return spliced(page, i, 2, kept, moved);
    });
    await expect(
      problemOf(undefined, { ...IMAGE, extractFlow: below }),
    ).resolves.toBe("cells");
  });

  it("NEGATIVE (d): the total absorbed into D-400's Amount fails on the CELLS", async () => {
    const intoAmount = editedFlow((page) => {
      const t = totalIndex(page);
      const total = paraAt(page, t);
      const d = rowIndex(page, "Gasket");
      const row = paraAt(page, d);
      const joined: Para = {
        ...row,
        paragraph: row.paragraph.map((c, k) => (k === 2 ? `${c} ${TOTAL}` : c)),
        pieces: row.pieces!.map((c, k) =>
          k === 2
            ? [
                ...c,
                ...total.pieces![0]!.map((p) => ({
                  ...p,
                  text: ` ${p.text.trim()}`,
                })),
              ]
            : c,
        ),
      };
      expect(t).toBeGreaterThan(d);
      return spliced(spliced(page, t, 1), d, 1, joined);
    });
    await expect(
      problemOf(undefined, { ...IMAGE, extractFlow: intoAmount }),
    ).resolves.toBe("cells");
  });

  it("NEGATIVE (e): an absorbed cell written as two w:p fails on the CELLS — and through the engine the job is refused as incomplete_output", async () => {
    const splitCell = (doc: DocxDocument): DocxDocument =>
      eachTable(doc, (t) => ({
        ...t,
        rows: t.rows.map((row) => ({
          slots: row.slots.map((slot) => {
            const text = slot?.[0]?.map((r) => r.text).join("") ?? "";
            if (!text.startsWith(`${B200} `)) return slot;
            return [
              [{ text: B200, style: null }],
              [{ text: text.slice(B200.length + 1), style: null }],
            ];
          }),
        })),
      }));
    // Through the engine: its own conservation check refuses the job.
    await expect(problemOf(writing(splitCell))).rejects.toThrow(
      /incomplete_output/,
    );
    await expect(provesDocxTableWraps(IMAGE, writing(splitCell))).resolves.toBe(
      false,
    );
    // The same file handed to the probe's check with ITS OWN text (so the
    // text check passes): the cells check alone refuses it.
    let written: DocxDocument | null = null;
    await probeDocx(
      writing((doc) => {
        written = doc;
        return doc;
      }),
    );
    const { bytes: docx } = await docxPackage(splitCell(written!));
    const ownText = docxPageTexts(await readDocxStructure(docx));
    await expect(docxTableWrapsProblem(docx, ownText)).resolves.toBe("cells");
  });

  it("NEGATIVE (f): the header's run properties stripped fail on BOLD", async () => {
    const plain = writing((doc) =>
      eachTable(doc, (t) => ({
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
      })),
    );
    await expect(problemOf(plain)).resolves.toBe("bold");
  });

  describe("(g) each link of the executor's chain", () => {
    const real = resolveWorkerSoundness({});
    it("POSITIVE CONTROL: a pass-through soundness gate and the daemon's manifest gate say YES", async () => {
      await expect(
        provesDocxTableWraps(IMAGE, undefined, {
          soundness: { capability: real.capability, check: real.check },
          manifest: resolveWorkerArtifactManifest({}),
        }),
      ).resolves.toBe(true);
    });
    it("is false with a registry that has no PDF to Word", async () => {
      await expect(
        provesDocxTableWraps(IMAGE, undefined, {
          registry: new ProcessorRegistry(),
        }),
      ).resolves.toBe(false);
    });
    it("is false when the soundness gate refuses the input", async () => {
      await expect(
        provesDocxTableWraps(IMAGE, undefined, {
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
      const inner = createPdfOfficeExportProcessor(IMAGE);
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
        provesDocxTableWraps(IMAGE, undefined, {
          registry: new ProcessorRegistry().register(mistyped),
        }),
      ).resolves.toBe(false);
      const untouched = new ProcessorRegistry().register({
        ...inner,
        process: (input) => inner.process(input),
      });
      await expect(
        provesDocxTableWraps(IMAGE, undefined, { registry: untouched }),
      ).resolves.toBe(true);
    });
  });

  it("(h) is false without the page reader, or without the extractor", async () => {
    await expect(
      provesDocxTableWraps({ scanPages: scanPdfPages }),
    ).resolves.toBe(false);
    await expect(
      provesDocxTableWraps({ extractFlow: IMAGE.extractFlow }),
    ).resolves.toBe(false);
  });

  it("NEGATIVE (i): a file Word could refuse (table properties out of schema order) fails on the STRUCTURE", async () => {
    const disordered = editedAfter((xml) =>
      xml.replace(
        /<w:tblPr>(<w:tblW [^>]*\/>)(<w:tblBorders>.*?<\/w:tblBorders>)/,
        "<w:tblPr>$2$1",
      ),
    );
    await expect(problemOf(disordered)).resolves.toBe("structure");
  });

  it("NEGATIVE (j): a word doubled outside the table after the engine's check fails on the TEXT", async () => {
    const doubled = editedAfter((xml) =>
      xml.replace(`>${TOTAL}<`, `>${TOTAL} ${TOTAL}<`),
    );
    await expect(problemOf(doubled)).resolves.toBe("text");
  });

  /**
   * (k) and (l) are defects INSIDE flow: the .docx and `flowPageText` both
   * come from the one flow, so check 2 compares a doubled word with a
   * doubled word. The precondition shows checks 1-5 pass on the very input
   * (the probe's own check run with check 6 disarmed would be null), so
   * check 6 is the only check that sees either.
   */
  async function checksOneToFive(extractFlow: Extract) {
    const { docx, flow } = await probeDocx(undefined, {
      ...IMAGE,
      extractFlow,
    });
    const body = await readDocxStructure(docx);
    expect(docxPageTexts(body)).toEqual(flow.pages.map(flowPageText));
    const tables = body.blocks.filter((b) => b.kind === "tbl");
    expect(tables).toHaveLength(1);
    expect(tables[0]!.kind === "tbl" && tables[0]!.rows).toHaveLength(5);
    return docxTableWrapsProblem(docx, flow.pages.map(flowPageText));
  }

  it("NEGATIVE (k): an absorbed continuation emitted in its cell AND again as a paragraph fails on the SOURCE — and only there", async () => {
    const doubled = editedFlow((page) => {
      const i = rowIndex(page, B200);
      const row = paraAt(page, i);
      const t = totalIndex(page);
      const pieces = cutPieces(row.pieces![1]!, B200.split(" ").length);
      return spliced(page, t, 0, {
        paragraph: [B200_WRAP],
        ...(row.box ? { box: row.box } : {}),
        pieces: [pieces.tail],
        table: undefined,
      });
    });
    await expect(checksOneToFive(doubled)).resolves.toBe("source");
    await expect(
      provesDocxTableWraps({ ...IMAGE, extractFlow: doubled }),
    ).resolves.toBe(false);
  });

  it("NEGATIVE (l): flow dropping the total line fails on the SOURCE — and only there", async () => {
    const dropped = editedFlow((page) => spliced(page, totalIndex(page), 1));
    await expect(checksOneToFive(dropped)).resolves.toBe("source");
    await expect(
      provesDocxTableWraps({ ...IMAGE, extractFlow: dropped }),
    ).resolves.toBe(false);
  });
});
