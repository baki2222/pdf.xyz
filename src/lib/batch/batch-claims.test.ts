// @vitest-environment node
/**
 * Every batch claim is backed by a batch module the tool's runner really
 * loads, and every such module is claimed — read off the catalogue, never a
 * typed list of tools (batch plan P1).
 *
 * A batch is claimed in four places, each a different reader:
 *
 *   1. the hand-off (`handoffCapabilityFor(slug).mode === "batch"`): the
 *      workspace, a home-page drop and "Continue with" carry EVERY file to
 *      such a tool, so one without a batch would open the first and drop
 *      the rest;
 *   2. the registration (`SETTINGS_BATCH_TOOLS`, and since batch plan P2
 *      `IMAGE_BATCH_TOOLS` and `TEXT_BATCH_TOOLS`): the archive name the
 *      batch saves and the page quotes;
 *   3. the drop box's caption, typed in the runner: "One or more PDFs · …"
 *      (Text to PDF's: "One or more TXT files · …");
 *   4. the tool page's served copy naming the batch's archive.
 *
 * "Backed" is a property of the runner the page mounts (`ownPanelModules`,
 * the page's own dispatch): a `next/dynamic` loader in it, `import("./…")`,
 * whose module graph reaches the generic batch view. Loading a module is not
 * running it (CLAUDE.md rule 4), so `settings-batches.dom.test.tsx` drops
 * two PDFs on each of these pages and requires the view to appear.
 *
 * Each direction is checked, and each has a health check: a walk that found
 * no runner, no loader or no claim would pass every subset assertion here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildToolSummaries } from "@/app/workspace/presenter";
import { guides } from "@/lib/guides/catalog";
import { handoffCapabilityFor } from "@/lib/handoff/capability";
import { tools } from "@/lib/tools";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "@/lib/tools/page-copy";
import { toolFacts } from "@/lib/tools/tool-facts";
import type { Tool } from "@/lib/tools/types";
import {
  ownPanelModules,
  resolveSpecifier,
  ROOT,
  valueClosure,
} from "@/tests/tool-panel-modules";
import { BATCH_LIMITS } from "./limits";
import {
  BATCH_HINT_LEAD,
  BATCH_TEXT_HINT_LEAD,
  IMAGE_BATCH_FOLDERS,
  IMAGE_BATCH_TOOLS,
  SETTINGS_BATCH_TOOLS,
  TEXT_BATCH_TOOLS,
  WORKER_BATCH_TOOLS,
  batchLimitsSentence,
  batchMaxFilesFor,
  isWorkerBatchSlug,
  type WorkerBatchSlug,
} from "./tools";
import { workerBatchPageSentence } from "./worker-copy";
import { securityBatchPageSentence } from "./security-copy";

/** Every registered batch, by the registry that names its words. */
const REGISTRIES = {
  SETTINGS_BATCH_TOOLS,
  IMAGE_BATCH_TOOLS,
  TEXT_BATCH_TOOLS,
} as const;
const REGISTERED: Record<string, { registry: string; zipName: string }> =
  Object.fromEntries(
    Object.entries(REGISTRIES).flatMap(([registry, entries]) =>
      Object.entries(entries).map(([slug, { zipName }]) => [
        slug,
        { registry, zipName },
      ]),
    ),
  );
const REGISTERED_COUNT = Object.keys(REGISTERED).length;

const read = (file: string) =>
  readFileSync(path.isAbsolute(file) ? file : path.join(ROOT, file), "utf8");
const relOf = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join("/");

const BATCH_VIEW = "src/components/tools/runner/batch/batch-view.tsx";
const SETTINGS_BATCH =
  "src/components/tools/runner/batch/settings-batch-runner.tsx";
const IMAGES_BATCH =
  "src/components/tools/runner/batch/images-batch-runner.tsx";

const { bySlug } = ownPanelModules();

/** The runner module a slug's page mounts, repo-relative, or null. */
function runnerOf(slug: string): string | null {
  const panel = bySlug.get(slug);
  return panel && panel.dispatch === "runner" ? relOf(panel.file) : null;
}

/**
 * The batch modules a runner loads: each `import("./…")` in its source whose
 * module graph reaches the batch view. Comments are stripped first, so a
 * loader written in a comment loads nothing.
 */
function batchModulesOf(runner: string): string[] {
  const source = read(runner)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  for (const m of source.matchAll(/\bimport\(\s*"(\.\.?\/[^"]+)"\s*\)/g)) {
    const resolved = resolveSpecifier(path.join(ROOT, runner), m[1]!);
    if (!resolved) throw new Error(`${runner}: cannot resolve ${m[1]}`);
    const closure = valueClosure(resolved).map(relOf);
    if (closure.includes(BATCH_VIEW)) out.push(relOf(resolved));
  }
  return out;
}

/** Everything a tool page serves a reader about the tool. */
function servedText(tool: Tool): string {
  return [
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
    // The facts table, served on the same page: missed until the review of
    // P2 found "each page you choose" there as well as in the caption.
    ...toolFacts(tool.slug).flatMap((f) => [f.label, f.value]),
  ].join("\n");
}

/**
 * The drop box captions a runner types: `hint="…"`, or a template literal,
 * `hint={`…`}` (PDF to JPG's and PNG's name the format). Until batch plan P2
 * only the first shape was read, which could not see those two captions.
 */
const hintsOf = (runner: string) =>
  [...read(runner).matchAll(/\bhint=(?:"([^"]+)"|\{`([^`]+)`\})/g)].map(
    (m) => (m[1] ?? m[2])!,
  );

const ARCHIVE_NAME = /\bpdfxyz-[a-z-]+\.zip\b/;

const rows = tools.map((tool) => {
  const runner = runnerOf(tool.slug);
  const modules = runner ? batchModulesOf(runner) : [];
  return {
    tool,
    slug: tool.slug,
    runner,
    modules,
    backed: modules.length > 0,
    settings: modules.some((m) =>
      valueClosure(path.join(ROOT, m)).map(relOf).includes(SETTINGS_BATCH),
    ),
    images: modules.some((m) =>
      valueClosure(path.join(ROOT, m)).map(relOf).includes(IMAGES_BATCH),
    ),
    claims: {
      handoff:
        handoffCapabilityFor(tool.slug).mode === "batch" &&
        (tool.accept.includes("PDF") || tool.accept.includes("TXT")),
      registered: tool.slug in REGISTERED,
      caption: runner
        ? hintsOf(runner).some(
            (h) =>
              h.startsWith(BATCH_HINT_LEAD) ||
              h.startsWith(BATCH_TEXT_HINT_LEAD),
          )
        : false,
      archive: ARCHIVE_NAME.test(servedText(tool)),
    },
  };
});

const backed = rows.filter((r) => r.backed).map((r) => r.slug);

/** A registered worker batch whose page's panel loads the worker batch. */
function workerBacked(slug: string): boolean {
  const panel = bySlug.get(slug);
  return (
    isWorkerBatchSlug(slug) &&
    !!panel &&
    panel.dispatch === "worker" &&
    batchModulesOf(relOf(panel.file)).length > 0
  );
}

describe("batch claims, walked from the catalogue", () => {
  it("health: the walk reads runners, finds loaders, and finds Compress (positive control)", () => {
    expect(rows.filter((r) => r.runner).length).toBeGreaterThanOrEqual(25);
    // Compress PDF's batch shipped first, through its own runner: the walk
    // must find it, or it cannot find anything.
    expect(backed).toContain("compress-pdf");
    expect(backed.length).toBeGreaterThanOrEqual(1 + REGISTERED_COUNT);
    // Health: the registries hold P1's five and P2's five.
    expect(REGISTERED_COUNT).toBeGreaterThanOrEqual(10);
    // Every claim kind is made somewhere: an empty claim set is vacuous.
    for (const kind of ["handoff", "registered", "caption"] as const)
      expect(
        rows.filter((r) => r.claims[kind]).length,
        `no tool makes the ${kind} claim`,
      ).toBeGreaterThanOrEqual(REGISTERED_COUNT);
    expect(rows.filter((r) => r.claims.archive).length).toBeGreaterThanOrEqual(
      REGISTERED_COUNT,
    );
  });

  it("every claim is backed by a batch module its runner loads", () => {
    for (const kind of [
      "handoff",
      "registered",
      "caption",
      "archive",
    ] as const) {
      // A worker batch (batch plan P3) is backed by its panel's loader.
      const unbacked = rows
        .filter((r) => r.claims[kind] && !r.backed && !workerBacked(r.slug))
        .map((r) => r.slug);
      expect(unbacked, `${kind} claims with no batch behind them`).toEqual([]);
    }
  });

  it("every batch is claimed where a reader meets it: the hand-off and the drop box", () => {
    expect(
      rows.filter((r) => r.backed && !r.claims.handoff).map((r) => r.slug),
      "a batch the hand-off does not carry files to: it opens the first and drops the rest",
    ).toEqual([]);
    expect(
      rows.filter((r) => r.backed && !r.claims.caption).map((r) => r.slug),
      `a batch whose drop box does not open with "${BATCH_HINT_LEAD}"`,
    ).toEqual([]);
  });

  it("the settings batches and their registration are the same set", () => {
    expect(
      rows
        .filter((r) => r.settings)
        .map((r) => r.slug)
        .sort(),
    ).toEqual(Object.keys(SETTINGS_BATCH_TOOLS).sort());
  });

  it("the images batches and their registration are the same set", () => {
    expect(
      rows
        .filter((r) => r.images)
        .map((r) => r.slug)
        .sort(),
    ).toEqual(Object.keys(IMAGE_BATCH_TOOLS).sort());
    // Health: the two shared runners are never one tool's both.
    expect(rows.filter((r) => r.images && r.settings)).toEqual([]);
  });

  it("each registered batch saves the archive its page names, and its page states its own limits", () => {
    // The sentence is built from the limits, not typed beside them, and a
    // raster batch's carries the raster cap.
    expect(batchLimitsSentence()).toContain(
      `${BATCH_LIMITS.clientMaxFiles} PDFs`,
    );
    expect(batchLimitsSentence("pdf-to-png")).toContain(
      `${BATCH_LIMITS.rasterMaxFiles} PDFs`,
    );
    const registeredRows = rows.filter((x) => x.slug in REGISTERED);
    expect(registeredRows).toHaveLength(REGISTERED_COUNT);
    for (const r of registeredRows) {
      const { registry, zipName } = REGISTERED[r.slug]!;
      expect(r.modules.length, `${r.slug} has no batch module`).toBe(1);
      const batchModule = r.modules[0]!;
      expect(
        read(batchModule),
        `${batchModule} saves another tool's archive`,
      ).toContain(`${registry}["${r.slug}"].zipName`);
      const served = servedText(r.tool);
      expect(served, `${r.slug} does not name its archive`).toContain(zipName);
      expect(served, `${r.slug} does not state the batch limits`).toContain(
        batchLimitsSentence(r.slug),
      );
      if (r.slug in IMAGE_BATCH_TOOLS)
        expect(served, `${r.slug} does not say where its images go`).toContain(
          IMAGE_BATCH_FOLDERS,
        );
      const named = served.match(new RegExp(ARCHIVE_NAME.source, "g")) ?? [];
      expect(
        named.filter((n) => n !== zipName),
        `${r.slug} names an archive its batch does not save`,
      ).toEqual([]);
    }
  });

  // What this proves is that limits.ts is LOADED by every batch module, not
  // that the cap RUNS (CLAUDE.md rule 4: loading a module is not running a
  // function). Until review 2026-11-08 it was named "every batch caps its
  // files", and an override of the cap's limits left it green. That the
  // cap runs is shown through each page's own runner, in
  // runner/batch/settings-batches.dom.test.tsx ("the batch's file cap").
  it("every batch module loads the cap, and the workspace states that cap for exactly those tools", () => {
    const LIMITS = "src/lib/batch/limits.ts";
    for (const r of rows.filter((x) => x.backed))
      for (const batchModule of r.modules)
        expect(
          valueClosure(path.join(ROOT, batchModule)).map(relOf),
          `${batchModule} never reaches the cap`,
        ).toContain(LIMITS);
    const summaries = buildToolSummaries().filter(
      (s) => s.batchMaxFiles !== undefined,
    );
    expect(summaries.map((s) => s.slug).sort()).toEqual([...backed].sort());
    // Each at its own cap: a raster batch's is the raster one.
    for (const s of summaries)
      expect(s.batchMaxFiles, s.slug).toBe(batchMaxFilesFor(s.slug));
    expect(
      summaries.some((s) => s.batchMaxFiles === BATCH_LIMITS.rasterMaxFiles),
    ).toBe(true);
  });

  it("no AI tool has a batch, or is claimed to", () => {
    // The AI category, as the tools page groups them (a processing mode
    // is given its meaning in processing-split.ts alone).
    const ai = rows.filter((r) => r.tool.category === "ai");
    // Health: the catalogue still has AI tools to hold to this.
    expect(ai.length).toBeGreaterThanOrEqual(3);
    expect(
      ai
        .filter((r) => r.backed || Object.values(r.claims).some(Boolean))
        .map((r) => r.slug),
    ).toEqual([]);
  });
});

/**
 * The sentences that told a reader these tools take ONE file, as they
 * shipped before batch plan P1 — the corpus a ban list needs in both
 * directions (CLAUDE.md rule 1): every shipped sentence is caught by some
 * pattern, and every pattern catches some shipped sentence. Then no page of
 * a settings batch tool, and no guide that is about one, says it again.
 */
const ONE_FILE_SHIPPED = [
  "Open one PDF and each page appears as a tile previewing its current angle, with the angle printed on any tile not at 0°.",
  "Your browser does the work locally and the document is not uploaded; it takes one file of up to 100 MB.",
  'Drag one file onto the "Drop your PDF here, or browse" area (captioned "One PDF · rotate any or all pages"), or click browse.',
  "It holds one form at a time, and the ceiling is 100 MB.",
  "Drop a single PDF onto the dashed box or click browse.",
  "The page takes a single PDF of up to 100 MB at a time, and a password-protected one has to go through Unlock PDF before it will open here.",
  'Drag one PDF onto the dashed box that says "Drop your PDF here, or browse"; clicking its browse link opens a file picker instead.',
  "Open one PDF",
  "It takes one file, up to 100 MB.",
  "Add Watermark takes one PDF at a time, up to 100 MB.",
  "It numbers one file at a time, up to 100 MB.",
  "Add Page Numbers numbers one PDF at a time, and each file starts counting from First number.",
  "Not in one step: the tool numbers one PDF at a time, and each file starts from First number.",
  "It runs in your browser, so the PDF stays on your device, and it takes one file up to 100 MB.",
  // Review 2026-11-08: Add Page Numbers' intro, missed by the first corpus.
  "Add Page Numbers stamps a number onto every page of one PDF, or onto every page from a chosen page onward, and can leave a cover or the last pages without one.",
  // Batch plan P2 (2026-11-08): Grayscale PDF, PDF to JPG and PNG, Extract
  // Images and Text to PDF, as they shipped before their batch.
  "The picker takes one PDF of up to 100 MB.",
  'Drag a single PDF into the dashed box, or click "browse" and choose it.',
  "It converts a single PDF per run, up to 100 MB.",
  'Drag the PDF onto the box labelled "Drop your PDF here, or browse", or click it to pick a file up to 100 MB; if you drop several, only the first is used.',
  "Each run converts a single PDF of at most 100 MB.",
  "Of several dropped files, only the first is kept.",
  "Drop one PDF where it says Drop your PDF here, or click browse to choose it.",
  "Not in one step: this tool converts one file or one pasted text at a time, and a multi-file drop loads just the first file.",
  "Either paste all the texts into the box one after another and convert once, or convert each file separately, reloading the page before the next one, then combine the results in order with Merge PDF.",
  "One PDF · pages rasterized to grayscale locally in your browser",
  "One PDF · pulls out the images embedded in it, at their original resolution — all in your browser",
  "Drop a TXT file here, or",
  // Review of P2 (2026-11-08): PDF to JPG and PNG promised a page choice
  // that only the single-file editor has; the batch converts every page.
  "One or more PDFs · each page you choose becomes a JPG image, rendered locally in your browser",
  "Screen (96 DPI), High (150 DPI) or Print (300 DPI) — each page you choose becomes one PNG image, in colour or grayscale, rendered in your browser.",
];

const ONE_FILE_BANS: { name: string; pattern: RegExp }[] = [
  {
    name: "takes / holds / numbers / converts one file",
    pattern:
      /\b(?:takes|holds|numbers|handles|converts) (?:a single|one) (?:PDF|file|form)\b/i,
  },
  // Batch plan P2: what a drop of several did before the batch.
  {
    name: "only the first file is used",
    pattern: /\b(?:only|just) the first (?:is (?:used|kept)|file)\b/i,
  },
  {
    name: "reload the page between files",
    pattern: /\breload(?:ing)? the page before the next\b/i,
  },
  {
    name: "the one-file drop box title",
    pattern: /\bDrop an? (?:PDF|TXT file) here\b/,
  },
  {
    name: "one file at a time",
    pattern: /\bone (?:PDF|file|form) at a time\b/i,
  },
  // Capitalised: the instruction that opens a step ("Open one PDF"), not
  // "open one file on its own", which is what a batch tells a reader to do
  // for the single-file editor.
  {
    name: "open one file",
    pattern: /\b(?:Open|Drag|Drop) (?:one|a single) (?:PDF|file)\b/,
  },
  { name: "the one-file caption", pattern: /\bOne PDF ·/ },
  // A page choice said of every run: a batch has none, it converts every
  // page ("or the pages you choose, for one file" is the true form).
  {
    name: "each page you choose, said of every run",
    pattern: /\beach page you choose becomes\b/i,
  },
  // What the tool does, said of exactly one file ("every page of one PDF").
  {
    name: "every page of one file",
    pattern: /\bevery page of (?:one|a single) (?:PDF|file)\b/i,
  },
];

/** Every string in a value, however deep. */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(stringsIn);
  return [];
}

describe("one-file sentences, two ways", () => {
  it("every shipped sentence is caught, and every pattern catches one", () => {
    for (const sentence of ONE_FILE_SHIPPED)
      expect(
        ONE_FILE_BANS.some((ban) => ban.pattern.test(sentence)),
        `nothing catches: ${sentence}`,
      ).toBe(true);
    for (const ban of ONE_FILE_BANS)
      expect(
        ONE_FILE_SHIPPED.some((sentence) => ban.pattern.test(sentence)),
        `${ban.name} catches no shipped sentence`,
      ).toBe(true);
  });

  it("no batch tool's page, guide or caption says it takes one file", () => {
    const slugs = Object.keys(REGISTERED);
    const pages = rows
      .filter((r) => slugs.includes(r.slug))
      .map((r) => ({ where: r.slug, text: servedText(r.tool) }));
    const about = guides.filter((g) => slugs.includes(g.tools[0]!));
    const captions = rows
      .filter((r) => slugs.includes(r.slug) && r.runner)
      .map((r) => ({ where: r.runner!, text: hintsOf(r.runner!).join("\n") }));
    // Health: every tool, a guide for most, a caption for every runner.
    expect(pages).toHaveLength(slugs.length);
    expect(about.length).toBeGreaterThanOrEqual(5);
    expect(captions).toHaveLength(slugs.length);
    const corpus = [
      ...pages,
      ...about.map((g) => ({ where: g.slug, text: stringsIn(g).join("\n") })),
      ...captions,
    ];
    const found = corpus.flatMap(({ where, text }) =>
      ONE_FILE_BANS.filter((ban) => ban.pattern.test(text)).map(
        (ban) => `${where}: ${ban.name} — ${text.match(ban.pattern)![0]}`,
      ),
    );
    expect(found).toEqual([]);
  });
});

/**
 * Batch plan P3: the worker batches. Their panels are the page's WORKER
 * dispatch, not a runner, so they are walked here on their own — from the
 * same reading of the page (`ownPanelModules`) and the same loader test
 * (`batchModulesOf`: an `import("./…")` whose graph reaches the batch view).
 *
 * A worker panel can serve several tools (EPUB to PDF shares HTML to PDF's),
 * so "backed" is a property of the panel module here, and the per-tool
 * fork is proved by dropping two files on each registered tool's own panel
 * (`runner/batch/worker-batches.dom.test.tsx`, with HTML to PDF as its
 * negative control).
 */
const workerRows = tools
  .map((tool) => {
    const panel = bySlug.get(tool.slug);
    if (!panel || panel.dispatch !== "worker") return null;
    const file = relOf(panel.file);
    return {
      tool,
      slug: tool.slug,
      panel: file,
      modules: batchModulesOf(file),
      registered: isWorkerBatchSlug(tool.slug),
    };
  })
  .filter((r): r is NonNullable<typeof r> => r !== null);

const WORKER_BATCH_RUNNER =
  "src/components/tools/runner/batch/worker-batch-runner.tsx";
const SECURITY_BATCH = "src/components/tools/runner/batch/security-batch.tsx";
/** Batch plan P4: the two tools whose batch asks for one password. */
const SECURITY_SLUGS = { "protect-pdf": true, "unlock-pdf": true } as const;

describe("worker batch claims (batch plan P3)", () => {
  it("health: the walk finds the worker panels, and the twelve registered tools among them", () => {
    expect(workerRows.length).toBeGreaterThanOrEqual(20);
    const registered = workerRows.filter((r) => r.registered);
    expect(registered.map((r) => r.slug).sort()).toEqual(
      Object.keys(WORKER_BATCH_TOOLS).sort(),
    );
    // P3's ten, and P4's Protect and Unlock.
    expect(registered.length).toBe(12);
  });

  it("every registered worker batch's panel loads the batch, and every panel that loads it serves a registered tool", () => {
    for (const r of workerRows.filter((x) => x.registered))
      expect(r.modules, `${r.slug}: ${r.panel} loads no batch`).toEqual([
        r.slug in SECURITY_SLUGS ? SECURITY_BATCH : WORKER_BATCH_RUNNER,
      ]);
    // Batch plan P4: Protect's and Unlock's module is the worker batch with
    // a password form around it, never a batch of its own.
    expect(valueClosure(path.join(ROOT, SECURITY_BATCH)).map(relOf)).toContain(
      WORKER_BATCH_RUNNER,
    );
    const loading = new Set(
      workerRows.filter((r) => r.modules.length > 0).map((r) => r.panel),
    );
    for (const panel of loading)
      expect(
        workerRows.some((r) => r.panel === panel && r.registered),
        `${panel} loads the worker batch for no registered tool`,
      ).toBe(true);
    // Health: six panels serve the twelve tools.
    expect(loading.size).toBe(6);
  });

  it("each registered page names its archive, states its batch, and its limits carry the worker cap", () => {
    for (const r of workerRows.filter((x) => x.registered)) {
      const slug = r.slug as WorkerBatchSlug;
      const served = servedText(r.tool);
      expect(served, `${slug} does not name its archive`).toContain(
        WORKER_BATCH_TOOLS[slug].zipName,
      );
      expect(served, `${slug} does not state its batch`).toContain(
        workerBatchPageSentence(slug),
      );
      expect(batchLimitsSentence(slug)).toContain(
        `${BATCH_LIMITS.workerMaxFiles} ${WORKER_BATCH_TOOLS[slug].noun[1]}`,
      );
      const named = served.match(new RegExp(ARCHIVE_NAME.source, "g")) ?? [];
      expect(
        named.filter((n) => n !== WORKER_BATCH_TOOLS[slug].zipName),
        `${slug} names an archive its batch does not save`,
      ).toEqual([]);
    }
    // Control: an unregistered worker tool names no batch archive.
    const html = workerRows.find((r) => r.slug === "html-to-pdf")!;
    expect(ARCHIVE_NAME.test(servedText(html.tool))).toBe(false);
  });

  it("the hand-off still carries one file to a worker tool until batch plan P6", () => {
    for (const slug of Object.keys(WORKER_BATCH_TOOLS))
      expect(handoffCapabilityFor(slug).mode, slug).not.toBe("batch");
  });
});

/**
 * The sentences that told a reader a P3 tool takes ONE file, as they shipped
 * before its batch (2026-11-08) — the corpus in both directions (CLAUDE.md
 * rule 1). The P1/P2 bans above apply to these pages too; these are the
 * shapes they did not know.
 */
const WORKER_ONE_FILE_SHIPPED = [
  "Add one PDF",
  "It takes a single document; drop several and all but the first are ignored.",
  "Word to PDF takes one document, a Word .docx or .doc, an OpenDocument .odt or a Rich Text .rtf, and hands it to LibreOffice, running headless on pdf.xyz's secure server.",
  "PowerPoint to PDF takes one presentation, a modern .pptx, a legacy .ppt from PowerPoint 97–2003 or an OpenDocument .odp, and returns a PDF with one slide per page.",
  "For a batch, convert one file, press Remove, and add the next.",
  "To hand over several as a single file, convert each one, then combine the PDFs with Merge PDF.",
  "Convert each deck in turn, then combine the resulting PDFs with Merge PDF to hand out a single file for a whole workshop.",
  "The page holds one PDF at a time; press Remove to swap it for another.",
  "A run handles a single PDF, and uploads above 100 MB are refused.",
  "each run takes one PDF of at most 100 MB, sent over TLS.",
  'Drop one PDF onto the box reading "Add a PDF, or browse", or click it and choose the file; up to 100 MB, and there are no settings to choose.',
];

const WORKER_ONE_FILE_BANS: { name: string; pattern: RegExp }[] = [
  {
    name: "add one file",
    pattern:
      /\bAdd (?:one|a single) (?:PDF|file|document|presentation|spreadsheet|book|EPUB)\b/,
  },
  { name: "all but the first are ignored", pattern: /\ball but the first\b/i },
  {
    name: "takes one document",
    pattern:
      /\btakes (?:one|a single) (?:document|presentation|spreadsheet|deck|book|EPUB)\b/i,
  },
  {
    name: "press Remove, and add the next",
    pattern: /\bpress Remove,? and add the next\b/i,
  },
  {
    name: "convert each one yourself",
    pattern: /\bconvert each (?:one|deck|file|document)\b/i,
  },
];

describe("P3 one-file sentences, two ways", () => {
  const ALL = [...ONE_FILE_BANS, ...WORKER_ONE_FILE_BANS];

  it("every shipped sentence is caught, and every new pattern catches one", () => {
    for (const sentence of WORKER_ONE_FILE_SHIPPED)
      expect(
        ALL.some((ban) => ban.pattern.test(sentence)),
        `nothing catches: ${sentence}`,
      ).toBe(true);
    for (const ban of WORKER_ONE_FILE_BANS)
      expect(
        WORKER_ONE_FILE_SHIPPED.some((sentence) => ban.pattern.test(sentence)),
        `${ban.name} catches no shipped sentence`,
      ).toBe(true);
  });

  it("no worker batch tool's page or guide says it takes one file", () => {
    const slugs = Object.keys(WORKER_BATCH_TOOLS);
    const pages = workerRows
      .filter((r) => r.registered)
      .map((r) => ({ where: r.slug, text: servedText(r.tool) }));
    const about = guides.filter((g) => slugs.includes(g.tools[0]!));
    // Health: every tool, and a guide for most.
    expect(pages).toHaveLength(slugs.length);
    expect(about.length).toBeGreaterThanOrEqual(5);
    const corpus = [
      ...pages,
      ...about.map((g) => ({ where: g.slug, text: stringsIn(g).join("\n") })),
    ];
    const found = corpus.flatMap(({ where, text }) =>
      ALL.flatMap((ban) =>
        [
          ...text.matchAll(
            new RegExp(ban.pattern.source, ban.pattern.flags + "g"),
          ),
        ].map((m) => `${where}: ${ban.name} — ${m[0]}`),
      ),
    );
    expect(found).toEqual([]);
  });
});

/**
 * Batch plan P4: Protect PDF and Unlock PDF. Their pages state the password
 * the batch asks for once, and the one-file sentences they shipped before
 * it (2026-11-09) are a corpus in both directions (CLAUDE.md rule 1): the
 * P1–P3 bans already catch most; these are the shapes they did not know.
 */
const SECURITY_ONE_FILE_SHIPPED = [
  "The panel holds a single PDF at a time, and the upload is refused above 100 MB.",
  "Drop a single PDF on the area labelled Add a PDF to password-protect, or browse for one.",
  "Add one PDF",
  'Drop one PDF onto the area that reads "Add a locked PDF, or browse"; clicking that area opens a file picker instead.',
  "It holds a single file of up to 100 MB, and the Remove button next to the file name clears it so you can pick another.",
  "Password-protect a PDF with AES-256 or AES-128 encryption applied by qpdf. One file up to 100 MB, no account, link expires in 60 min.",
  "Your PDF is uploaded over TLS to pdf.xyz's secure server, and the password travels with the job request so our server can encrypt that one file.",
];

const SECURITY_ONE_FILE_BANS: { name: string; pattern: RegExp }[] = [
  { name: "one file up to", pattern: /\bOne (?:file|PDF) up to\b/i },
  { name: "that one file", pattern: /\bthat one (?:file|PDF)\b/i },
];

describe("P4 Protect and Unlock: the batch stated, and one-file sentences two ways", () => {
  const ALL = [
    ...ONE_FILE_BANS,
    ...WORKER_ONE_FILE_BANS,
    ...SECURITY_ONE_FILE_BANS,
  ];
  const slugs = Object.keys(SECURITY_SLUGS) as (keyof typeof SECURITY_SLUGS)[];

  it("each page states the password its batch asks for once", () => {
    for (const slug of slugs) {
      const tool = tools.find((t) => t.slug === slug)!;
      expect(servedText(tool), slug).toContain(securityBatchPageSentence(slug));
    }
  });

  it("every shipped sentence is caught, and every new pattern catches one", () => {
    for (const sentence of SECURITY_ONE_FILE_SHIPPED)
      expect(
        ALL.some((ban) => ban.pattern.test(sentence)),
        `nothing catches: ${sentence}`,
      ).toBe(true);
    for (const ban of SECURITY_ONE_FILE_BANS)
      expect(
        SECURITY_ONE_FILE_SHIPPED.some((sentence) =>
          ban.pattern.test(sentence),
        ),
        `${ban.name} catches no shipped sentence`,
      ).toBe(true);
  });

  it("neither page, nor a guide about either, says it takes one file", () => {
    const pages = slugs.map((slug) => ({
      where: slug,
      text: servedText(tools.find((t) => t.slug === slug)!),
    }));
    const about = guides.filter((g) =>
      (slugs as string[]).includes(g.tools[0]!),
    );
    // Health: both pages, and a guide for each.
    expect(pages).toHaveLength(2);
    expect(about.length).toBeGreaterThanOrEqual(2);
    const found = [
      ...pages,
      ...about.map((g) => ({ where: g.slug, text: stringsIn(g).join("\n") })),
    ].flatMap(({ where, text }) =>
      ALL.flatMap((ban) =>
        [
          ...text.matchAll(
            new RegExp(ban.pattern.source, ban.pattern.flags + "g"),
          ),
        ].map((m) => `${where}: ${ban.name} — ${m[0]}`),
      ),
    );
    expect(found).toEqual([]);
  });
});
