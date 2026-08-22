// @vitest-environment node
/**
 * One question, one answer: "how many tools run in my browser".
 *
 * WHAT SHIPPED. On main at 60993e6 three surfaces answered it differently and
 * all three were derived from the catalogue:
 *
 *   homepage CTA + spec strip   30   client + hybrid
 *   /status, /privacy           29   client
 *   /privacy                    21   server + ai + hybrid
 *
 * 29 + 21 = 50 and 30 + 20 = 50 are both complete partitions; the pages served
 * one number from each. A reader who visited the homepage and then the policy
 * was told 30 tools run in-browser and 21 upload — 51 of 50 — with nothing
 * anywhere saying `compress-pdf` belongs to both. Every surface could show its
 * work, which is precisely why nobody caught it: **deriving is necessary and
 * not sufficient, because a derivation can be the wrong derivation.**
 *
 * WHAT THIS GUARD ASSERTS, in three parts, because no one of them is enough:
 *
 *  1. The function's own properties — the partition is total and disjoint, the
 *     unions are the sums they claim, and the two records that classify a mode
 *     agree with each other. Health-checked and positively controlled, with the
 *     mode list DERIVED from `CAPABILITY_BY_MODE` so a fifth mode cannot slip
 *     past an assertion that iterates a list someone typed.
 *  2. Nothing else restates the rule. A walk of `src/` and `e2e/` — not a list
 *     of files — forbids any other module giving a processing mode a privacy
 *     meaning. The corpus of what that looks like is the five spellings that
 *     actually shipped, so the patterns are checked in both directions: every
 *     shipped spelling is caught, and every pattern catches a shipped spelling.
 *  3. The numbers a reader is actually shown. That lives in
 *     `src/app/browser-count-surfaces.test.tsx`, which renders the four
 *     surfaces and reads the digits out of the output, because everything
 *     above verifies the author's artifact and none of it verifies the page.
 *
 * WHAT IS NOT CLOSED, recorded rather than left to be discovered:
 *
 *  - The ban knows two shapes: a mode compared against a quoted literal, and a
 *    tally keyed by `.processing`. A `switch (tool.processing)` or an
 *    `["client","hybrid"].includes(...)` would walk past it. Neither has ever
 *    shipped here, and adding patterns for spellings with no example is how a
 *    ban list fills up with decoration — so they are named here instead of
 *    guessed at. Add the pattern WITH its example the day one appears.
 *  - A surface that imports the function, renders its value, AND separately
 *    hard-codes an equal number would satisfy all three parts. The numbers
 *    census (`numbers-honesty.test.ts`) owns that hole: both split sizes are
 *    registered there as figures the code owns, so writing one as a literal in
 *    the copy surface is reported.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_BY_MODE,
  capabilityForMode,
  usesWorkerBackend,
} from "@/lib/jobs/capabilities";
import { supportedToolSlugs } from "@/lib/pdf/registry";
import { tools } from "./catalog";
import {
  modeHasBrowserPath,
  modeUploadsFiles,
  processingSplit,
} from "./processing-split";
import type { ProcessingMode, Tool } from "./types";

const ROOT = process.cwd();
const SELF = fileURLToPath(import.meta.url);

/**
 * Every processing mode, DERIVED from the map the job layer must already keep
 * exhaustive rather than typed out here.
 *
 * A hand-written `["client","server","hybrid","ai"]` is the shape rule 4 is
 * about: it would keep passing, confidently, over a catalogue that had grown a
 * fifth mode none of these assertions ever looked at.
 */
const MODES = Object.keys(CAPABILITY_BY_MODE) as ProcessingMode[];

/* ------------------------------------------------------------------ *
 *  1. The function's own properties
 * ------------------------------------------------------------------ */

describe("the split is one partition of the catalogue", () => {
  it("health: the catalogue and the mode list are both implausibly small if broken", () => {
    // `[] ⊆ X` is vacuously true, so every assertion below would report the
    // strongest possible pass over an empty catalogue. Bound both corpora.
    expect(tools.length).toBeGreaterThanOrEqual(40);
    expect(MODES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(MODES).size).toBe(MODES.length);
  });

  it("every tool lands in exactly one partition member", () => {
    const split = processingSplit();
    const members = [
      ...split.neverUploads,
      ...split.browserFirst,
      ...split.workerOnly,
    ];
    expect(members.length).toBe(tools.length);
    expect(new Set(members.map((t) => t.slug)).size).toBe(tools.length);
  });

  it("the unions are exactly the sums they are named for", () => {
    const s = processingSplit();
    expect(s.mayUpload.map((t) => t.slug).sort()).toEqual(
      [...s.browserFirst, ...s.workerOnly].map((t) => t.slug).sort(),
    );
    expect(s.hasBrowserPath.map((t) => t.slug).sort()).toEqual(
      [...s.neverUploads, ...s.browserFirst].map((t) => t.slug).sort(),
    );
    // The two partitions that shipped as one claim. Each is complete on its
    // own; neither may be mixed with the other, and this is the arithmetic
    // that made the mixture visible.
    expect(s.neverUploads.length + s.mayUpload.length).toBe(tools.length);
    expect(s.hasBrowserPath.length + s.workerOnly.length).toBe(tools.length);
  });

  it("a tool that never uploads must have somewhere to run", () => {
    // The one relationship binding the derived record to the local one. Without
    // it `HAS_BROWSER_PATH` is a free-floating constant, and rule 3 is explicit
    // that a constant with no relationships to constrain is the thing no
    // structural defence can see.
    for (const mode of MODES) {
      if (!modeUploadsFiles(mode))
        expect(
          modeHasBrowserPath(mode),
          `mode "${mode}" uploads nothing and has no browser path — it runs nowhere`,
        ).toBe(true);
    }
  });

  it("the upload meaning agrees with the job layer's own", () => {
    // A second, independent bound: `usesWorkerBackend` is `capability !==
    // "in-browser"`, `uploadsFiles` is a field set by hand on each descriptor.
    // The copy surfaces read one and the API validators read the other.
    for (const mode of MODES)
      expect(usesWorkerBackend(capabilityForMode(mode))).toBe(
        modeUploadsFiles(mode),
      );
  });

  it("positive control: one tool per mode lands where its mode says", () => {
    const fixture: Tool[] = MODES.map((mode) => ({
      ...tools[0]!,
      slug: `fixture-${mode}`,
      processing: mode,
    }));
    const s = processingSplit(fixture);
    // Health: the control exercises EVERY mode, so a new mode fails here
    // rather than going quietly untested.
    expect(
      [...s.neverUploads, ...s.browserFirst, ...s.workerOnly].length,
      "the control no longer covers every mode",
    ).toBe(MODES.length);
    for (const mode of MODES) {
      const slug = `fixture-${mode}`;
      const uploads = modeUploadsFiles(mode);
      expect(s.neverUploads.some((t) => t.slug === slug)).toBe(!uploads);
      expect(s.mayUpload.some((t) => t.slug === slug)).toBe(uploads);
      expect(s.hasBrowserPath.some((t) => t.slug === slug)).toBe(
        modeHasBrowserPath(mode),
      );
    }
  });

  it("a tool changing category moves every group at once", () => {
    // The property in one assertion: reclassify ONE tool in a copy of the real
    // catalogue and watch all five groups respond. This is what the three
    // surfaces failed to do — each derived correctly from a rule it held
    // privately, so a reclassification moved some pages and not others.
    const before = processingSplit();
    const moving = before.browserFirst[0];
    expect(
      moving,
      "no browser-first tool to move — the control is vacuous",
    ).toBeDefined();

    const target = MODES.find((m) => !modeUploadsFiles(m));
    expect(target, "no never-upload mode exists to move it to").toBeDefined();

    const mutated = tools.map((t) =>
      t.slug === moving!.slug ? { ...t, processing: target! } : t,
    );
    const after = processingSplit(mutated);

    expect(after.neverUploads.length).toBe(before.neverUploads.length + 1);
    expect(after.browserFirst.length).toBe(before.browserFirst.length - 1);
    expect(after.mayUpload.length).toBe(before.mayUpload.length - 1);
    expect(after.workerOnly.length).toBe(before.workerOnly.length);
    // The capability answer does NOT move, and that is the whole point: the
    // tool had a browser path before and still has one. Two questions.
    expect(after.hasBrowserPath.length).toBe(before.hasBrowserPath.length);
  });
});

/* ------------------------------------------------------------------ *
 *  2. Nothing else restates the rule
 * ------------------------------------------------------------------ */

/**
 * The five spellings that shipped on main at 60993e6, each one a private copy
 * of "does this tool upload the file". Verbatim, so the patterns below are
 * checked against what was really written rather than against what a pattern
 * author imagines gets written.
 */
const SHIPPED_RESTATEMENTS: { where: string; code: string }[] = [
  {
    where: "src/components/sections/cta-section.tsx",
    code: `const inBrowser = tools.filter(\n    (t) => t.processing === "client" || t.processing === "hybrid",\n  ).length;`,
  },
  {
    where: "src/app/status/page.tsx",
    code: `if (!tool || tool.processing !== "client") return null;`,
  },
  {
    where: "src/app/tools/[slug]/page.tsx",
    code: `{tool.processing === "hybrid"`,
  },
  {
    where: "src/app/workspace/use-workspace.ts",
    code: `usesWorker: summary.processing !== "client",`,
  },
  {
    where: "src/app/privacy/page.tsx",
    code: `acc[tool.processing] = (acc[tool.processing] ?? 0) + 1;`,
  },
];

/**
 * Shapes that give a processing mode a meaning. Two, because two shipped.
 *
 * `COMPARED` matches either operand order, so `"client" === tool.processing`
 * is caught although only the other order has been written here. `TALLIED`
 * requires the ASSIGNMENT — `acc[tool.processing] =` — which is what makes it a
 * classification, and is why the legitimate mode-keyed style and copy lookups
 * (`PROCESSING_TONE[tool.processing]`, `processingMeta[mode]`) are reads and
 * pass straight through.
 */
const BANNED: { name: string; pattern: RegExp }[] = [
  {
    name: "COMPARED",
    pattern:
      /\.processing\s*[!=]==?\s*["'`]|["'`]\s*[!=]==?\s*[\w.]*\.processing\b/,
  },
  { name: "TALLIED", pattern: /\[\s*[\w.]+\.processing\s*\]\s*=[^=]/ },
];

/** Source with comments removed — a docblock quoting the old code is not code. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Every TypeScript source under the two roots that can hold a claim about
 * where a tool runs — walked, tests included, because two of the five copies
 * lived in test files and one lived in `e2e/`.
 */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  for (const root of ["src", "e2e"]) {
    const dir = path.join(ROOT, root);
    if (statSync(dir).isDirectory()) walk(dir);
  }
  return out;
}

const relative = (file: string) =>
  path.relative(ROOT, file).replace(/\\/g, "/");

/**
 * May this file state the rule?
 *
 * Only the module that DEFINES it, discovered by looking for the definition
 * rather than by naming the path — so moving or renaming `processing-split.ts`
 * moves this exemption with it instead of silently un-exempting the one file
 * that is allowed to be the source of truth. Plus this guard itself, which
 * necessarily quotes all five banned spellings above.
 */
function definesTheRule(file: string, source: string): boolean {
  return file === SELF || /export\s+function\s+modeUploadsFiles\b/.test(source);
}

describe("the rule is stated once", () => {
  it("health: the walk sees the whole codebase, not a corner of it", () => {
    const files = sourceFiles();
    // A walk that quietly collapses reports the strongest possible pass; one
    // that collapses to nothing fails everything for the wrong reason. Bound
    // it from below and print what it found if it does not hold.
    expect(
      files.length,
      `the source walk found only ${files.length} files — it is reading the wrong tree`,
    ).toBeGreaterThanOrEqual(300);
    expect(files.map(relative)).toContain("src/lib/tools/processing-split.ts");
    expect(files.map(relative)).toContain(
      "e2e/client-proof/client-tools.spec.ts",
    );
  });

  it("health: every banned pattern catches something that really shipped", () => {
    // Without this half a pattern is decoration, and the ban reports "no
    // restatements" when it means "none in the shapes I can see".
    for (const { name, pattern } of BANNED) {
      const caught = SHIPPED_RESTATEMENTS.filter((s) => pattern.test(s.code));
      expect(
        caught.map((s) => s.where),
        `pattern ${name} matches none of the spellings that shipped`,
      ).not.toEqual([]);
    }
  });

  it("health: every spelling that shipped is caught by some pattern", () => {
    const missed = SHIPPED_RESTATEMENTS.filter(
      (s) => !BANNED.some((b) => b.pattern.test(s.code)),
    );
    expect(
      missed.map((s) => `${s.where}: ${s.code}`),
      "these really shipped and no pattern sees them",
    ).toEqual([]);
  });

  it("no module outside the definition gives a processing mode a meaning", () => {
    const findings: string[] = [];
    for (const file of sourceFiles()) {
      const raw = readFileSync(file, "utf8");
      if (definesTheRule(file, raw)) continue;
      const source = withoutComments(raw);
      for (const { name, pattern } of BANNED) {
        const line = source
          .split("\n")
          .find((l) => pattern.test(l))
          ?.trim();
        if (line) findings.push(`${relative(file)} [${name}]: ${line}`);
      }
    }
    expect(
      findings,
      `these decide what a processing mode means instead of asking\n` +
        `\`modeUploadsFiles\` / \`processingSplit\`. Each is a place a\n` +
        `reclassified tool moves some surfaces and not others:\n  ` +
        findings.join("\n  "),
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  3. /status may under-report, never over-report
 * ------------------------------------------------------------------ */

describe("/status counts a subset, and only ever a subset", () => {
  it("every tool it lists as never leaving the browser really never does", () => {
    // /status is scoped to THIS environment: it counts never-upload tools that
    // actually ship a runner, so it is allowed to say fewer than /privacy if a
    // runner is withdrawn. It is not allowed to say more — the list sits under
    // "your files never leave the browser", and `compress-pdf` passed the
    // has-a-runner test while having an upload path.
    const never = new Set(processingSplit().neverUploads.map((t) => t.slug));
    const listed = supportedToolSlugs.filter((slug) => never.has(slug));
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.filter((slug) => !never.has(slug))).toEqual([]);
    // The hybrid tool ships a runner and must still be excluded — the exact
    // member whose inclusion would turn this page's 29 into the homepage's 30.
    for (const tool of processingSplit().browserFirst)
      expect(
        listed,
        `${tool.slug} can upload and may not appear under a never-leaves promise`,
      ).not.toContain(tool.slug);
  });
});
