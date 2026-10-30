// @vitest-environment node
/**
 * Components name a ROLE, never a hue — unless the hue is the subject.
 *
 * The token system (globals.css) exists so one component renders correctly
 * in either colour scheme: `bg-wash` is a light well on paper and a dark one
 * on graphite. A raw palette class opts out of that. It was written for the
 * dark theme the site shipped before 2026-08-28 and kept rendering after the
 * paper redesign, so on light paper (the retired classes are written with
 * "·" for their first hyphen, here and in every fixture below — Tailwind
 * scans this file, and this docblock spelling them whole SHIPPED them in the
 * first build after the fix; `shipped-css.test.ts` caught it):
 *
 *   - 16 worker spec lists divided their rows with `divide·white/5`, a white
 *     hairline on a white panel: no dividers at all;
 *   - the Webpage to PDF address field was `bg·slate-950/70`, a near-black
 *     box on paper with no label, its placeholder grey on black;
 *   - text areas, input wells and image letterboxes were `bg·black/20` and
 *     `bg·black/30`, grey slabs in the paper design;
 *   - colour swatches marked the chosen one with `ring·white`, which on a
 *     white panel marks nothing;
 *   - the hero sheet's elevation was a literal `rgba(…)` shadow, the light
 *     scheme's value painted in both.
 *
 * THE RULE: in the shipped class strings of `src/components` and `src/app`,
 * a colour utility may name only a theme role (`bg-panel`, `text-muted`,
 * `ring-line-strong`, …). A Tailwind palette colour, black or white, or a raw
 * colour inside an arbitrary value is reported — unless the colour IS the
 * subject: a page of paper, which is white in both schemes because a PDF page
 * is; or ink drawn on that paper. Those are allowlisted class by class
 * (`src/tests/raw-palette.ts`, shared with the shipped-stylesheet check),
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
import {
  RAW_COLOUR_ALLOWANCE as ALLOWED,
  rawColours,
} from "@/tests/raw-palette";

const ROOT = process.cwd();
const ROOTS = ["src/components", "src/app"];

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
  // Not shipped: the page tile's gradient as one arbitrary value (2026-10-30)
  // is a raw colour by theme variable, and must be caught like `from·white`.
  "rounded-ctl bg-[linear-gradient(to_bottom_right,var(--color·white),transparent)]",
].map((c) => c.replaceAll("·", "-"));

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
        "bg-panel text-muted ring-line-strong divide-line shadow-sheet bg-ok/10 border-err/30 text-xs shadow-lg bg-[linear-gradient(to_right_in_oklab,var(--sf-panel)_0px,transparent_100%)] bg-[var(--color-cat-ink)]",
      ),
    ).toEqual([]);
    // A class quoted in a comment is not read as a class. (Restored from "·"
    // at runtime, like every retired class in this file.)
    expect(
      literals("x.tsx", "// bg·black/20\nconst a = 1;".replaceAll("·", "-")),
    ).toEqual([]);
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
