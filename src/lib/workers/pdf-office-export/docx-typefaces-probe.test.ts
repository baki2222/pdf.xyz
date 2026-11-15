// @native-canvas
/**
 * #28 slice 4 (typefaces), added 2026-11-15: `provesDocxTypefaces`, the
 * heartbeat's `docxTypefaces`. The probe PDF (Times, Courier and Helvetica
 * lines) through the real engine, in the executor's order, read back by
 * `./docx-structure`; one negative per way a typeface can be lost or
 * wrong, each shown failing on ITS OWN check through `docxTypefacesProblem`.
 *
 * Only the stand-in extractor runs here (`flowStandIn`); the container step
 * (`worker:docx-tables-proof`, "PDF to Word tables and typefaces proof") is
 * where the image's real poppler answers.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { resolveWorkerArtifactManifest } from "../artifacts";
import { flowPageText } from "../pdf-text/flow";
import { ProcessorRegistry } from "../processor/registry";
import type { Processor } from "../processor/types";
import { resolveWorkerSoundness } from "../soundness";
import {
  DOCX_TYPEFACES_PROBE,
  docxTypefacesProbePdf,
  docxTypefacesProblem,
  provesDocxTypefaces,
} from "./capability";
import { readDocxStructure } from "./docx-structure";
import { PDF_TO_WORD_TOOL, type runPdfOfficeExport } from "./engine";
import { scanPdfPages, type PdfPageScanner } from "./page-scan";

type Run = typeof runPdfOfficeExport;
const PROBE_DEPS = { extractFlow: flowStandIn, scanPages: scanPdfPages };

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

async function probeDocx(run?: Run, deps = PROBE_DEPS) {
  const { runPdfOfficeExport: real } = await import("./engine");
  const pdf = await docxTypefacesProbePdf();
  const out = await (run ?? real)(PDF_TO_WORD_TOOL, pdf, deps);
  if (!out.ok) throw new Error(`${out.kind}: ${out.message}`);
  const flow = await deps.extractFlow(pdf);
  return { docx: out.output, flow };
}

async function problemOf(run?: Run, deps = PROBE_DEPS) {
  const { docx, flow } = await probeDocx(run, deps);
  return docxTypefacesProblem(docx, flow.pages.map(flowPageText));
}

const SWAP = "\u0000";

describe("provesDocxTypefaces", () => {
  it("is true for the engine in this tree, and its check finds nothing", async () => {
    await expect(provesDocxTypefaces(PROBE_DEPS)).resolves.toBe(true);
    await expect(problemOf()).resolves.toBeNull();
  });

  it("health: the probe's page is three lines, one per kind, every word of them in the .docx", async () => {
    const { docx } = await probeDocx();
    const body = await readDocxStructure(docx);
    const words = body.blocks
      .flatMap((b) => (b.kind === "p" ? b.runs : []))
      .flatMap((r) => r.text.split(/\s+/).filter(Boolean));
    const p = DOCX_TYPEFACES_PROBE;
    for (const line of [p.serif, p.mono, p.sans])
      for (const w of line.split(" ")) expect(words, w).toContain(w);
  });

  it("NEGATIVE: every w:rFonts stripped fails on SERIF (the first line checked)", async () => {
    const stripped = editedAfter((xml) =>
      xml.replace(/<w:rFonts [^>]*\/>/g, ""),
    );
    await expect(problemOf(stripped)).resolves.toBe("serif");
    await expect(provesDocxTypefaces(PROBE_DEPS, stripped)).resolves.toBe(
      false,
    );
  });

  it("NEGATIVE: Times New Roman and Courier New swapped fails on SERIF", async () => {
    const swapped = editedAfter((xml) =>
      xml
        .replaceAll("Times New Roman", SWAP)
        .replaceAll("Courier New", "Times New Roman")
        .replaceAll(SWAP, "Courier New"),
    );
    await expect(problemOf(swapped)).resolves.toBe("serif");
  });

  it("NEGATIVE: Courier New written as Consolas fails on MONO, Arial as Helvetica on SANS", async () => {
    await expect(
      problemOf(
        editedAfter((xml) => xml.replaceAll("Courier New", "Consolas")),
      ),
    ).resolves.toBe("mono");
    await expect(
      problemOf(editedAfter((xml) => xml.replaceAll('"Arial"', '"Helvetica"'))),
    ).resolves.toBe("sans");
  });

  it("NEGATIVE: one attribute disagreeing (cs) fails on its line", async () => {
    const cs = editedAfter((xml) =>
      xml.replace(/w:cs="Times New Roman"/, 'w:cs="Mangal"'),
    );
    await expect(problemOf(cs)).resolves.toBe("serif");
  });

  it("NEGATIVE: w:eastAsia added fails on EASTASIA", async () => {
    const east = editedAfter((xml) =>
      xml.replace(/ w:cs="Arial"\/>/, ' w:eastAsia="SimSun" w:cs="Arial"/>'),
    );
    await expect(problemOf(east)).resolves.toBe("eastAsia");
  });

  it("NEGATIVE: w:rFonts moved after w:b fails on STRUCTURE, and the engine itself refuses to deliver it", async () => {
    // The probe's lines are not bold, so give the first run a bold to move
    // rFonts behind.
    const moved = editedAfter((xml) =>
      xml.replace(/<w:rPr>(<w:rFonts [^>]*\/>)/, "<w:rPr><w:b/>$1"),
    );
    await expect(problemOf(moved)).resolves.toBe("structure");
    // The same edit made by the WRITER (the `writeDocx` seam), before the
    // engine's check before delivery: the job is refused, not delivered.
    const { runPdfOfficeExport: real } = await import("./engine");
    const { docxPackage } = await import("./docx-package");
    const movingWriter: Run = (tool, input, deps) =>
      real(tool, input, {
        ...deps,
        writeDocx: async (doc) => {
          const written = await docxPackage(doc);
          const zip = await JSZip.loadAsync(written.bytes);
          const xml = await zip.file("word/document.xml")!.async("string");
          const changed = xml.replace(
            /<w:rPr>(<w:rFonts [^>]*\/>)/,
            "<w:rPr><w:b/>$1",
          );
          if (changed === xml) throw new Error("the edit did not land");
          zip.file("word/document.xml", changed);
          return {
            ...written,
            bytes: new Uint8Array(
              await zip.generateAsync({ type: "uint8array" }),
            ),
          };
        },
      });
    await expect(problemOf(movingWriter)).rejects.toThrow(/incomplete_output/);
    await expect(provesDocxTypefaces(PROBE_DEPS, movingWriter)).resolves.toBe(
      false,
    );
  });

  it("NEGATIVE: a word doubled after the engine's check fails on the TEXT", async () => {
    const doubled = editedAfter((xml) =>
      xml.replace(">Serif ", ">Serif Serif "),
    );
    await expect(problemOf(doubled)).resolves.toBe("text");
  });

  it("is false when the page reader reads no page's text (the matcher is off)", async () => {
    const blind: PdfPageScanner = async (pdf, opts) => {
      const scan = await scanPdfPages(pdf, opts);
      return {
        ...scan,
        pages: scan.pages.map((p) => ({ ...p, textUnread: true as const })),
      };
    };
    await expect(
      provesDocxTypefaces({ ...PROBE_DEPS, scanPages: blind }),
    ).resolves.toBe(false);
  });

  describe("each link of the executor's chain", () => {
    const real = resolveWorkerSoundness({});
    it("POSITIVE CONTROL: a pass-through soundness gate and the daemon's manifest gate say YES", async () => {
      await expect(
        provesDocxTypefaces(PROBE_DEPS, undefined, {
          soundness: { capability: real.capability, check: real.check },
          manifest: resolveWorkerArtifactManifest({}),
        }),
      ).resolves.toBe(true);
    });
    it("is false with a registry that has no PDF to Word", async () => {
      await expect(
        provesDocxTypefaces(PROBE_DEPS, undefined, {
          registry: new ProcessorRegistry(),
        }),
      ).resolves.toBe(false);
    });
    it("is false when the soundness gate refuses the input", async () => {
      await expect(
        provesDocxTypefaces(PROBE_DEPS, undefined, {
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
    it("is false when the manifest gate refuses the artifact (text/plain named .docx)", async () => {
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
        provesDocxTypefaces(PROBE_DEPS, undefined, {
          registry: new ProcessorRegistry().register(mistyped),
        }),
      ).resolves.toBe(false);
      const untouched = new ProcessorRegistry().register({
        ...inner,
        process: (input) => inner.process(input),
      });
      await expect(
        provesDocxTypefaces(PROBE_DEPS, undefined, { registry: untouched }),
      ).resolves.toBe(true);
    });
  });

  it("is false without the page reader, or without the extractor", async () => {
    await expect(
      provesDocxTypefaces({ scanPages: scanPdfPages }),
    ).resolves.toBe(false);
    await expect(
      provesDocxTypefaces({ extractFlow: flowStandIn }),
    ).resolves.toBe(false);
  });
});
