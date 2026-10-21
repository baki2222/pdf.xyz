// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Four names are the only corner vocabulary (globals.css `@theme`, spec B.3):
 * `rounded-tag` 2px, `rounded-ctl` 3px, `rounded-panel` 4px and
 * `rounded-sheet` 0px. Everything else is a corner nobody can find by name.
 *
 * Until WP-14 the tree spelled the literals — 209 arbitrary-pixel corners in
 * 81 files, 19 `rounded-md`, 38 `rounded-lg` and 5 bare `rounded` on
 * 2026-10-21 — so "the panel radius" was a convention a reader inferred from
 * 128 copies of `4px`, and `rounded-lg` (8px) quietly made the workspace a
 * second, rounder product. This rejects every spelling that is not a name.
 *
 * THE SET is derived, not typed: every `.ts`, `.tsx` and `.css` file under
 * `src`, tests included. Tailwind reads comments, so the raw text is what is
 * matched for the arbitrary and named arms; a docblock that spells an old
 * class whole ships it in the stylesheet. Bare `rounded` is also an English
 * word, so that arm reads string literals that look like class lists, through
 * the TypeScript parser, never comments or prose.
 *
 * `rounded-full` is not a radius, it is a shape, and the spec keeps it for
 * four things only: status dots, spinners, mode shapes and the scrollbar.
 * That is a claim about PURPOSE no regex can read, so it is pinned per file
 * with a reason, and a file that gains one must say why here.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const SELF = "src/components/radius-vocabulary.test.ts";

/** Assembled at runtime so this file never spells a banned class whole. */
const R = ["round", "ed"].join("");

type Arm = "arbitrary" | "named" | "bare";

/** Side variants (`-t`, `-tl`, `-s`, `-e`…) are the same corner, so the same arm. */
const SIDE = "(?:-[trblse]{1,2})?";
const ARMS: Record<Exclude<Arm, "bare">, RegExp> = {
  arbitrary: new RegExp(`(?<![\\w-])${R}${SIDE}-\\[[^\\]\\s]+\\]`, "g"),
  named: new RegExp(
    `(?<![\\w-])${R}${SIDE}-(?:xs|sm|md|lg|xl|[2-4]xl)(?![\\w-])`,
    "g",
  ),
};
const BARE_TOKEN = new RegExp(`^!?${R}${SIDE}!?$`);

/** A literal reads as a class list when most of its words are utility-shaped. */
function isClassList(literal: string): boolean {
  const words = literal.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  if (words.length === 1) return /^[\w:!/[\].-]+$/.test(words[0]!);
  const shaped = words.filter((w) => /[-:/[]/.test(w)).length;
  return shaped / words.length >= 0.5;
}

/** Bare corner classes in one class-list string (`sm:rounded` counts). */
export function bareCorners(classList: string): string[] {
  if (!isClassList(classList)) return [];
  return classList
    .trim()
    .split(/\s+/)
    .map((w) => w.slice(w.lastIndexOf(":") + 1))
    .filter((w) => BARE_TOKEN.test(w));
}

/** Every banned spelling in a file's text, by arm. */
export function bannedCorners(file: string, text: string): Map<Arm, string[]> {
  const out = new Map<Arm, string[]>();
  for (const [arm, re] of Object.entries(ARMS) as [Arm, RegExp][]) {
    const hits = [...text.matchAll(re)].map((m) => m[0]);
    if (hits.length) out.set(arm, hits);
  }
  if (/\.tsx?$/.test(file)) {
    const bare = literals(file, text).flatMap(bareCorners);
    if (bare.length) out.set("bare", bare);
  }
  return out;
}

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

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(?:tsx?|css)$/.test(e.name)) out.push(full);
    }
  };
  walk(SRC);
  return out.sort();
}

/**
 * Files that may still spell an old corner, each with its reason. Every entry
 * must still match: an exemption nothing needs is a hole waiting for a file.
 */
const ALLOWED: { file: string; arm: Arm; reason: string }[] = [
  {
    file: "src/components/raw-palette.test.ts",
    arm: "arbitrary",
    reason:
      "verbatim class strings that shipped before 2026-10-09 — the raw-palette guard's positive control; test files are not Tailwind sources",
  },
  {
    file: "src/components/tools/run-trigger-focus.test.ts",
    arm: "arbitrary",
    reason:
      "the run trigger's markup as it shipped before WP-10 (d0c0316f), kept verbatim as that guard's positive control",
  },
  {
    file: "src/app/design-tokens.test.ts",
    arm: "arbitrary",
    reason:
      "records the 2026-10-09 census its health check was calibrated on; test files are not Tailwind sources",
  },
];

/**
 * Where `rounded-full` may appear, how often, and what each one is. The count
 * is exact: a new pill or round button in a listed file is still a new pill.
 */
const FULL: { file: string; count: number; reason: string }[] = [
  { file: "src/app/workspace/loading.tsx", count: 1, reason: "spinner" },
  {
    file: "src/components/intent/hero-desk.tsx",
    count: 1,
    reason: "status dot (ok)",
  },
  {
    file: "src/components/intent/ticket-view.tsx",
    count: 1,
    reason: "status dot (ok)",
  },
  {
    file: "src/components/layout/site-footer.tsx",
    count: 1,
    reason: "status dot (systems normal)",
  },
  {
    file: "src/components/status/status-ui.tsx",
    count: 1,
    reason: "status dot inside the status pill",
  },
  {
    file: "src/components/tools/runner/compress-runner.tsx",
    count: 3,
    reason: "status dots inside the three verdict badges",
  },
  {
    file: "src/components/tools/runner/stamp-controls.tsx",
    count: 1,
    reason: "position dot in each cell of the placement grid",
  },
  {
    file: "src/components/tools/runner/fill-forms-runner.tsx",
    count: 1,
    reason:
      "a radio field's glyph: round is what tells it from a checkbox, so squaring it would change its meaning",
  },
];

/** Verbatim strings that shipped on main (34bb612c and earlier), one per arm. */
const SHIPPED: { text: string; arm: Arm }[] = [
  {
    arm: "arbitrary",
    text: `bg-panel border-line flex flex-col gap-4 ${R}-[4px] border p-5`,
  },
  { arm: "arbitrary", text: `size-3 shrink-0 ${R}-[2px]` },
  { arm: "arbitrary", text: `h-[5%] ${R}-[1px] bg-slate-400/40` },
  {
    arm: "named",
    text: `text-muted hover:bg-wash hover:text-err shrink-0 ${R}-md p-1 transition`,
  },
  { arm: "named", text: `bg-wash h-9 animate-pulse ${R}-lg` },
  // Pre-redesign (c419aa89^): the arm's larger sizes were real, not invented.
  { arm: "named", text: `grid size-10 place-items-center ${R}-xl border` },
  {
    arm: "named",
    text: `bg-surface-2 flex flex-col gap-2 ${R}-2xl border border-white/10 p-5`,
  },
  {
    arm: "bare",
    text: `text-muted hover:bg-wash hover:text-fg grid size-5 shrink-0 place-items-center ${R} transition`,
  },
  { arm: "bare", text: `border-line-strong bg-wash size-4 ${R}` },
];

function armsOf(text: string): Arm[] {
  const arms: Arm[] = (Object.entries(ARMS) as [Arm, RegExp][])
    .filter(([, re]) => [...text.matchAll(re)].length > 0)
    .map(([arm]) => arm);
  if (bareCorners(text).length) arms.push("bare");
  return arms;
}

describe("corners are spelled with the four radius names", () => {
  const files = sources();
  const census = new Map(
    files.map((f) => [rel(f), bannedCorners(f, readFileSync(f, "utf8"))]),
  );
  const fullCounts = new Map(
    files
      .map(
        (f) =>
          [
            rel(f),
            [
              ...readFileSync(f, "utf8").matchAll(
                new RegExp(`(?<![\\w-])${R}-full(?![\\w-])`, "g"),
              ),
            ].length,
          ] as const,
      )
      // Shapes are a claim about rendered UI; a test's fixture renders nothing.
      .filter(([f, n]) => n > 0 && f !== SELF && !/\.test\.tsx?$/.test(f)),
  );

  it("health check: the walk reaches the tree, and the tree uses the names", () => {
    // 1,697 .ts/.tsx/.css files under src on 2026-10-21.
    expect(files.length).toBeGreaterThanOrEqual(150);
    expect(files.map(rel)).toContain("src/app/globals.css");
    expect(files.map(rel)).toContain(
      "src/components/tools/runner/runner-kit.tsx",
    );
    const named = files
      .map((f) => readFileSync(f, "utf8"))
      .join("\n")
      .match(
        new RegExp(`(?<![\\w-])${R}-(?:tag|ctl|panel|sheet)(?![\\w-])`, "g"),
      );
    // A sweep that deleted corners instead of naming them would pass the rest.
    expect(named?.length ?? 0).toBeGreaterThan(250);
  });

  it("positive control: every shipped spelling is caught, by the arm that names it", () => {
    expect(SHIPPED.filter((s) => !armsOf(s.text).includes(s.arm))).toEqual([]);
  });

  it("every arm catches some shipped spelling — none is decoration", () => {
    const exercised = new Set(SHIPPED.flatMap((s) => armsOf(s.text)));
    expect([...exercised].sort()).toEqual(["arbitrary", "bare", "named"]);
  });

  it("negative control: the names, a pill, an exempt `none` and prose are not caught", () => {
    expect(
      armsOf(
        `${R}-tag ${R}-ctl sm:${R}-panel ${R}-sheet ${R}-full sm:${R}-none border`,
      ),
    ).toEqual([]);
    expect(
      armsOf(`Floored to a tenth, never ${R}: 5000 / 300 is 16.6`),
    ).toEqual([]);
    expect(
      armsOf(
        `S3-compatible lifecycle expiration is day-granular, so a sub-day retention window (e.g. 60 minutes) is ${R} up to a 1-day backstop.`,
      ),
    ).toEqual([]);
  });

  it("no source spells a corner outside the vocabulary", () => {
    const offenders = [...census]
      .flatMap(([file, arms]) =>
        [...arms].map(([arm, hits]) => ({ file, arm, hits })),
      )
      .filter((o) => !ALLOWED.some((a) => a.file === o.file && a.arm === o.arm))
      .map((o) => `${o.file} [${o.arm}] ${[...new Set(o.hits)].join(" ")}`);
    expect(offenders).toEqual([]);
  });

  it("every exemption still matches what it exempts, and says why", () => {
    const stale = ALLOWED.filter(
      (a) =>
        !(census.get(a.file)?.get(a.arm)?.length ?? 0) || a.reason.length < 20,
    ).map((a) => `${a.file} [${a.arm}]`);
    expect(stale).toEqual([]);
  });

  it("rounded-full is a dot, a spinner, a mode shape or the scrollbar — nothing else", () => {
    const listed = new Map(FULL.map((f) => [f.file, f.count]));
    const unlisted = [...fullCounts]
      .filter(([f, n]) => listed.get(f) !== n)
      .map(([f, n]) => `${f}: ${n} (allowed ${listed.get(f) ?? 0})`);
    const vanished = FULL.filter((f) => !fullCounts.has(f.file)).map(
      (f) => `${f.file}: listed for "${f.reason}", now 0`,
    );
    expect([...unlisted, ...vanished]).toEqual([]);
  });
});
