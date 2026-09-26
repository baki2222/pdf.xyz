// @vitest-environment node
/**
 * A tool page's own content is true of the tool, and it leads somewhere.
 *
 * ── THE DEFECTS THIS WAS BUILT ON (audit at 67e8d0f, re-verified at 001c258) ──
 *
 * Twelve tool pages were thin in the way that costs a reader: the page either
 * told them to go elsewhere and gave them no link, or described a workflow the
 * tool does not have, or said nothing the code could stand behind.
 *
 *   compare-pdf     "scanned pages need OCR first" — twice — and no link to OCR
 *                   PDF; its HowTo said "pick your PDF file" for a TWO-file
 *                   tool; and not one other tool page linked to it.
 *   overlay-pdf     HowTo "pick your PDF file" for a base PDF plus an overlay
 *                   PDF; title and H1 "Overlay / Stamp", without the head term.
 *   jpg/png-to-pdf  HowTo "pick your JPG, JPEG file" for a runner that takes
 *                   many images — the same default-template defect, unflagged.
 *   edit-pdf        says it cannot change existing text, and linked neither
 *                   PDF to Word nor Redact PDF, the two tools that do.
 *   pdf-to-excel, pdf-to-powerpoint, pdf-to-markdown
 *                   FAQ "Run the file through OCR PDF first" with OCR PDF
 *                   outside the three related tiles a reader can see.
 *   how-to-compress-a-pdf
 *                   lists Optimize for Web and Grayscale PDF in `tools` (so
 *                   both tool pages link the guide) and never mentions either.
 *   header-footer, optimize-web
 *                   title and H1 "Header & Footer" / "Optimize for Web".
 *
 * ── THE RELATIONSHIPS, NOT THE STRINGS ──────────────────────────────────────
 *
 * No tool slug below is typed as a subject. The link rules walk the whole
 * catalogue and every guide. The multi-file rule DISCOVERS its tools through
 * the dispatch the page mounts (registry kind → tool-runner switch → module)
 * and counts the file inputs the runner renders. The per-tool answers are
 * checked by RUNNING the engine the page describes and decoding what a user
 * would download — the facts are only as true as that output.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRawStream,
  PDFTextField,
  StandardFonts,
  decodePDFRawStream,
  degrees,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { getRelatedTools, getToolBySlug, tools } from "@/lib/tools";
import { guides } from "@/lib/guides";
import type { Guide } from "@/lib/guides";
import type { Tool } from "./types";
import { howToSteps, toolFacts, toolFaq } from "./tool-facts";
import { withoutComments } from "./copy-surface";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { STAMP_POSITIONS, applyTokens } from "@/lib/pdf/stamp";
import { addPageNumbers } from "@/lib/pdf/page-numbers";
import { OVERLAY_FITS, overlayPdf } from "@/lib/pdf/overlay";
import { flattenPdf } from "@/lib/pdf/flatten";
import { compareExtractedPdfText } from "@/lib/pdf/compare-pdf";
import { editPdf } from "@/lib/pdf/edit";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  PDF_ENCRYPTION_LEVELS,
  PDF_KEY_LENGTHS,
  parseUnlockPdfOptions,
} from "@/lib/jobs/pdf-security";
import { EXTRACTION_FIELD_TYPES } from "@/lib/jobs/ai-extract";
import { protectArgs, unlockArgs } from "@/lib/workers/pdf-security/native";
import { runUnlock } from "@/lib/workers/pdf-security/engine";
import { linearizeArgs } from "@/lib/workers/pdf-structure/native";
import { runAiExtract } from "@/lib/workers/ai-extract/engine";
import {
  ALIGN_OPTIONS,
  TOKENS,
} from "@/components/tools/runner/header-footer-runner";
import { HonestScopeNote } from "@/components/tools/runner/edit-runner";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const RUNNER_DIR = "src/components/tools/runner";

const tool = (slug: string): Tool => {
  const found = getToolBySlug(slug);
  if (!found) throw new Error(`no tool "${slug}"`);
  return found;
};

/** Everything a tool page says in its own voice, as the page renders it. */
function pageTexts(t: Tool): string[] {
  return [
    t.tagline,
    t.description,
    ...howToSteps(t),
    ...toolFacts(t.slug).map((f) => f.value),
    ...toolFaq(t).flatMap((e) => [e.question, e.answer]),
  ];
}

/** Other tools named in `texts`, longest name first so a name inside a longer one is not double-read. */
const NAMES = tools
  .map((t) => ({ name: t.name, slug: t.slug }))
  .sort((a, b) => b.name.length - a.name.length);

function namedTools(texts: readonly string[], self: string): string[] {
  const named = new Set<string>();
  for (const text of texts) {
    let rest = text;
    for (const { name, slug } of NAMES) {
      if (rest.includes(name)) {
        if (slug !== self) named.add(slug);
        rest = rest.split(name).join("\u27e6\u27e7");
      }
    }
  }
  return [...named].sort();
}

/** The tools a page names that the reader is given no visible link to. */
function unlinkedMentions(t: Tool, texts: readonly string[]): string[] {
  const visible = new Set(getRelatedTools(t, 3).map((r) => r.slug));
  return namedTools(texts, t.slug).filter((slug) => !visible.has(slug));
}

/* ------------------------------------------------------------------ *
 *  Links: a page that sends you somewhere gives you the way there.
 * ------------------------------------------------------------------ */

describe("tool pages link where they send the reader", () => {
  it("every tool a page names is one of its visible related links", () => {
    const naming = tools.filter(
      (t) => namedTools(pageTexts(t), t.slug).length > 0,
    );
    // Health: the scanned-PDF FAQ alone names OCR PDF on six pages.
    expect(
      naming.length,
      `the name walk found implausibly few pages naming another tool: ${naming.map((t) => t.slug).join(", ")}`,
    ).toBeGreaterThanOrEqual(8);
    const offenders = tools.flatMap((t) =>
      unlinkedMentions(t, pageTexts(t)).map(
        (slug) =>
          `${t.slug} names ${tool(slug).name} but its three visible related tools are ${getRelatedTools(
            t,
            3,
          )
            .map((r) => r.slug)
            .join(", ")}`,
      ),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("positive control: the sentence compare-pdf shipped, with its shipped links, is caught", () => {
    const shipped: Tool = {
      ...tool("compare-pdf"),
      related: ["redact-pdf", "annotate-pdf", "pdf-to-text"],
    };
    expect(
      unlinkedMentions(shipped, [
        `Only once the scan has a text layer. Run the file through ${tool("ocr-pdf").name} first, then use it here.`,
      ]),
    ).toEqual(["ocr-pdf"]);
  });

  it("every tool page is linked from at least one other tool page", () => {
    const inbound = orphans(tools);
    expect(
      inbound.edges,
      "the related graph is implausibly small",
    ).toBeGreaterThan(tools.length);
    expect(inbound.orphans, "tool pages no other tool page links to").toEqual(
      [],
    );
  });

  it("positive control: a tool nobody relates to is reported", () => {
    const [a, b, c] = tools;
    const trio: Tool[] = [
      { ...a!, related: [b!.slug] },
      { ...b!, related: [a!.slug] },
      { ...c!, related: [a!.slug] },
    ];
    expect(orphans(trio).orphans).toEqual([c!.slug]);
  });

  it("the edit tool's scope note links the tools it sends the reader to", () => {
    const html = renderToStaticMarkup(createElement(HonestScopeNote));
    const text = html.replace(/<[^>]+>/g, "");
    const named = namedTools([text], "edit-pdf");
    expect(named.length, "the note names no other tool").toBeGreaterThan(0);
    for (const slug of named) {
      expect(html, `the note names ${slug} without linking it`).toContain(
        `href="/tools/${slug}"`,
      );
    }
    expect(named).toEqual(
      expect.arrayContaining(["pdf-to-word", "redact-pdf"]),
    );
  });
});

function orphans(list: readonly Tool[]): { orphans: string[]; edges: number } {
  const bySlug = new Map(list.map((t) => [t.slug, t]));
  const linked = new Set<string>();
  let edges = 0;
  for (const t of list) {
    for (const slug of (t.related ?? []).slice(0, 3)) {
      if (!bySlug.has(slug) || slug === t.slug) continue;
      linked.add(slug);
      edges += 1;
    }
  }
  return {
    orphans: list.map((t) => t.slug).filter((s) => !linked.has(s)),
    edges,
  };
}

/* ------------------------------------------------------------------ *
 *  Guides: a guide links only the tools it actually discusses.
 * ------------------------------------------------------------------ */

function guideBody(guide: Guide): string {
  return [
    ...guide.intro,
    ...guide.steps,
    ...guide.sections.flatMap((s) => [s.heading, ...s.body]),
    ...guide.faq.flatMap((f) => [f.question, f.answer]),
  ].join(" ");
}

function undiscussed(guide: Guide): string[] {
  const body = guideBody(guide);
  return guide.tools.filter((slug) => !body.includes(tool(slug).name));
}

describe("guides discuss every tool they link", () => {
  it("each tool in a guide's `tools` is named in its article", () => {
    // `tools` is what makes each of those tool pages link this guide, so a
    // tool listed and never discussed sends that page's reader to an article
    // about something else.
    expect(guides.length).toBeGreaterThanOrEqual(8);
    const offenders = guides.flatMap((g) =>
      undiscussed(g).map((slug) => `${g.slug} never names ${tool(slug).name}`),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("positive control: the compress guide's shipped tools list is caught", () => {
    const compress = guides.find((g) => g.tools[0] === "compress-pdf")!;
    // The guide as it shipped: none of its text named the other two tools.
    const others = compress.tools.slice(1).map((slug) => tool(slug).name);
    const strip = (text: string) =>
      others.some((name) => text.includes(name)) ? "" : text;
    const shipped: Guide = {
      ...compress,
      sections: compress.sections.map((s) => ({
        ...s,
        body: s.body.map(strip),
      })),
    };
    expect(undiscussed(shipped).sort()).toEqual(compress.tools.slice(1).sort());
  });
});

/* ------------------------------------------------------------------ *
 *  Steps: a runner that takes more than one file authors its own.
 * ------------------------------------------------------------------ */

/** registry kind → runner module, through the switch the page mounts. */
function runnerFileForKind(kind: string): string {
  const dispatch = read(`${RUNNER_DIR}/tool-runner.tsx`);
  const component = new RegExp(
    `case\\s+"${kind}":[\\s\\S]{0,200}?<([A-Z][A-Za-z]*)`,
  ).exec(dispatch)?.[1];
  if (!component) throw new Error(`tool-runner has no case for "${kind}"`);
  const from = new RegExp(
    `import\\s+\\{[^}]*\\b${component}\\b[^}]*\\}\\s+from\\s+"\\./([^"]+)"`,
  ).exec(dispatch)?.[1];
  if (!from) throw new Error(`no import for ${component}`);
  return `${RUNNER_DIR}/${from}.tsx`;
}

/**
 * How many files the runner asks for: each `<Dropzone>` is one input (many,
 * if it carries a bare or `{true}` `multiple`), and a `<SinglePdfRunner>`
 * brings its own dropzone.
 */
function fileInputs(source: string): { inputs: number; many: boolean } {
  const code = withoutComments(source);
  const zones = [...code.matchAll(/<Dropzone\b[\s\S]*?\/>/g)].map((m) => m[0]);
  const many = zones.some((z) =>
    /\bmultiple(?:\s*=\s*\{\s*true\s*\})?(?=[\s/])/.test(
      z.replace(/\bmultiple\s*=\s*\{\s*false\s*\}/g, ""),
    ),
  );
  const single = (code.match(/<SinglePdfRunner\b/g) ?? []).length;
  return { inputs: zones.length + single, many };
}

/** The steps the page would fall back to for this tool — the blind template. */
function templateSteps(t: Tool): readonly string[] {
  return howToSteps({ ...t, slug: "\u27e6template\u27e7", how: undefined });
}

describe("a tool that takes several files describes them in its own steps", () => {
  const multi = supportedToolSlugs.filter((slug) => {
    const kind = getRunnerKind(slug);
    if (!kind) return false;
    const { inputs, many } = fileInputs(read(runnerFileForKind(kind)));
    return many || inputs >= 2;
  });

  it("discovers a plausible multi-file set", () => {
    // merge, compare, compress, both image-to-PDF tools, overlay, sign today.
    expect(multi.length, multi.join(", ")).toBeGreaterThanOrEqual(5);
    expect(multi.length, multi.join(", ")).toBeLessThanOrEqual(12);
  });

  it("none of them falls back to the one-file template", () => {
    const offenders = multi.filter(
      (slug) =>
        JSON.stringify(howToSteps(tool(slug))) ===
        JSON.stringify(templateSteps(tool(slug))),
    );
    expect(
      offenders,
      `these runners take several files but their HowTo says "pick your file":\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("positive controls: the counter sees each shape", () => {
    expect(fileInputs(`<SinglePdfRunner>x</SinglePdfRunner>`)).toEqual({
      inputs: 1,
      many: false,
    });
    // overlay's shape: its own runner plus a second, single dropzone.
    expect(
      fileInputs(
        `<SinglePdfRunner/>\n<Dropzone\n onFiles={f}\n multiple={false}\n compact\n/>`,
      ),
    ).toEqual({ inputs: 2, many: false });
    // compare's shape: one dropzone that takes many.
    expect(
      fileInputs(`<Dropzone\n onFiles={onFiles}\n multiple\n title="x"\n/>`),
    ).toEqual({ inputs: 1, many: true });
    // The template really is what a defaulted tool ships.
    const defaulted = tools.find((t) => !t.how && t.slug === "repair-pdf")!;
    expect(howToSteps(defaulted)).toEqual(templateSteps(defaulted));
  });
});

/* ------------------------------------------------------------------ *
 *  Names: the title and H1 carry the head term.
 * ------------------------------------------------------------------ */

/**
 * Tool names without "PDF" in them — each one is the page's <title> and H1,
 * so the query a searcher types is missing from both. RECORDED, not wished:
 * this list must equal what the catalogue holds, in both directions, so a
 * rename takes its entry out and a new tool cannot join silently. Shrink it;
 * never add to it to ship.
 */
const NAMES_WITHOUT_HEAD_TERM = [
  "ai-extract",
  "create-forms",
  "extract-images",
  "extract-pages",
  "extract-tables",
  "fill-forms",
  "organize-pages",
  "page-numbers",
  "remove-pages",
  "request-signatures",
  "watermark-pdf",
];

describe("tool names carry the head term", () => {
  it("the tools named without “PDF” are exactly the recorded ones", () => {
    const lacking = tools
      .filter((t) => !/\bPDF\b/.test(t.name))
      .map((t) => t.slug)
      .sort();
    expect(lacking).toEqual([...NAMES_WITHOUT_HEAD_TERM].sort());
  });

  it("each runner's own name for its tool is the catalogue's", () => {
    // HandoffProblem says "… couldn't be opened in <toolName>"; a runner
    // typing an old name contradicts the H1 above it.
    const pairs: string[] = [];
    const offenders: string[] = [];
    for (const file of readdirSync(path.join(ROOT, RUNNER_DIR))) {
      if (!file.endsWith(".tsx")) continue;
      const source = read(`${RUNNER_DIR}/${file}`);
      for (const m of source.matchAll(
        /handoffSlug="([a-z0-9-]+)"\s+toolName="([^"]+)"/g,
      )) {
        pairs.push(m[1]!);
        if (tool(m[1]!).name !== m[2])
          offenders.push(
            `${file}: "${m[2]}" for ${m[1]} (${tool(m[1]!).name})`,
          );
      }
    }
    expect(pairs.length, "no runner name pairs found").toBeGreaterThanOrEqual(
      15,
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  Per-tool answers, checked on what the engine produces.
 * ------------------------------------------------------------------ */

type DecodedText = { text: string; matrix: number[] };

/** Every string drawn on a page, with the text matrix it was drawn under. */
async function drawnText(bytes: Uint8Array): Promise<DecodedText[][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    let ops = "";
    for (const stream of streams) {
      if (stream instanceof PDFRawStream)
        ops += new TextDecoder("latin1").decode(
          decodePDFRawStream(stream).decode(),
        );
    }
    const out: DecodedText[] = [];
    let matrix: number[] = [1, 0, 0, 1, 0, 0];
    const re = /((?:-?[\d.e-]+\s+){6})Tm|<([0-9A-Fa-f]*)>\s*Tj/g;
    for (const m of ops.matchAll(re)) {
      if (m[1]) matrix = m[1].trim().split(/\s+/).map(Number);
      else {
        const hex = m[2]!;
        let text = "";
        for (let i = 0; i < hex.length; i += 2)
          text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        out.push({ text, matrix });
      }
    }
    return out;
  });
}

async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800]);
  return doc.save();
}

describe("page-numbers: the facts, steps and FAQ are what the tool does", () => {
  const t = tool("page-numbers");
  const served = pageTexts(t).join(" ");
  const runner = read(runnerFileForKind(getRunnerKind(t.slug)!));

  it("the stated position count is the picker's, and the grid is what it says", () => {
    expect(served).toContain(`${STAMP_POSITIONS.length} positions`);
    expect(withoutComments(read(`${RUNNER_DIR}/stamp-controls.tsx`))).toMatch(
      /STAMP_POSITIONS\.map\(/,
    );
    expect(runner).toMatch(/<PositionPicker\b/);
    // "each corner, the middle of each edge, or the center" is a 3 × 3 grid.
    const grid = ["top", "middle", "bottom"].flatMap((v) =>
      ["left", "center", "right"].map((h) => `${v}-${h}`),
    );
    expect([...STAMP_POSITIONS].sort()).toEqual(grid.sort());
  });

  it("the settings named are the runner's labels", () => {
    for (const label of ["Start on page", "First number"]) {
      expect(runner, `runner has no "${label}" field`).toContain(
        `label="${label}"`,
      );
      expect(served, `the page never names "${label}"`).toContain(label);
    }
  });

  it("a skipped cover gets no number, and the rest count from First number", async () => {
    const doc = await PDFDocument.load(await blankPdf(5));
    doc.getPage(2).setRotation(degrees(90));
    const out = await addPageNumbers(await doc.save(), {
      startPage: 2,
      startAt: 1,
    });
    const pages = await drawnText(out);
    expect(pages[0]).toEqual([]);
    expect(pages.slice(1).map((p) => p.map((d) => d.text))).toEqual([
      ["Page 1 of 4"],
      ["Page 2 of 4"],
      ["Page 3 of 4"],
      ["Page 4 of 4"],
    ]);
    // The rotated page's glyphs are turned with it — upright to the viewer.
    const [a, b] = pages[2]![0]!.matrix;
    expect(Math.round(a!)).toBe(0);
    expect(Math.round(b!)).toBe(1);
    // …and an unrotated one is drawn level (the control for the line above).
    expect(pages[1]![0]!.matrix.slice(0, 2)).toEqual([1, 0]);
  });

  it("First number 5 puts 5 on the first numbered page", async () => {
    const out = await addPageNumbers(await blankPdf(2), {
      startAt: 5,
      format: "{n}",
    });
    expect((await drawnText(out)).map((p) => p.map((d) => d.text))).toEqual([
      ["5"],
      ["6"],
    ]);
  });
});

describe("header-footer: the fields and alignments are the runner's", () => {
  const served = pageTexts(tool("header-footer")).join(" ");

  it("names exactly the runner's token buttons, each of which substitutes", () => {
    const stated = [...new Set(served.match(/\{[a-z]+\}/g) ?? [])].sort();
    expect(stated).toEqual(TOKENS.map((t) => t.token).sort());
    for (const { token } of TOKENS) {
      const out = applyTokens(token, { n: 7, total: 9, date: "D" });
      expect(out, `${token} is not substituted`).not.toContain("{");
    }
  });

  it("names every alignment the picker offers", () => {
    expect(ALIGN_OPTIONS.length).toBeGreaterThanOrEqual(2);
    for (const option of ALIGN_OPTIONS) expect(served).toContain(option.label);
  });
});

describe("overlay-pdf: steps name the scale modes, and the overlay stays vector", () => {
  it("names every scale mode the runner renders", () => {
    const steps = howToSteps(tool("overlay-pdf")).join(" ");
    expect(
      withoutComments(read(runnerFileForKind(getRunnerKind("overlay-pdf")!))),
    ).toMatch(/OVERLAY_FITS\.map\(/);
    for (const fit of OVERLAY_FITS) expect(steps).toContain(fit.label);
  });

  it("draws the overlay as a Form XObject, not an image", async () => {
    const stampDoc = await PDFDocument.create();
    const font = await stampDoc.embedFont(StandardFonts.Helvetica);
    stampDoc.addPage([300, 300]).drawText("APPROVED", { x: 20, y: 20, font });
    const out = await overlayPdf(await blankPdf(1), await stampDoc.save(), {});
    const doc = await PDFDocument.load(out.bytes);
    const xobjects = doc
      .getPage(0)
      .node.Resources()
      ?.lookup(PDFName.of("XObject"), PDFDict);
    const subtypes = (xobjects?.keys() ?? []).map((key) =>
      String(
        (doc.context.lookup(xobjects!.get(key)) as PDFRawStream).dict.get(
          PDFName.of("Subtype"),
        ),
      ),
    );
    expect(subtypes.length).toBeGreaterThan(0);
    expect(subtypes).toContain("/Form");
    expect(subtypes).not.toContain("/Image");
  });
});

describe("flatten-pdf: the FAQ is what flattening does", () => {
  const answers = toolFaq(tool("flatten-pdf"))
    .map((e) => e.answer)
    .join(" ");

  /** The field kinds as the answer names them → the class pdf-lib gives them. */
  const KINDS = {
    "text boxes": PDFTextField,
    checkboxes: PDFCheckBox,
    "radio buttons": PDFRadioGroup,
    dropdowns: PDFDropdown,
    "list boxes": PDFOptionList,
  } as const;

  it("names exactly the kinds it is tested on", () => {
    // The answer that lists them: "Every fillable form field — <kinds> — is …".
    const listed = /form field — ([^—]+) —/.exec(answers)?.[1];
    expect(listed, "no field-kind list in the FAQ").toBeTruthy();
    const named = listed!
      .split(/,\s*|\s+and\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    expect(named).toEqual(Object.keys(KINDS).sort());
  });

  it("flattens every one of those kinds", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const form = doc.getForm();
    const text = form.createTextField("t");
    text.setText("Ada");
    text.addToPage(page, { x: 20, y: 700, width: 200, height: 20 });
    const box = form.createCheckBox("c");
    box.check();
    box.addToPage(page, { x: 20, y: 660, width: 16, height: 16 });
    const radio = form.createRadioGroup("r");
    radio.addOptionToPage("yes", page, {
      x: 20,
      y: 620,
      width: 16,
      height: 16,
    });
    radio.select("yes");
    const drop = form.createDropdown("d");
    drop.addOptions(["A", "B"]);
    drop.select("B");
    drop.addToPage(page, { x: 20, y: 580, width: 100, height: 20 });
    const list = form.createOptionList("l");
    list.addOptions(["X", "Y"]);
    list.select("Y");
    list.addToPage(page, { x: 20, y: 500, width: 100, height: 60 });
    const fields = form.getFields();
    for (const Kind of Object.values(KINDS))
      expect(fields.some((f) => f instanceof Kind)).toBe(true);

    const result = await flattenPdf(await doc.save());
    expect(result.flattenedFields).toBe(fields.length);
    const after = await PDFDocument.load(result.bytes);
    expect(after.getForm().getFields()).toHaveLength(0);
  });

  it("a PDF with no fields is re-saved, and the runner says none were found", async () => {
    const result = await flattenPdf(await blankPdf(2));
    expect(result.hadForm).toBe(false);
    expect(answers).toContain("no fillable form fields were found");
    expect(read(runnerFileForKind(getRunnerKind("flatten-pdf")!))).toContain(
      "No fillable form fields found",
    );
  });

  it("refuses a text field in each script the answer names", async () => {
    const SAMPLES: Record<string, string> = {
      Bengali: "বাংলা",
      Chinese: "中文",
      Greek: "Ελληνικά",
    };
    const named = /— ([^—]+?), for example —/
      .exec(answers)?.[1]
      ?.split(/,\s*|\s+or\s+/)
      .map((s) => s.trim());
    expect(named?.sort()).toEqual(Object.keys(SAMPLES).sort());
    for (const [script, sample] of Object.entries(SAMPLES)) {
      const doc = await PDFDocument.create();
      const page = doc.addPage([600, 800]);
      const field = doc.getForm().createTextField("name");
      field.addToPage(page, { x: 20, y: 700, width: 200, height: 20 });
      field.setText(sample);
      const bytes = await doc.save({ updateFieldAppearances: false });
      await expect(flattenPdf(bytes), script).rejects.toThrow(/outside it/);
    }
  });
});

describe("compare-pdf: order, and what counts as a change", () => {
  const ex = (text: string): ExtractedPdfText => ({
    pageCount: 1,
    pages: [],
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  });

  it("the first file's lines are removed, the second's added; spacing and blank lines are ignored", () => {
    const served = pageTexts(tool("compare-pdf")).join(" ");
    expect(served).toContain("first is treated as the original");
    expect(served).toMatch(/only in the first PDF are listed as removed/);
    const result = compareExtractedPdfText(
      { name: "a.pdf", size: 1, extracted: ex("Alpha\n\nBeta   gamma") },
      { name: "b.pdf", size: 1, extracted: ex("Beta gamma\nDelta") },
    );
    expect(result.report).toContain("- Alpha");
    expect(result.report).toContain("+ Delta");
    expect(result.summary.changedLines).toBe(2);
    // …and the runner hands them over in the order they were picked.
    expect(read(runnerFileForKind(getRunnerKind("compare-pdf")!))).toMatch(
      /const \[left, right\] = items;/,
    );
  });
});

describe("edit-pdf: the text already on the page is kept exactly", () => {
  it("the original content stream survives an edit byte for byte", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([600, 800]).drawText("Original line", { x: 50, y: 700, font });
    const input = await doc.save();
    const before = await drawnText(input);
    const out = await editPdf(input, [
      { type: "text", page: 1, x: 50, y: 600, text: "Added", color: "#000" },
    ]);
    const after = await drawnText(out.bytes);
    expect(after[0]!.map((d) => d.text)).toEqual(
      expect.arrayContaining(before[0]!.map((d) => d.text)),
    );
    expect(after[0]!.some((d) => d.text === "Original line")).toBe(true);
    expect(pageTexts(tool("edit-pdf")).join(" ")).toMatch(
      /kept exactly as they were/,
    );
  });
});

describe("optimize-web: linearizing is not compression", () => {
  /** qpdf flags that make a file smaller or change its content. */
  const RESHAPING =
    /^--(?:compress-streams|recompress-flate|compression-level|object-streams|optimize-images|remove-unreferenced|flatten|decode-level|coalesce)/;

  it("the worker passes qpdf nothing but --linearize", () => {
    const flags = linearizeArgs("in.pdf", "out.pdf").filter((a) =>
      a.startsWith("-"),
    );
    expect(flags).toEqual(["--linearize"]);
    expect(flags.filter((f) => RESHAPING.test(f))).toEqual([]);
    // Positive control through the same detector.
    expect(RESHAPING.test("--compress-streams=y")).toBe(true);
    const faq = toolFaq(tool("optimize-web"))
      .map((e) => e.answer)
      .join(" ");
    expect(faq).toMatch(/not compression/);
  });
});

describe("protect-pdf and unlock-pdf: the answers match qpdf's arguments", () => {
  it("every offered strength is AES, and each one is named with its description", () => {
    const t = tool("protect-pdf");
    const served = pageTexts(t).join(" ");
    for (const level of PDF_ENCRYPTION_LEVELS) {
      expect(served).toContain(level.label);
      expect(served).toContain(level.description);
    }
    for (const keyLength of PDF_KEY_LENGTHS) {
      const args = protectArgs("in", "out", {
        userPassword: "u",
        ownerPassword: "o",
        keyLength,
      });
      // AES-256 is AES by definition; anything shorter must force AES, or
      // qpdf picks RC4 — the cipher the answer says is never used.
      expect(
        keyLength === 256 || args.includes("--use-aes=y"),
        `${keyLength}-bit is not forced to AES`,
      ).toBe(true);
    }
    expect(served).toMatch(/RC4 cipher is never used/);
    expect(
      withoutComments(
        read("src/components/tools/pdf-security-worker-panel.tsx"),
      ),
    ).toMatch(/PDF_ENCRYPTION_LEVELS\.map\(/);
  });

  it("unlocking needs the working password: empty is refused, wrong yields no file", async () => {
    expect(parseUnlockPdfOptions({ password: "" }).ok).toBe(false);
    expect(unlockArgs("in", "out", { password: "p" })).toContain("--decrypt");
    const run = await runUnlock(
      new TextEncoder().encode(
        "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF",
      ),
      { password: "wrong" },
      {
        qpdf: {
          isEncrypted: async () => true,
          protect: async () => new Uint8Array(),
          unlock: async () => ({ ok: false, wrongPassword: true }),
        },
        validate: () => true,
      },
    );
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("wrong_password");
    const served = pageTexts(tool("unlock-pdf")).join(" ");
    expect(served).toMatch(/an empty one is refused/);
  });
});

describe("ai-extract: the steps name the types and the files a user gets", () => {
  it("names every field type the schema accepts", () => {
    const steps = howToSteps(tool("ai-extract")).join(" ");
    for (const type of EXTRACTION_FIELD_TYPES) expect(steps).toContain(type);
  });

  it("the ZIP holds the JSON, the Markdown and the manifest the step promises", async () => {
    const steps = howToSteps(tool("ai-extract")).join(" ");
    const promised: Record<string, string> = {
      JSON: "extraction.json",
      Markdown: "extraction.md",
      manifest: "manifest.json",
    };
    const run = await runAiExtract(
      new Uint8Array([1, 2, 3]),
      { mode: "prompt", prompt: "Extract the total." },
      {
        extract: async () => ({
          pageCount: 1,
          pages: [],
          text: "Total 12",
          characterCount: 8,
          hasText: true,
        }),
        provider: {
          id: "anthropic",
          model: "m",
          async complete() {
            return {
              ok: true,
              text: '{"total":12}',
              model: "m",
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        },
        now: () => "2026-09-27T00:00:00.000Z",
      },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const files = Object.keys((await JSZip.loadAsync(run.output)).files);
    for (const [word, file] of Object.entries(promised)) {
      expect(steps, `the step no longer says ${word}`).toContain(word);
      expect(files, `the ZIP has no ${file}`).toContain(file);
    }
  });
});
