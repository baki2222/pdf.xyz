/**
 * The motion contract, as scanners a test can run on the real stylesheet and
 * on fixtures. Pure string and brace-depth code: no CSS parser dependency, no
 * DOM, nothing that reaches a client bundle (only `motion-contract.test.ts`
 * imports this).
 *
 * The rules it checks, each a property rather than a list of today's rules:
 *
 *  1. KEYFRAMES ↔ CONSUMERS, both ways. Every `@keyframes` block has a LIVE
 *     consumer, and every `animate-*` class the source uses resolves to a
 *     definition. A keyframe nothing plays is dead weight that reads as a
 *     feature; a utility that resolves to nothing is an animation someone
 *     believes ships.
 *  2. SCROLL-DRIVEN MOTION IS DOUBLY GATED. Every `animation-timeline` other
 *     than `auto` sits inside BOTH an `@supports` that tests
 *     `animation-timeline` and `@media (prefers-reduced-motion:
 *     no-preference)`. A source file may not set one at all (an arbitrary
 *     `[animation-timeline:…]` class or an inline style escapes both gates).
 *  3. THE REDUCED-MOTION RESET IS COMPLETE. Zeroing durations is not enough:
 *     a staggered entrance holds its `from` frame for the length of its
 *     DELAY, a scroll-linked animation follows the scrollbar whatever its
 *     duration, and view transitions animate pseudo-elements a `*` selector
 *     never matches.
 *  4. MOTION IN THE STYLESHEET IS OPT-IN. A rule that animates or
 *     transitions sits inside `no-preference`, so a reduced-motion reader
 *     gets the still end state by construction rather than by the reset
 *     winning a specificity fight.
 */

export interface Declaration {
  property: string;
  value: string;
  line: number;
}

export interface CssBlock {
  /** Selector or at-rule prelude, whitespace collapsed ("" for the root). */
  prelude: string;
  /** Enclosing preludes, outermost first. */
  ancestors: string[];
  declarations: Declaration[];
  children: CssBlock[];
  line: number;
}

/** Comments blanked to spaces, newlines kept, so line numbers stay true. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
}

/**
 * A brace-depth parse: blocks, their preludes and their declarations. Quoted
 * strings are consumed whole, so `content: "{"` cannot open a block.
 */
export function parseCss(css: string): CssBlock {
  const src = stripComments(css);
  const root: CssBlock = {
    prelude: "",
    ancestors: [],
    declarations: [],
    children: [],
    line: 1,
  };
  const stack: CssBlock[] = [root];
  let buffer = "";
  let bufferLine = 1;
  let line = 1;
  const flushDeclaration = () => {
    const text = buffer.trim();
    buffer = "";
    if (!text || text.startsWith("@")) return;
    const colon = text.indexOf(":");
    if (colon <= 0) return;
    stack[stack.length - 1]!.declarations.push({
      property: text.slice(0, colon).trim().toLowerCase(),
      value: text
        .slice(colon + 1)
        .replace(/\s+/g, " ")
        .trim(),
      line: bufferLine,
    });
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (!buffer.trim() && !/\s/.test(ch)) bufferLine = line;
    if (ch === "\n") line++;
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      buffer += src.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "{") {
      const parent = stack[stack.length - 1]!;
      const block: CssBlock = {
        prelude: buffer.replace(/\s+/g, " ").trim(),
        ancestors: [...parent.ancestors, parent.prelude].filter(Boolean),
        declarations: [],
        children: [],
        line: bufferLine,
      };
      parent.children.push(block);
      stack.push(block);
      buffer = "";
    } else if (ch === ";") {
      flushDeclaration();
    } else if (ch === "}") {
      flushDeclaration();
      if (stack.length > 1) stack.pop();
    } else {
      buffer += ch;
    }
  }
  return root;
}

function* blocks(block: CssBlock): Generator<CssBlock> {
  yield block;
  for (const child of block.children) yield* blocks(child);
}

const KEYFRAMES = /^@(?:-webkit-)?keyframes\s+([\w-]+)$/;

/** Every `@keyframes` name, at any depth (Tailwind allows them in `@theme`). */
export function keyframesIn(css: string): string[] {
  const names: string[] = [];
  for (const b of blocks(parseCss(css))) {
    const m = KEYFRAMES.exec(b.prelude);
    if (m) names.push(m[1]!);
  }
  return names;
}

/** Tailwind's built-in animation utilities, which need no definition here. */
export const TAILWIND_DEFAULT_ANIMATIONS = [
  "spin",
  "ping",
  "pulse",
  "bounce",
  "none",
] as const;

export interface Source {
  file: string;
  /**
   * The class-bearing text of the file: its string literals (and inline
   * `animation:` style values), never its comments or prose. The caller
   * extracts it, so this module stays dependency-free.
   */
  text: string;
}

const ANIMATE_CLASS =
  /(?<![\w-])animate-(\[[^\]\s]*\]|\([^)\s]*\)|[a-z0-9][a-z0-9-]*)/g;

/** Every `animate-*` class token in a source, variants stripped. */
export function animateClasses(text: string): string[] {
  return [...text.matchAll(ANIMATE_CLASS)].map((m) => `animate-${m[1]!}`);
}

function usesClass(sources: readonly Source[], cls: string): boolean {
  const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`);
  return sources.some((s) => re.test(s.text));
}

/** A selector list is live when one of its selectors can match: every class it names is used somewhere. */
function selectorIsLive(
  selectorList: string,
  sources: readonly Source[],
): boolean {
  return selectorList
    .split(",")
    .some((selector) =>
      [...selector.matchAll(/\.([\w-]+)/g)].every((m) =>
        usesClass(sources, m[1]!),
      ),
    );
}

const namesIn = (value: string, name: string) =>
  new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(value);

/**
 * For each keyframe, the consumers that can actually play it:
 *  - an `@theme` token `--animate-x: <name> …` whose `animate-x` class is used;
 *  - an `@utility animate-x { animation: <name> … }` whose class is used;
 *  - a style rule `animation(-name): <name>` whose selector can match;
 *  - a source using an arbitrary `animate-[<name>_…]` class or an inline
 *    `animation: "<name> …"` style.
 * A keyframe mapped to `[]` has no live consumer.
 */
export function animationConsumers(
  css: string,
  sources: readonly Source[],
): Map<string, string[]> {
  const names = keyframesIn(css);
  const out = new Map<string, string[]>(names.map((n) => [n, []]));
  for (const b of blocks(parseCss(css))) {
    if (KEYFRAMES.test(b.prelude)) continue;
    const inTheme = [...b.ancestors, b.prelude].some((p) =>
      p.startsWith("@theme"),
    );
    const utility = /^@utility\s+(animate-[\w-]+)$/.exec(b.prelude)?.[1];
    for (const d of b.declarations) {
      for (const name of names) {
        if (!namesIn(d.value, name)) continue;
        let consumer: string | undefined;
        if (inTheme && d.property.startsWith("--animate-")) {
          const cls = d.property.slice(2);
          if (usesClass(sources, cls))
            consumer = `@theme ${d.property} → .${cls}`;
        } else if (
          utility &&
          (d.property === "animation" || d.property === "animation-name")
        ) {
          if (usesClass(sources, utility)) consumer = `@utility ${utility}`;
        } else if (
          (d.property === "animation" || d.property === "animation-name") &&
          !b.prelude.startsWith("@") &&
          selectorIsLive(b.prelude, sources)
        ) {
          consumer = `${b.prelude} (line ${d.line})`;
        }
        if (consumer) out.get(name)!.push(consumer);
      }
    }
  }
  for (const source of sources) {
    for (const name of names) {
      const arbitrary = animateClasses(source.text).some(
        (c) => c.startsWith("animate-[") && namesIn(c, name),
      );
      const inline = [
        ...source.text.matchAll(/\banimation(?:-name)?:\s*([^;]*);/g),
      ].some((m) => namesIn(m[1]!, name));
      if (arbitrary || inline) out.get(name)!.push(source.file);
    }
  }
  return out;
}

/**
 * Every `animate-*` class a source uses that resolves to nothing: not a
 * `--animate-*` token, not an `@utility`, not a `.animate-*` rule in the
 * stylesheet, not a Tailwind default, and not an arbitrary value.
 */
export function unresolvedAnimateClasses(
  css: string,
  sources: readonly Source[],
): { file: string; cls: string }[] {
  const defined = new Set<string>(
    TAILWIND_DEFAULT_ANIMATIONS.map((n) => `animate-${n}`),
  );
  for (const b of blocks(parseCss(css))) {
    const utility = /^@utility\s+(animate-[\w-]+)$/.exec(b.prelude)?.[1];
    if (utility) defined.add(utility);
    for (const m of b.prelude.matchAll(/\.(animate-[\w-]+)/g))
      defined.add(m[1]!);
    if ([...b.ancestors, b.prelude].some((p) => p.startsWith("@theme")))
      for (const d of b.declarations)
        if (d.property.startsWith("--animate-"))
          defined.add(d.property.slice(2));
  }
  const out: { file: string; cls: string }[] = [];
  for (const source of sources)
    for (const cls of new Set(animateClasses(source.text)))
      if (!/^animate-[[(]/.test(cls) && !defined.has(cls))
        out.push({ file: source.file, cls });
  return out;
}

const SUPPORTS_TIMELINE = (p: string) =>
  p.startsWith("@supports") && p.includes("animation-timeline");
const NO_PREFERENCE = (p: string) =>
  p.startsWith("@media") &&
  /prefers-reduced-motion\s*:\s*no-preference/.test(p);
const REDUCE = (p: string) =>
  p.startsWith("@media") && /prefers-reduced-motion\s*:\s*reduce/.test(p);

export interface TimelineViolation {
  where: string;
  value: string;
  missing: ("@supports (animation-timeline)" | "no-preference" | "css")[];
}

/**
 * Every scroll- or view-driven timeline outside the double gate. The reset's
 * own `animation-timeline: auto` (time-driven, the default) is not a timeline
 * to gate, and neither is `none`. Sources may not set a timeline at all.
 */
export function timelineViolations(
  css: string,
  sources: readonly Source[] = [],
): TimelineViolation[] {
  const out: TimelineViolation[] = [];
  for (const b of blocks(parseCss(css))) {
    const context = [...b.ancestors, b.prelude];
    for (const d of b.declarations) {
      if (d.property !== "animation-timeline") continue;
      const value = d.value.replace(/\s*!important$/, "");
      if (value === "auto" || value === "none") continue;
      const missing: TimelineViolation["missing"] = [];
      if (!context.some(SUPPORTS_TIMELINE))
        missing.push("@supports (animation-timeline)");
      if (!context.some(NO_PREFERENCE)) missing.push("no-preference");
      if (missing.length)
        out.push({ where: `line ${d.line}`, value: d.value, missing });
    }
  }
  for (const source of sources) {
    const m = /animation-timeline\s*:\s*([^;\]"'`]*)/.exec(source.text);
    if (m)
      out.push({ where: source.file, value: m[1]!.trim(), missing: ["css"] });
  }
  return out;
}

/** What the reduced-motion reset must contain. */
export const RESET_REQUIREMENTS = [
  {
    property: "animation-duration",
    value: /^0?\.0*1ms !important$|^0s !important$/,
  },
  { property: "animation-iteration-count", value: /^1 !important$/ },
  { property: "animation-delay", value: /^0m?s !important$/ },
  { property: "animation-timeline", value: /^auto !important$/ },
  {
    property: "transition-duration",
    value: /^0?\.0*1ms !important$|^0s !important$/,
  },
  { property: "transition-delay", value: /^0m?s !important$/ },
  { property: "scroll-behavior", value: /^auto !important$/ },
] as const;

/**
 * The requirements a stylesheet's `@media (prefers-reduced-motion: reduce)`
 * blocks do NOT meet, by name. Two parts: a universal rule covering `*`,
 * `*::before` and `*::after` with every entry in {@link RESET_REQUIREMENTS},
 * and a rule stopping the three view-transition pseudo-elements.
 */
export function resetCoverage(css: string): { missing: string[] } {
  const reduce = [...blocks(parseCss(css))].filter((b) => REDUCE(b.prelude));
  const rules = reduce.flatMap((r) => [...blocks(r)].slice(1));
  const missing: string[] = [];
  if (reduce.length === 0)
    missing.push("@media (prefers-reduced-motion: reduce)");
  const universal = rules.filter((r) => {
    const parts = r.prelude.split(",").map((s) => s.trim());
    return ["*", "*::before", "*::after"].every((p) => parts.includes(p));
  });
  if (universal.length === 0) missing.push("a rule for *, *::before, *::after");
  for (const req of RESET_REQUIREMENTS) {
    const met = universal.some((r) =>
      r.declarations.some(
        (d) => d.property === req.property && req.value.test(d.value),
      ),
    );
    if (!met) missing.push(req.property);
  }
  const vt = rules.some((r) => {
    const parts = r.prelude.split(",").map((s) => s.trim());
    return (
      ["group", "old", "new"].every((p) =>
        parts.includes(`::view-transition-${p}(*)`),
      ) &&
      r.declarations.some(
        (d) => d.property === "animation" && d.value === "none !important",
      )
    );
  });
  if (!vt)
    missing.push("::view-transition-group/old/new(*) { animation: none }");
  return { missing };
}

/**
 * Style rules that animate or transition OUTSIDE `no-preference` — motion a
 * reduced-motion reader gets unless the reset happens to win. `@keyframes`
 * bodies, `@theme` tokens and the reset itself are not motion rules.
 */
export function ungatedMotion(
  css: string,
): { selector: string; line: number }[] {
  const out: { selector: string; line: number }[] = [];
  for (const b of blocks(parseCss(css))) {
    if (b.prelude.startsWith("@")) continue;
    const context = [...b.ancestors, b.prelude];
    if (context.some((p) => KEYFRAMES.test(p) || REDUCE(p) || NO_PREFERENCE(p)))
      continue;
    const moves = b.declarations.find(
      (d) =>
        /^(animation|animation-name|transition|transition-property)$/.test(
          d.property,
        ) && !/^none\b/.test(d.value),
    );
    if (moves) out.push({ selector: b.prelude, line: moves.line });
  }
  return out;
}
