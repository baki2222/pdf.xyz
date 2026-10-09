// @vitest-environment node
/**
 * Components name a ROLE, never a hue — unless the hue is the subject.
 *
 * The token system (globals.css) exists so one component renders correctly
 * in either colour scheme: `bg-wash` is a light well on paper and a dark one
 * on graphite. A raw palette class opts out of that. It was written for the
 * dark theme the site shipped before 2026-08-28 and kept rendering after the
 * paper redesign, so on light paper:
 *
 *   - 16 worker spec lists divided their rows with `divide-white/5`, a white
 *     hairline on a white panel: no dividers at all;
 *   - the Webpage to PDF address field was `bg-slate-950/70`, a near-black
 *     box on paper with no label, its placeholder grey on black;
 *   - text areas, input wells and image letterboxes were `bg-black/20` and
 *     `bg-black/30`, grey slabs in the paper design;
 *   - colour swatches marked the chosen one with `ring-white`, which on a
 *     white panel marks nothing;
 *   - the hero sheet's elevation was a literal `rgba(…)` shadow, the light
 *     scheme's value painted in both.
 *
 * THE RULE: in the shipped class strings of `src/components` and `src/app`,
 * a colour utility may name only a theme role (`bg-panel`, `text-muted`,
 * `ring-line-strong`, …). A Tailwind palette colour, black or white, or a raw
 * colour inside an arbitrary value is reported — unless the colour IS the
 * subject: a page of paper, which is white in both schemes because a PDF page
 * is; or ink drawn on that paper. Those are allowlisted below class by class,
 * each with its reason, and an entry that no longer matches its file fails,
 * so the list can only shrink.
 *
 * READ AS SHIPPED: string literals through the TypeScript parser, so a class
 * quoted in a comment is not a class. `processing.ts` holds the mode hues and
 * lives outside these roots by design (its own guard is
 * `processing-hue-tables.test.ts`).
 *
 * KNOWN BOUND: a class assembled at runtime (`bg-${hue}-500`) is not seen;
 * none ships, and Tailwind could not generate one anyway.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ROOTS = ["src/components", "src/app"];

const PREFIX =
  "bg|text|border(?:-[trblxyse])?|divide|ring-offset|ring|outline|decoration|shadow|from|via|to|fill|stroke|caret|accent";
const PALETTE =
  "white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

/** A palette colour utility, any variants and opacity included. */
const RAW_UTILITY = new RegExp(
  String.raw`(?<![\w/-])(?:[\w-]+:)*!?(?:${PREFIX})-(?:${PALETTE})(?:-\d{2,3})?(?:\/\d{1,3})?(?![\w-])`,
  "g",
);
/** A raw colour inside an arbitrary value: `shadow-[0_2px_4px_rgba(…)]`. */
const RAW_ARBITRARY =
  /(?<![\w-])(?:[\w-]+:)*!?[a-z][\w-]*-\[[^\]\s]*(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\()[^\]\s]*\]/g;

/** Every raw colour class in a class string, variants stripped. */
export function rawColours(classes: string): string[] {
  return [
    ...classes.matchAll(RAW_UTILITY),
    ...classes.matchAll(RAW_ARBITRARY),
  ].map((m) => m[0].replace(/^(?:[\w-]+:)*!?/, ""));
}

/**
 * Verbatim class strings that shipped before 2026-10-09, one per shape — with
 * the raw colour's first hyphen written "·" and restored at runtime. Tailwind
 * scans test files too, and a fixture spelled whole would ship its classes
 * in the stylesheet (the motion contract's fixtures did exactly that).
 */
const SHIPPED = [
  "bg-panel border-line divide-y divide·white/5 rounded-[4px] border px-4 py-1",
  "border-line text-fg placeholder:text-muted focus:border-info/40 rounded-[3px] border bg·slate-950/70 px-3 py-2 text-sm transition outline-none",
  "w-full rounded-[3px] border border-line bg·black/20 px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-muted focus:border-accent/40 focus:ring-2 focus:ring-accent/50",
  "size-5 rounded-full ring-offset-1 ring-offset·black/40 transition",
  "ring-1 ring·white/20 hover:ring·white/50",
  "border-line bg-panel crop-marks relative border p-4 shadow·[0_28px_48px_-32px_rgba(12,18,26,0.45)] sm:p-5",
  "size-1.5 shrink-0 rounded-full bg·emerald-600",
].map((c) => c.replaceAll("·", "-"));

/**
 * Colours that ARE the subject, by file and class. Each reason says what the
 * colour depicts; a class not listed here is reported even in a listed file.
 */
const PAPER = "a PDF page is white paper in both schemes; this draws one";
const ON_PAPER = "ink drawn on the white page, so it is set against paper";
const ALLOWED: Record<string, Record<string, string>> = {
  "src/components/tools/runner/page-tile.tsx": {
    "bg-white": PAPER,
    "from-white/95": PAPER,
    "to-slate-200/85": `${PAPER} (the sheet's shading)`,
    "ring-black/5": `${PAPER} (its edge)`,
    "shadow-black/40": `${PAPER} (its cast shadow)`,
    "bg-slate-500/50": `${ON_PAPER} (the skeleton's text lines)`,
    "bg-slate-400/40": `${ON_PAPER} (the skeleton's text lines)`,
  },
  "src/components/tools/runner/sign-runner.tsx": {
    "bg-white": PAPER,
    "text-slate-900": `${ON_PAPER} (the signature preview)`,
    "text-slate-600": `${ON_PAPER} (the signature preview's caption)`,
  },
  "src/components/tools/runner/signature-pad.tsx": {
    "bg-white": `${PAPER} (the pad is signed like the page)`,
    "bg-slate-300": `${ON_PAPER} (the pad's baseline)`,
  },
  "src/components/tools/runner/redact-runner.tsx": {
    "bg-white": PAPER,
    "ring-black/10": `${PAPER} (its edge)`,
    "border-slate-400": `${ON_PAPER} (a pending redaction's outline)`,
    "bg-slate-900": `${ON_PAPER} (the redaction box is black, as it will print)`,
  },
  "src/components/tools/runner/edit-runner.tsx": {
    "bg-white": PAPER,
    "ring-black/10": `${PAPER} (its edge)`,
    "border-slate-400/70": `${ON_PAPER} (a placed image's frame)`,
    "bg-slate-200/60": `${ON_PAPER} (a placed image's fill)`,
  },
  "src/components/tools/runner/annotate-runner.tsx": {
    "bg-white": PAPER,
    "ring-black/10": `${PAPER} (its edge)`,
  },
  "src/components/tools/runner/crop-runner.tsx": {
    "bg-white/90": PAPER,
    "ring-black/10": `${PAPER} (its edge)`,
  },
  "src/components/tools/request-signatures-worker-panel.tsx": {
    "bg-white": PAPER,
    "ring-black/10": `${PAPER} (its edge)`,
  },
};

function literals(file: string, source: string): string[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function shipped(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name) && !/\.(?:test|spec)\.tsx?$/.test(e.name))
        out.push(full);
    }
  };
  for (const r of ROOTS) walk(path.join(ROOT, r));
  return out;
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

/** Raw colour classes per file, as the files ship today. */
function census(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const file of shipped()) {
    const found = literals(file, readFileSync(file, "utf8")).flatMap(
      rawColours,
    );
    if (found.length) out.set(rel(file), new Set(found));
  }
  return out;
}

describe("components name a role, never a hue", () => {
  const files = shipped();
  const found = census();

  it("health check: the walk reaches the components and the pages", () => {
    // 163 non-test files under the two roots on 2026-10-09.
    expect(files.length).toBeGreaterThanOrEqual(150);
    expect(files.map(rel)).toContain("src/components/sections/hero.tsx");
    expect(files.map(rel)).toContain("src/app/tools/[slug]/page.tsx");
  });

  it("positive control: every shipped shape is caught, and a theme role is not", () => {
    expect(SHIPPED.filter((c) => rawColours(c).length === 0)).toEqual([]);
    expect(
      rawColours(
        "bg-panel text-muted ring-line-strong divide-line shadow-sheet bg-ok/10 border-err/30 text-xs shadow-lg",
      ),
    ).toEqual([]);
    // A class quoted in a comment is not read as a class.
    expect(literals("x.tsx", "// bg-black/20\nconst a = 1;")).toEqual([]);
  });

  it("no raw colour outside a reasoned allowance", () => {
    const offenders = [...found].flatMap(([file, classes]) =>
      [...classes]
        .filter((cls) => !ALLOWED[file]?.[cls])
        .map((cls) => `${file}  ${cls}`),
    );
    expect(offenders.sort()).toEqual([]);
  });

  it("every allowance still matches its file, so the list can only shrink", () => {
    const stale = Object.entries(ALLOWED).flatMap(([file, classes]) =>
      Object.keys(classes)
        .filter((cls) => !found.get(file)?.has(cls))
        .map((cls) => `${file}  ${cls}`),
    );
    expect(stale).toEqual([]);
  });
});
