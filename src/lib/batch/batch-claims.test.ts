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
 *   2. the registration (`SETTINGS_BATCH_TOOLS`): the archive name the batch
 *      saves and the page quotes;
 *   3. the drop box's caption, typed in the runner: "One or more PDFs · …";
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
  SETTINGS_BATCH_TOOLS,
  batchLimitsSentence,
} from "./tools";

const read = (file: string) =>
  readFileSync(path.isAbsolute(file) ? file : path.join(ROOT, file), "utf8");
const relOf = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join("/");

const BATCH_VIEW = "src/components/tools/runner/batch/batch-view.tsx";
const SETTINGS_BATCH =
  "src/components/tools/runner/batch/settings-batch-runner.tsx";

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
  ].join("\n");
}

/** The drop box captions a runner types (`hint="…"`). */
const hintsOf = (runner: string) =>
  [...read(runner).matchAll(/\bhint="([^"]+)"/g)].map((m) => m[1]!);

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
    claims: {
      handoff:
        handoffCapabilityFor(tool.slug).mode === "batch" &&
        tool.accept.includes("PDF"),
      registered: tool.slug in SETTINGS_BATCH_TOOLS,
      caption: runner
        ? hintsOf(runner).some((h) => h.startsWith(BATCH_HINT_LEAD))
        : false,
      archive: ARCHIVE_NAME.test(servedText(tool)),
    },
  };
});

const backed = rows.filter((r) => r.backed).map((r) => r.slug);

describe("batch claims, walked from the catalogue", () => {
  it("health: the walk reads runners, finds loaders, and finds Compress (positive control)", () => {
    expect(rows.filter((r) => r.runner).length).toBeGreaterThanOrEqual(25);
    // Compress PDF's batch shipped first, through its own runner: the walk
    // must find it, or it cannot find anything.
    expect(backed).toContain("compress-pdf");
    expect(backed.length).toBeGreaterThanOrEqual(
      1 + Object.keys(SETTINGS_BATCH_TOOLS).length,
    );
    // Every claim kind is made somewhere: an empty claim set is vacuous.
    for (const kind of ["handoff", "registered", "caption"] as const)
      expect(
        rows.filter((r) => r.claims[kind]).length,
        `no tool makes the ${kind} claim`,
      ).toBeGreaterThanOrEqual(Object.keys(SETTINGS_BATCH_TOOLS).length);
    expect(rows.filter((r) => r.claims.archive).length).toBeGreaterThanOrEqual(
      Object.keys(SETTINGS_BATCH_TOOLS).length,
    );
  });

  it("every claim is backed by a batch module its runner loads", () => {
    for (const kind of [
      "handoff",
      "registered",
      "caption",
      "archive",
    ] as const) {
      const unbacked = rows
        .filter((r) => r.claims[kind] && !r.backed)
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

  it("each settings batch saves the archive its page names, and its page states the limits", () => {
    const sentence = batchLimitsSentence();
    // The sentence is built from the limits, not typed beside them.
    expect(sentence).toContain(`${BATCH_LIMITS.clientMaxFiles} PDFs`);
    for (const r of rows.filter((x) => x.settings)) {
      const { zipName } =
        SETTINGS_BATCH_TOOLS[r.slug as keyof typeof SETTINGS_BATCH_TOOLS];
      const batchModule = r.modules.find((m) =>
        valueClosure(path.join(ROOT, m)).map(relOf).includes(SETTINGS_BATCH),
      )!;
      expect(
        read(batchModule),
        `${batchModule} saves another tool's archive`,
      ).toContain(`SETTINGS_BATCH_TOOLS["${r.slug}"].zipName`);
      const served = servedText(r.tool);
      expect(served, `${r.slug} does not name its archive`).toContain(zipName);
      expect(served, `${r.slug} does not state the batch limits`).toContain(
        sentence,
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
    const capped = buildToolSummaries()
      .filter((s) => s.batchMaxFiles !== undefined)
      .map((s) => s.slug)
      .sort();
    expect(capped).toEqual([...backed].sort());
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
];

const ONE_FILE_BANS: { name: string; pattern: RegExp }[] = [
  {
    name: "takes / holds / numbers one file",
    pattern:
      /\b(?:takes|holds|numbers|handles) (?:a single|one) (?:PDF|file|form)\b/i,
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

  it("no settings batch tool's page, guide or caption says it takes one file", () => {
    const slugs = Object.keys(SETTINGS_BATCH_TOOLS);
    const pages = rows
      .filter((r) => slugs.includes(r.slug))
      .map((r) => ({ where: r.slug, text: servedText(r.tool) }));
    const about = guides.filter((g) => slugs.includes(g.tools[0]!));
    const captions = rows
      .filter((r) => slugs.includes(r.slug) && r.runner)
      .map((r) => ({ where: r.runner!, text: hintsOf(r.runner!).join("\n") }));
    // Health: every tool, a guide for most, a caption for every runner.
    expect(pages).toHaveLength(slugs.length);
    expect(about.length).toBeGreaterThanOrEqual(slugs.length);
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
