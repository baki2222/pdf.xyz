// @vitest-environment node
/**
 * The motion contract, held on the real stylesheet and the real source, with a
 * fixture that breaks each rule once (the positive controls).
 *
 * WHY NOW, before a single new animation: the redesign adds a motion layer
 * (crop marks that draw, a veil, staggered rows, scroll-linked rules, view
 * transitions), and each of those reaches a reduced-motion reader through a
 * path the old reset did not close. It zeroed durations only, so:
 *   - a staggered entrance (`transition-delay: calc(var(--i) * 30ms)`) holds
 *     its `from` frame — invisible text — for the whole delay;
 *   - a scroll-driven animation follows the scrollbar, duration or not;
 *   - view transitions animate `::view-transition-*` pseudo-elements, which a
 *     `*` selector never matches.
 * The guard lands first and fails on today's `globals.css` for exactly those
 * three, then the reset is completed.
 *
 * THE CORPUS IS DERIVED. The stylesheet is every `.css` under `src`; the
 * consumers are every non-test `.ts`/`.tsx` under `src` (what ships), read as
 * their STRING LITERALS through the TypeScript parser — so a class named in a
 * comment is not a consumer, and an inline `animation:` style is. Excluded,
 * with reasons: `src/tests` (helpers never ship) and `src/lib/motion` (this
 * instrument quotes the very properties it scans for).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  animateClasses,
  animationConsumers,
  keyframesIn,
  resetCoverage,
  timelineViolations,
  ungatedMotion,
  unresolvedAnimateClasses,
  type Source,
} from "@/lib/motion/contract";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

function walk(dir: string, keep: (file: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, keep);
    return keep(full) ? [full] : [];
  });
}

const STYLE_PROPS: Record<string, string> = {
  animation: "animation",
  animationName: "animation-name",
  animationTimeline: "animation-timeline",
};

/** The class-bearing text of a source: string literals and inline motion styles. */
function classBearingText(file: string, source: string): string {
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
    ) {
      out.push(node.text);
    }
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text in STYLE_PROPS &&
      (ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      out.push(`${STYLE_PROPS[node.name.text]}: ${node.initializer.text};`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.join("\n");
}

const cssFiles = walk(SRC, (f) => f.endsWith(".css"));
const css = cssFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const sources: Source[] = walk(
  SRC,
  (f) =>
    /\.tsx?$/.test(f) &&
    !/\.test\.tsx?$/.test(f) &&
    !f.startsWith(path.join(SRC, "tests") + path.sep) &&
    !f.startsWith(path.join(SRC, "lib", "motion") + path.sep),
).map((f) => ({
  file: rel(f),
  text: classBearingText(f, readFileSync(f, "utf8")),
}));

describe("the corpus is the whole stylesheet and everything that ships", () => {
  it("health check: real CSS, real sources, real consumers", () => {
    expect(cssFiles.map(rel)).toContain("src/app/globals.css");
    expect(sources.length).toBeGreaterThanOrEqual(200);
    expect(keyframesIn(css).length).toBeGreaterThanOrEqual(1);
    // 16 animate-* tokens on 2026-10-09 (pulse, spin, float-up). A reader
    // that lost the literals would find none and pass both directions below.
    expect(
      sources.flatMap((s) => animateClasses(s.text)).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("positive control: the source reader takes literals and inline styles, never comments", () => {
    const text = classBearingText(
      "fixture.tsx",
      `// animate-ghost in a comment
       /* animate-phantom */
       export const A = () => <div className="animate-real" style={{ animation: "rise 1s" }}>animate-prose</div>;`,
    );
    expect(animateClasses(text)).toEqual(["animate-real"]);
    expect(text).toContain("animation: rise 1s;");
  });
});

describe("keyframes and their consumers agree, both ways", () => {
  it("every @keyframes block has a live consumer", () => {
    const orphans = [...animationConsumers(css, sources)]
      .filter(([, consumers]) => consumers.length === 0)
      .map(([name]) => name);
    expect(
      orphans,
      "these keyframes are played by nothing that ships — delete them, or use them",
    ).toEqual([]);
  });

  it("every animate-* class in the source resolves to a definition", () => {
    expect(
      unresolvedAnimateClasses(css, sources),
      "these classes animate nothing: no --animate-* token, @utility, .animate-* rule or Tailwind default defines them",
    ).toEqual([]);
  });

  it("positive control: an orphan keyframe and an undefined class are both caught", () => {
    const fixture = `@keyframes orphan { from { opacity: 0; } }
      @keyframes used { from { opacity: 0; } }
      @theme { --animate-used: used 1s; }`;
    const src: Source[] = [
      { file: "f.tsx", text: "animate-used animate-wiggle animate-spin" },
    ];
    const consumers = animationConsumers(fixture, src);
    expect(consumers.get("orphan")).toEqual([]);
    expect(consumers.get("used")!.length).toBe(1);
    expect(unresolvedAnimateClasses(fixture, src)).toEqual([
      { file: "f.tsx", cls: "animate-wiggle" },
    ]);
    // A consumer whose class nothing uses is not live.
    expect(animationConsumers(fixture, []).get("used")).toEqual([]);
  });
});

describe("scroll-driven motion sits behind @supports AND no-preference", () => {
  it("no timeline escapes either gate, in the stylesheet or the source", () => {
    expect(timelineViolations(css, sources)).toEqual([]);
  });

  it("positive control: each missing gate is named, and the reset's `auto` is not a timeline", () => {
    const fixture = `.a { animation-timeline: view(); }
      @supports (animation-timeline: view()) { .b { animation-timeline: scroll(root); } }
      @supports (animation-timeline: view()) { @media (prefers-reduced-motion: no-preference) { .c { animation-timeline: view(); } } }
      @media (prefers-reduced-motion: reduce) { * { animation-timeline: auto !important; } }`;
    expect(
      timelineViolations(fixture, [
        { file: "x.tsx", text: "[animation-timeline:view()]" },
      ]).map((v) => `${v.where}: ${v.missing.join(" + ")}`),
    ).toEqual([
      "line 1: @supports (animation-timeline) + no-preference",
      "line 2: no-preference",
      "x.tsx: css",
    ]);
  });
});

describe("the reduced-motion reset is complete", () => {
  it("covers delays, timelines and view transitions, not only durations", () => {
    expect(resetCoverage(css).missing).toEqual([]);
  });

  it("positive control: the reset as it shipped until 2026-10-09 is caught", () => {
    // Verbatim the block this guard was written to fail on.
    const shipped = `@media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
        scroll-behavior: auto !important;
      }
      html { scroll-behavior: auto; }
    }`;
    expect(resetCoverage(shipped).missing).toEqual([
      "animation-delay",
      "animation-timeline",
      "transition-delay",
      "::view-transition-group/old/new(*) { animation: none }",
    ]);
    // …and a reset that misses ONLY the delay is caught for the delay alone.
    const noDelay = `@media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        animation-timeline: auto !important;
        transition-duration: 0.001ms !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
      }
      ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }
    }`;
    expect(resetCoverage(noDelay).missing).toEqual(["animation-delay"]);
  });
});

describe("stylesheet motion is opt-in", () => {
  /**
   * Rules allowed to move outside `no-preference`, each with its reason and
   * its exit. Stale entries fail, so this can only shrink.
   */
  const ALLOWED: Record<string, string> = {
    ".animate-float-up":
      "the result panel's entrance, from before the motion contract; the reset stills it. WP-08 moves ResultPanel to animate-rise and deletes this rule.",
  };

  it("every animating rule is inside no-preference, or allowed with a reason", () => {
    const ungated = ungatedMotion(css).map((r) => r.selector);
    expect(ungated.filter((s) => !(s in ALLOWED))).toEqual([]);
    expect(
      Object.keys(ALLOWED).filter((s) => !ungated.includes(s)),
      "an allowed rule no longer moves outside no-preference — delete its entry",
    ).toEqual([]);
  });

  it("positive control: a transition outside no-preference is caught, inside it is not", () => {
    const fixture = `.a { transition: opacity 200ms; }
      @media (prefers-reduced-motion: no-preference) { .b { transition: opacity 200ms; } }
      .c { transition: none; }
      @keyframes k { from { opacity: 0; } }`;
    expect(ungatedMotion(fixture).map((r) => r.selector)).toEqual([".a"]);
  });
});
