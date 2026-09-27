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
  PDFBool,
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
import { siteConfig } from "@/lib/site";
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
    ...(t.seoTitle ? [t.seoTitle] : []),
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

  it("an unknown slug does not cost a page one of its three visible links", () => {
    // getRelatedTools drops unknown slugs BEFORE it takes three, so the page
    // shows b, c and d. A copy that sliced first would report d an orphan.
    const [a, b, c, d] = tools;
    const four: Tool[] = [
      { ...a!, related: ["no-such-tool", b!.slug, c!.slug, d!.slug] },
      { ...b!, related: [a!.slug] },
      { ...c!, related: [a!.slug] },
      { ...d!, related: [a!.slug] },
    ];
    expect(getRelatedTools(four[0]!, 3).map((r) => r.slug)).toEqual([
      b!.slug,
      c!.slug,
      d!.slug,
    ]);
    expect(orphans(four).orphans).toEqual([]);
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
    // The links a page SHOWS, through the function the page calls — not a
    // copy of its slicing, which dropped unknown slugs in a different order.
    for (const { slug } of getRelatedTools(t, 3)) {
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
 * Tool names without "PDF" in them — each one is the page's H1 (and card and
 * nav label), so the query a searcher types is missing from it. The <title>
 * was the other half until each of these gained an `seoTitle`; that half is
 * now guarded for EVERY tool by "every tool page's <title> says “PDF”" below. RECORDED, not wished:
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
 *  The served <title>: the query a searcher types, in words the page backs.
 * ------------------------------------------------------------------ */

/**
 * The <title> the tool page serves — composed the way Next composes it, from
 * the page's OWN expression and the root layout's OWN template, both read out
 * of source and evaluated, so neither the page's choice of field nor the
 * layout's suffix is restated here.
 *
 * WHY NOT IMPORT THE PAGE: importing it evaluates every worker panel, and
 * under `isolate: false` that caches a panel another file mocks
 * (claims-vs-capability.test.ts records the same constraint).
 *
 * The defect this was built on (audit at 67e8d0f, re-verified at 0db7b13):
 * the title was `tool.name`, full stop. So "Protect PDF — pdf.xyz" never said
 * "password" to a searcher typing "password protect pdf", and eleven pages —
 * "AI Data Extraction — pdf.xyz", "Add Watermark — pdf.xyz", "Extract Images
 * — pdf.xyz" — never said "PDF", the head term, at all. A rename would have
 * fixed the <title> by changing the H1, the cards, the nav and the worker's
 * own package text with it; `seoTitle` changes the <title> alone.
 */
function servedToolTitle(): (t: Tool) => string {
  const page = withoutComments(read("src/app/tools/[slug]/page.tsx"));
  const body = /export async function generateMetadata[\s\S]*?\n\}\r?\n/.exec(
    page,
  )?.[0];
  if (!body) throw new Error("tool page: no generateMetadata found");
  // The found-tool branch is the buildMetadata call that sets a `path`.
  const call = [...body.matchAll(/buildMetadata\(\{([\s\S]*?)\}\)/g)]
    .map((m) => m[1]!)
    .find((args) => /\bpath:/.test(args));
  const expr = call && /\btitle:\s*([^,\n]+),/.exec(call)?.[1]?.trim();
  if (!expr) throw new Error("tool page: no title in its buildMetadata call");
  // Only property reads of `tool` may be evaluated — never arbitrary source.
  if (!/^tool\.\w+(\s*\?\?\s*tool\.\w+)*$/.test(expr))
    throw new Error(`tool page: unexpected title expression "${expr}"`);
  const pick = new Function("tool", `return (${expr});`) as (t: Tool) => string;

  const layout = withoutComments(read("src/app/layout.tsx"));
  const raw = /template:\s*`([^`]*)`/.exec(layout)?.[1];
  if (!raw) throw new Error("root layout: no title template found");
  const template = raw.replace("${siteConfig.name}", siteConfig.name);
  if (!template.includes("%s") || template.includes("${"))
    throw new Error(`root layout: template "${raw}" did not resolve`);
  return (t) => template.replace("%s", pick(t));
}

/** Google shows about 60 characters of a title before it truncates. */
const TITLE_BUDGET = 60;
const TITLE_STOPWORDS = new Set(
  "a an and for from in of on the to with your".split(" "),
);
const stem = (word: string) =>
  word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .flatMap((w) => [w, ...w.split("-")])
    .filter((w) => w && !TITLE_STOPWORDS.has(w))
    .map(stem);

/**
 * Words of an seoTitle that the tool's own copy never uses. The title is the
 * one line a searcher reads before choosing the page, and it must not promise
 * what the page does not: every word in it has to come from copy the honesty
 * guards already read (name, tagline, description, keywords), or the formats
 * the page lists it taking and producing (`accept`, `outputs`) — Add Page
 * Numbers never writes "PDF" in its prose, and it only takes PDFs.
 */
function unbackedTitleWords(t: Tool, seoTitle: string): string[] {
  const backed = new Set(
    words(
      [
        t.name,
        t.tagline,
        t.description,
        ...t.keywords,
        ...t.accept,
        ...t.outputs,
      ].join(" "),
    ),
  );
  return [...new Set(words(seoTitle))].filter((w) => !backed.has(w));
}

describe("the served <title> carries the head term", () => {
  const title = servedToolTitle();

  it("every tool page's <title> says “PDF”", () => {
    expect(tools.length, "catalogue implausibly small").toBeGreaterThanOrEqual(
      40,
    );
    const lacking = tools
      .map((t) => title(t))
      .filter((served) => !/\bPDF\b/.test(served));
    expect(lacking, lacking.join("\n")).toEqual([]);
  });

  it("every <title> fits the width a result shows", () => {
    const long = tools
      .map((t) => title(t))
      .filter((served) => served.length > TITLE_BUDGET)
      .map((served) => `${served.length}: ${served}`);
    expect(long, long.join("\n")).toEqual([]);
  });

  it("an seoTitle promises nothing the tool's own copy does not say", () => {
    const withTitle = tools.filter((t) => t.seoTitle !== undefined);
    // Health: the branch is exercised, and the served title really is it.
    expect(withTitle.length).toBeGreaterThanOrEqual(1);
    for (const t of withTitle) expect(title(t)).toContain(t.seoTitle);

    const offenders = withTitle.flatMap((t) => {
      const extra = unbackedTitleWords(t, t.seoTitle!);
      const same = t.seoTitle === t.name ? ["(identical to the name)"] : [];
      return [...extra, ...same].length
        ? [`${t.slug}: ${[...extra, ...same].join(", ")}`]
        : [];
    });
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("controls: the checks see a bare name, an overlong title and an invented promise", () => {
    const edit = tool("edit-pdf");
    // The shipped title of AI Data Extraction, before seoTitle.
    const bare = { ...tool("ai-extract"), seoTitle: undefined };
    expect(/\bPDF\b/.test(title(bare))).toBe(false);
    expect(
      // Both fields, so the control holds whichever one the page reads.
      title({
        ...edit,
        name: "x".repeat(TITLE_BUDGET),
        seoTitle: "x".repeat(TITLE_BUDGET),
      }).length,
    ).toBeGreaterThan(TITLE_BUDGET);
    expect(
      unbackedTitleWords(edit, "Edit PDF Online Free — AI Translate"),
    ).toEqual(["online", "free", "ai", "translate"]);
    // Plurals and hyphens are the same word: "Images" is backed by "images".
    expect(unbackedTitleWords(edit, "Edit PDF — Add Text & Images")).toEqual(
      [],
    );
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

  it("refuses a text field in each script the answer names, when flattening has to draw it", async () => {
    // CHANGED 2026-09-27 where this test (copy lane) met the flatten fix merged
    // beside it, history kept. The fixture here set a value without redrawing
    // its appearance and saved with `updateFieldAppearances: false`: a field
    // whose STORED appearance is blank, with no `/NeedAppearances` flag. The
    // old flatten refused any non-WinAnsi value, whatever it would draw. The
    // fix draws a field's authored appearance as it is — what a reader shows,
    // and how a Bengali answer filled with its own font now flattens instead
    // of being refused — and refuses only a value it has to REDRAW with the
    // form's WinAnsi font. So the refusal is asked of the shape that redraws:
    // a filler's `/NeedAppearances true` (pdftk, most server fillers).
    //
    // NOT PINNED, and said so: the FAQ's "is refused ... rather than flattened
    // with those characters missing" no longer covers a field whose own
    // appearance is drawn as-is. That copy lives in tool-facts.ts, owned by a
    // separate change; see `flatten.test.ts` for the drawn-as-is behaviour.
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
    const filled = async (value: string) => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([600, 800]);
      const form = doc.getForm();
      const field = form.createTextField("name");
      field.addToPage(page, { x: 20, y: 700, width: 200, height: 20 });
      field.setText(value);
      form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
      return doc.save({ updateFieldAppearances: false });
    };
    for (const [script, sample] of Object.entries(SAMPLES)) {
      await expect(flattenPdf(await filled(sample)), script).rejects.toThrow(
        /outside it/,
      );
    }
    // CONTROL: the same field with a Latin value flattens, so the refusal
    // above is the script's doing and not the fixture's.
    const latin = await flattenPdf(await filled("Ada"));
    expect(latin.flattenedFields).toBe(1);
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

describe("optimize-web: linearizing is not compression, and no copy promises a size", () => {
  /*
   * History, kept on purpose. This block used to certify the answer "No —
   * linearizing is not compression, and the file can come out slightly
   * larger" by checking that `linearizeArgs` passes qpdf no reshaping FLAG.
   * That was the adjacent measurement: `qpdf --linearize in out` rewrites the
   * whole file with qpdf's DEFAULTS, which compress uncompressed streams and
   * drop objects the trailer no longer reaches (superseded incremental-update
   * revisions among them). No flag is needed for the output to be smaller, so
   * a flag list cannot license "it does not get smaller". The size is not
   * something the copy may promise in either direction; it now says the size
   * can change either way and points at Compress PDF for a lighter file.
   */

  /** A unit of copy: prose, or a question with its answer. */
  type Unit = { where: string; text: string; question?: string };

  /** Shapes that tell a reader the linearized file cannot come out smaller. */
  const DENIES_SHRINKING: Record<string, (u: Unit) => boolean> = {
    "prose denial": (u) =>
      /\b(?:does not|doesn['\u2019]t|will not|won['\u2019]t|cannot|can['\u2019]t|never)\s+(?:get|become|come out|end up|make (?:it|the file|your PDF))?\s*(?:any\s+)?smaller\b/i.test(
        u.text,
      ),
    "a flat No to the size question": (u) =>
      u.question !== undefined &&
      /\bsmaller\b/i.test(u.question) &&
      /^\s*No\b/.test(u.text),
  };
  const denials = (u: Unit) =>
    Object.entries(DENIES_SHRINKING)
      .filter(([, hit]) => hit(u))
      .map(([name]) => name);

  /** The sentences this block once approved, exactly as they shipped. */
  const SHIPPED: Unit[] = [
    {
      where: "optimize-web FAQ at 1fb610d",
      question: "Will it make my PDF smaller?",
      text: "No — linearizing is not compression, and the file can come out slightly larger. To reduce the size, use Compress PDF.",
    },
    {
      where: "compress guide at 1fb610d",
      text: "Optimize PDF for Web is often mistaken for compression, and it is not: it linearizes the file so a viewer that loads a PDF in pieces can show the first page while the rest downloads. The file does not get smaller — it can come out slightly larger — so use it when the goal is a faster first page on the web, not a lighter file.",
    },
  ];

  /**
   * Every piece of copy that talks about this tool: all of its own page, and
   * any unit on another tool page or guide that names it or linearizing.
   */
  function aboutOptimizeWeb(): Unit[] {
    const self = tool("optimize-web");
    const about = (text: string) =>
      text.includes(self.name) || /lineariz/i.test(text);
    const units: Unit[] = [];
    for (const t of tools) {
      const own = t.slug === self.slug;
      const prose = [
        t.tagline,
        t.description,
        ...howToSteps(t),
        ...toolFacts(t.slug).map((f) => f.value),
      ];
      for (const text of prose) {
        if (own || about(text)) units.push({ where: `tool ${t.slug}`, text });
      }
      for (const e of toolFaq(t)) {
        if (own || about(e.question) || about(e.answer)) {
          units.push({
            where: `tool ${t.slug} FAQ`,
            question: e.question,
            text: e.answer,
          });
        }
      }
    }
    for (const g of guides) {
      const prose = [
        ...g.intro,
        ...g.steps,
        ...g.sections.flatMap((s) => [s.heading, ...s.body]),
      ];
      for (const text of prose) {
        if (about(text)) units.push({ where: `guide ${g.slug}`, text });
      }
      for (const f of g.faq) {
        if (about(f.question) || about(f.answer)) {
          units.push({
            where: `guide ${g.slug} FAQ`,
            question: f.question,
            text: f.answer,
          });
        }
      }
    }
    return units;
  }

  it("the corpus: every shipped denial is caught, and every shape catches one", () => {
    for (const u of SHIPPED) {
      expect(denials(u), `not caught: ${u.where}`).not.toEqual([]);
    }
    for (const name of Object.keys(DENIES_SHRINKING)) {
      expect(
        SHIPPED.some((u) => denials(u).includes(name)),
        `the "${name}" shape catches no shipped sentence`,
      ).toBe(true);
    }
    // Negative control: the honest shape of each is not caught.
    expect(
      denials({
        where: "honest",
        question: "Will it make my PDF smaller?",
        text: "Not reliably. The file is rewritten, so its size can change in either direction.",
      }),
    ).toEqual([]);
  });

  it("no copy about the tool says the file cannot come out smaller", () => {
    const units = aboutOptimizeWeb();
    // Health: the walk reaches both places the claim has lived.
    expect(
      units.some((u) => u.where.startsWith("guide ")),
      "the walk found no guide that discusses the tool",
    ).toBe(true);
    const sizeQuestion = units.find(
      (u) =>
        u.where === "tool optimize-web FAQ" &&
        /\bsmaller\b/i.test(u.question ?? ""),
    );
    expect(
      sizeQuestion,
      "the page no longer answers the size question",
    ).toBeDefined();
    const offenders = units
      .map((u) => ({ u, hit: denials(u) }))
      .filter(({ hit }) => hit.length > 0)
      .map(({ u, hit }) => `${u.where} [${hit.join(", ")}]: ${u.text}`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the size answer says why, and sends the reader to the tool that shrinks", () => {
    const compress = tool("compress-pdf").name;
    const units = aboutOptimizeWeb();
    const answer = units.find(
      (u) =>
        u.where === "tool optimize-web FAQ" &&
        /\bsmaller\b/i.test(u.question ?? ""),
    )!;
    expect(answer.text).toMatch(/not compression/);
    expect(answer.text).toMatch(/either direction/);
    expect(answer.text).toContain(compress);
    const guideLines = units.filter(
      (u) =>
        u.where.startsWith("guide ") &&
        u.text.includes(tool("optimize-web").name),
    );
    expect(guideLines.length).toBeGreaterThan(0);
    for (const u of guideLines) {
      expect(u.text, u.where).toMatch(/either direction/);
      expect(u.text, u.where).toContain(compress);
    }
    // What the tool does is what the first answer says: it linearizes.
    expect(linearizeArgs("in.pdf", "out.pdf")).toContain("--linearize");
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
          requiresPassword: async () => "needs-password",
          protect: async () => new Uint8Array(),
          unlock: async () => ({ ok: false, reason: "wrong-password" }),
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
