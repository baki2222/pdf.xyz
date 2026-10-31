// @vitest-environment node
/**
 * A GUIDE THAT TELLS A READER TO PRESS A CONTROL NAMES ONE ITS TOOLS RENDER.
 *
 * The how-to guides say, in plain prose, "press Take photo", "Press Create
 * PDF, then Download PDF", "drop JPG or PNG files where it says Drop photos
 * here". Option lists were already safe — they go through `labelOf()`, which
 * throws on an unknown id — but a literal control name in a sentence was
 * checked by nothing: the quoted-label guard (tool-page-substance.test.ts)
 * reads tool pages, and only “quoted” labels. Rename a button and every
 * guide pointing at it stays green.
 *
 * ── THE PROSE SIDE: discovered, after evaluation ────────────────────────────
 *
 * Every string anywhere in every `Guide` value (walked, not listed by field:
 * a field added to the type is read the day it ships), AFTER the catalogue's
 * template strings run — the corpus is what a reader receives, not the
 * source text. Labels are extracted by four rules, each of which must catch
 * at least one real guide phrase (CLAUDE.md rule 1, both directions):
 *
 *  - `verb`:    an action word (press, click, tap, choose, select, tick, pick,
 *               keep, under, says, labelled …) followed by a CAPITAL-led
 *               phrase. Only capital-led phrases are labels: "pick your PDF"
 *               names a file, "pick Helvetica" names a choice. An article
 *               right after the verb ("pick a PDF", "choose the …") ends it —
 *               what follows an article is a thing, not a label — and so does
 *               a file format ("choose JPG or PNG photos" names the files).
 *  - `quoted`:  an action word, optionally an article, then a “quoted” phrase
 *               — the quote IS the boundary. Four more words introduce a
 *               label only when it is quoted: with, when, leave, enter
 *               ("With “Flatten every page”", "When “Your PDF is ready.”").
 *  - `chain`:   "X or Y", "X and Y", "X, then Y" after a label, when Y is
 *               capital-led or quoted ("press Replace or Replace all",
 *               "Press Crop PDF, then Download cropped PDF").
 *  - `button`:  "the X button", X capital-led.
 *
 * ── THE BOUNDARY RULE ───────────────────────────────────────────────────────
 *
 * Labels here are sentence case ("Download cropped PDF", "Apply & download"),
 * so a capital-only run is too short, and a run to the full stop is too long
 * ("Crop PDF and download the result"). So every extraction carries TWO
 * bounds, and the label must lie between them:
 *
 *  - `core`: the phrase up to the first STOP word (a function word such as
 *    and / or / to / then / for / of / has, or another action word) or any
 *    punctuation. The label must CONTAIN this. Articles do not stop it:
 *    "Tick Draw a thin border around each page" has the core "Draw a thin
 *    border around", so a lone "Draw" elsewhere on screen cannot vouch for it.
 *  - `run`:  the phrase up to the first punctuation or action word. The label
 *    must FIT inside this.
 *
 * A label matches if some on-screen string L satisfies core ⊑ L ⊑ run (word
 * prefixes). "tick Tile across the page to repeat the mark": core "Tile
 * across the page", run the whole clause, L "Tile across the page". The stop
 * list was worked out against the real guides (its history is in the PR):
 * the first run flagged "A field that reads Not set has no value" and "keep
 * Auto orientation", and `GUIDE_UI_LABELS_PRINT=1` prints every extraction and what it
 * matched.
 *
 * ── THE UI SIDE: derived ────────────────────────────────────────────────────
 *
 *   guide.tools → the module each tool page mounts as its panel
 *   (`ownPanelModules()`: registry kind → runner dispatcher case, or the
 *   worker-panel registry) → every module in `src` reachable from it by a
 *   VALUE import (static, re-export, or `import()`; `import type` is erased
 *   and not followed) → from each module UNDER `src/components`, every
 *   string it can render: JSX text, string literals, template literals (each
 *   `${…}` a wildcard), JSX children with expressions (each `{…}` a
 *   wildcard). A drop zone's "…, or" title is also read with the "browse"
 *   control that follows it on screen.
 *
 * ── VISIBLE, NOT MERELY PRESENT (2026-10-31) ────────────────────────────────
 *
 * A guide writes for a SIGHTED reader ("choose Numbering style"), so a string
 * that only assistive technology receives is not a label it may name. Until
 * 2026-10-31 every string counted, and "Numbering style" — Add Page Numbers'
 * `SegmentedControl` label, rendered only as the radiogroup's `aria-label` —
 * would have passed. A string is HIDDEN when it is:
 *
 *  - the value of `aria-label` / `aria-description` / `aria-roledescription`
 *    / `aria-valuetext` / `title` / `alt` on an INTRINSIC element (a
 *    `title` is a hover tooltip: never on screen on touch, and not text);
 *  - inside an element whose `className` carries the `sr-only` token;
 *  - a prop of a component whose every use inside that component is in one
 *    of those positions (one hop; `SegmentedControl`'s `label`).
 *
 * …unless the same string is ALSO visible anywhere in the guide's scope
 * (find-panel's "Replace with" is an sr-only <label> and the input's
 * placeholder, which is drawn). A label that matches only hidden text fails
 * with the hidden string in the message.
 *
 * From the modules OUTSIDE `src/components`, labels only: the string values of
 * `label` / `…Label` properties and of `…_LABEL(S)` constants — the convention
 * every option list the runners draw from uses (`SCAN_ENHANCEMENTS[i].label`,
 * `SIGNATURE_STYLE_LABEL`).
 *
 * A sentence that names another tool by its catalogue name ("use PDF to Word
 * with “Recognise text in scans (OCR)”") may name that tool's controls too,
 * so that tool's screens join the scope for that sentence — but not when the
 * only mention is the label itself, or "Press Rotate PDF" would summon Rotate
 * PDF's screen to vouch for it (the positive control holds this).
 *
 * WHAT THAT COSTS, said plainly:
 *
 *  - It is a MODULE graph, so it over-approximates (CLAUDE.md rule 4): a
 *    string in a module the runner imports but never renders counts, and a
 *    label in a shared component passes for every runner that loads it. The
 *    direction is permissive. The tools catalogue (`src/lib/tools`), which
 *    every panel reaches and which holds every tool's NAME, description and
 *    FAQ prose, is read for labels only: with all its strings, "Press Merge
 *    PDF" would pass in every guide.
 *  - A string that exists on screen is not proof it is a BUTTON. This checks
 *    that the named control's text exists in the tools' UI, not its role.
 *  - Short cores are weak: "press Select", "press Download" pass on any
 *    on-screen "Select" / "Download" in the scope.
 *  - A label the extractor cannot see is not checked: one after an article
 *    ("pick a Page size"), after a verb not in the lists, or lower-case.
 *    The corpus count and its floor are what say the extractor still sees
 *    most of them.
 *  - The union over all of a guide's tools, not just the primary: guides
 *    name neighbours' controls ("in Compress PDF, press …").
 */
import ts from "typescript";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guides } from "./catalog";
import type { Guide } from "./types";
import { formatForToken } from "@/lib/intent/formats";
import { tools } from "@/lib/tools";
import {
  SRC,
  ownPanelModules,
  parsedSource,
  rel,
  resolveComponent,
  valueClosure,
} from "@/tests/tool-panel-modules";

/* ------------------------------------------------------------------ *
 *  The prose side
 * ------------------------------------------------------------------ */

interface ProseString {
  /** Where in the guide value, e.g. `steps[2]`, `faq[0].answer`. */
  at: string;
  text: string;
}

/** Every string in a guide value, wherever it sits. */
function proseStrings(guide: Guide): ProseString[] {
  const out: ProseString[] = [];
  const walk = (value: unknown, at: string): void => {
    if (typeof value === "string") out.push({ at, text: value });
    else if (Array.isArray(value))
      value.forEach((v, i) => walk(v, `${at}[${i}]`));
    else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value))
        walk(v, at ? `${at}.${k}` : k);
  };
  walk(guide, "");
  return out;
}

/** Words that start a label: the reader is told to act on what follows. */
const TRIGGERS = new Set([
  "press",
  "click",
  "tap",
  "choose",
  "select",
  "tick",
  "untick",
  "pick",
  "keep",
  "under",
  "says",
  "labelled",
  "labeled",
]);

/**
 * Words that end a label's CORE (it may still run past them, up to `run`).
 * Function words only — every content word, capital or not, continues the
 * label ("Download cropped PDF", "Save metadata").
 */
const STOPS = new Set([
  "and",
  "or",
  "then",
  "to",
  "for",
  "of",
  "so",
  "until",
  "if",
  "when",
  "in",
  "on",
  "at",
  "by",
  "as",
  "from",
  "with",
  "into",
  "onto",
  "again",
  "it",
  "its",
  "each",
  "every",
  "before",
  "after",
  "above",
  "below",
  "beside",
  "there",
  "here",
  "instead",
  "first",
  "but",
  "while",
  "once",
  "is",
  "are",
  "has",
  "have",
  "button",
]);
const ARTICLES = new Set(["a", "an", "the", "its"]);
/**
 * Words that introduce a control only when what follows is “quoted”: "With
 * “Flatten every page”", "leave “Source language”", "When “Your PDF is
 * ready.”" — bare, they are ordinary prose ("with a password").
 */
const QUOTE_TRIGGERS = new Set(["with", "when", "leave", "enter"]);
const CHAINS = new Set(["or", "and", "then"]);

type Rule = "verb" | "quoted" | "chain" | "button";

interface Extracted {
  rule: Rule;
  /** Lower bound: the label contains this. */
  core: string;
  /** Upper bound: the label fits inside this. */
  run: string;
}

type Token =
  | { kind: "word"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "punct"; text: string };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /“([^”]*)”|"([^"]*)"|([\p{L}\p{N}][\p{L}\p{N}'’/-]*|&)|(\S)/gu;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined || m[2] !== undefined)
      out.push({ kind: "quote", text: (m[1] ?? m[2])! });
    else if (m[3] !== undefined) out.push({ kind: "word", text: m[3] });
    else out.push({ kind: "punct", text: m[4]! });
  }
  return out;
}

const capitalLed = (t: Token | undefined): boolean =>
  t?.kind === "word" && /^\p{Lu}/u.test(t.text);
const lower = (t: Token | undefined): string =>
  t?.kind === "word" ? t.text.toLowerCase() : "";

/** The control names a sentence tells the reader to act on. */
function extractLabels(text: string): Extracted[] {
  const tokens = tokenize(text);
  const out: Extracted[] = [];

  /** A bare label starting at `j`; returns the index after its core. */
  const bare = (j: number, rule: Rule): number => {
    let k = j;
    const core: string[] = [];
    while (
      tokens[k]?.kind === "word" &&
      (k === j ||
        (!STOPS.has(lower(tokens[k])) && !TRIGGERS.has(lower(tokens[k]))))
    )
      core.push(tokens[k++]!.text);
    let r = j;
    const run: string[] = [];
    while (
      tokens[r]?.kind === "word" &&
      (r === j || !TRIGGERS.has(lower(tokens[r])))
    )
      run.push(tokens[r++]!.text);
    // A phrase led by a file format names the FILE chosen, not a control:
    // "choose JPG or PNG photos". Not recorded — and no chain from it.
    if (formatForToken(core[0]!) === null)
      out.push({ rule, core: core.join(" "), run: run.join(" ") });
    return k;
  };
  const quoted = (j: number, rule: Rule): number => {
    const t = tokens[j]!.text.trim();
    out.push({ rule, core: t, run: t });
    return j + 1;
  };
  /** After a label ends at `k`: "or Y", "and Y", ", then Y". */
  const chain = (k: number): void => {
    let c = k;
    if (tokens[c]?.kind === "punct" && tokens[c]!.text === ",") c++;
    if (!CHAINS.has(lower(tokens[c]))) return;
    c++;
    if (lower(tokens[c - 1]) === "and" && lower(tokens[c]) === "then") c++;
    if (tokens[c]?.kind === "quote") chain(quoted(c, "chain"));
    else if (capitalLed(tokens[c])) chain(bare(c, "chain"));
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    // "the X button"
    if (lower(t) === "the" && capitalLed(tokens[i + 1])) {
      let k = i + 1;
      const words: string[] = [];
      while (tokens[k]?.kind === "word" && lower(tokens[k]) !== "button")
        words.push(tokens[k++]!.text);
      if (
        lower(tokens[k]) === "button" &&
        words.length > 0 &&
        words.length <= 6
      ) {
        const label = words.join(" ");
        out.push({ rule: "button", core: label, run: label });
      }
      continue;
    }
    const quoteOnly = QUOTE_TRIGGERS.has(lower(t));
    if (!TRIGGERS.has(lower(t)) && !quoteOnly) continue;
    let j = i + 1;
    const articled = ARTICLES.has(lower(tokens[j]));
    if (articled) j++;
    if (tokens[j]?.kind === "quote") chain(quoted(j, "quoted"));
    else if (quoteOnly) continue;
    else if (!articled && capitalLed(tokens[j])) chain(bare(j, "verb"));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  The UI side
 * ------------------------------------------------------------------ */

const COMPONENTS = path.join(SRC, "components") + path.sep;

const decode = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&rsquo;|&#39;/g, "’")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");
const squash = (s: string): string => s.replace(/\s+/g, " ").trim();
/** One apostrophe, so a ’ in prose meets a ' in code. */
const norm = (s: string): string => squash(s).replace(/'/g, "’");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Rendered {
  /** Strings a SIGHTED reader can see. */
  exact: Set<string>;
  /** Strings with `${…}` / `{…}` holes, as anchored patterns (visible only). */
  patterns: RegExp[];
  /**
   * Strings that reach only assistive technology — never drawn on their own
   * (see {@link HIDDEN_ATTRS}, {@link isSrOnly}, {@link hiddenProps}). After
   * `uiOf`, a string that is ALSO visible somewhere in scope is not here.
   */
  hidden: Set<string>;
}

/** A string with holes, as a pattern whose holes are one or more words. */
const holed = (parts: string[]): RegExp =>
  new RegExp(
    `^${parts.map((p) => escape(norm(p))).join("\\s*[\\p{L}\\p{N}][^]*?\\s*")}$`,
    "u",
  );

/* ------------------------------------------------------------------ *
 *  Visible or not: what a sighted reader never sees
 * ------------------------------------------------------------------ */

/**
 * Attributes whose text is read out but not drawn. `title` is a hover
 * tooltip — not on screen until a mouse rests there, never on touch — so it
 * is not a label a guide can send a reader to look for either.
 */
const HIDDEN_ATTRS = new Set([
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "title",
  "alt",
]);

/**
 * Does this element carry the `sr-only` class? The exact class token, in a
 * literal or in any string inside the `className` expression (`cn(…)`). A
 * responsive variant (`max-sm:sr-only`) is visible at other widths, so it is
 * not the token. `sr-only focus:not-sr-only` (a skip button) still counts as
 * hidden: it appears only under keyboard focus, never to a reader looking.
 */
function isSrOnly(el: ts.JsxOpeningLikeElement): boolean {
  for (const prop of el.attributes.properties) {
    if (!ts.isJsxAttribute(prop) || prop.name.getText() !== "className")
      continue;
    let hit = false;
    const v = (x: ts.Node): void => {
      if (
        (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) &&
        x.text.split(/\s+/).includes("sr-only")
      )
        hit = true;
      ts.forEachChild(x, v);
    };
    if (prop.initializer) v(prop.initializer);
    if (hit) return true;
  }
  return false;
}

/**
 * A hidden attribute on an INTRINSIC element (`<div aria-label>`, `<button
 * title>`). On a component, `title` is whatever that component makes of it —
 * runner-kit's `<Section title="Format">` draws a heading — so a component's
 * props go through {@link hiddenProps} instead.
 */
const isHiddenAttr = (a: ts.JsxAttribute): boolean =>
  HIDDEN_ATTRS.has(a.name.getText()) &&
  /^[a-z]/.test(a.parent.parent.tagName.getText());

/** Is `n`, inside the function `stop`, in a hidden position? */
function inHiddenPosition(n: ts.Node, stop: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p && p !== stop; p = p.parent) {
    if (ts.isJsxAttribute(p) && isHiddenAttr(p)) return true;
    if (ts.isJsxElement(p) && isSrOnly(p.openingElement)) return true;
  }
  return false;
}

/** The function that defines component `name` in `sf`, or null. */
function componentFunction(
  sf: ts.SourceFile,
  name: string,
): ts.FunctionLikeDeclaration | null {
  const fnOf = (
    x: ts.Expression | undefined,
  ): ts.FunctionLikeDeclaration | null => {
    if (!x) return null;
    if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) return x;
    // forwardRef(…) / memo(…)
    if (ts.isCallExpression(x)) return fnOf(x.arguments[0]);
    return null;
  };
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === name)
          return fnOf(d.initializer);
  }
  return null;
}

const hiddenPropsCache = new Map<string, Set<string>>();
/**
 * The props of component `tag` (as `file` names it) that reach ONLY hidden
 * positions inside it — `SegmentedControl`'s `label`, which renders as its
 * radiogroup's `aria-label` and nowhere else, so "Numbering style" on Add
 * Page Numbers is never on screen. One hop: a prop forwarded to another
 * component counts as visible (the permissive direction), and so does a
 * component this cannot follow (a package's).
 */
function hiddenProps(file: string, tag: string): Set<string> {
  let resolved;
  try {
    resolved = resolveComponent(file, tag);
  } catch (error) {
    // Only "not ours to follow" (a package's component) is permissive. Any
    // other throw — a ReferenceError, a cycle — is a broken instrument, and
    // swallowing it would report every prop visible: the strongest pass.
    if (/is neither declared there nor bound/.test(String(error)))
      return new Set();
    throw error;
  }
  const key = `${resolved.file}#${resolved.name}`;
  const hit = hiddenPropsCache.get(key);
  if (hit) return hit;
  const out = new Set<string>();
  hiddenPropsCache.set(key, out);
  const fn = componentFunction(parsedSource(resolved.file), resolved.name);
  const param = fn?.parameters[0];
  if (!fn || !param || !ts.isObjectBindingPattern(param.name)) return out;
  for (const el of param.name.elements) {
    if (el.dotDotDotToken || !ts.isIdentifier(el.name)) continue;
    const local = el.name.text;
    const prop =
      el.propertyName && ts.isIdentifier(el.propertyName)
        ? el.propertyName.text
        : local;
    const uses: ts.Identifier[] = [];
    const v = (x: ts.Node): void => {
      // A reference, not a property NAME: `option.label` and `label=` are
      // other things that happen to be spelt the same.
      const p = x.parent;
      const isName =
        !!p &&
        ((ts.isPropertyAccessExpression(p) && p.name === x) ||
          (ts.isJsxAttribute(p) && p.name === x) ||
          (ts.isPropertyAssignment(p) && p.name === x) ||
          (ts.isPropertySignature(p) && p.name === x) ||
          (ts.isBindingElement(p) && p.propertyName === x));
      if (ts.isIdentifier(x) && x.text === local && x !== el.name && !isName)
        uses.push(x);
      ts.forEachChild(x, v);
    };
    if (fn.body) v(fn.body);
    if (uses.length > 0 && uses.every((u) => inHiddenPosition(u, fn)))
      out.add(prop);
  }
  return out;
}

const renderedCache = new Map<string, Rendered>();
/** Every string a module can put on screen (see the docblock for which). */
function renderedBy(file: string): Rendered {
  const cached = renderedCache.get(file);
  if (cached) return cached;
  const exact = new Set<string>();
  const hidden = new Set<string>();
  const patterns: RegExp[] = [];
  const isComponent = file.startsWith(COMPONENTS);
  const addText = (s: string, h: boolean) => {
    const t = norm(decode(s));
    if (t) (h ? hidden : exact).add(t);
  };
  const addTemplate = (parts: string[], h: boolean) => {
    // A hidden template draws nothing a reader could be sent to look for.
    if (h) return;
    // A pattern must OPEN with a literal word: `${name} PDF` would match
    // every "<anything> PDF" a guide could invent ("Frobnicate PDF" passed
    // through one on the first run).
    if (!/\p{L}/u.test(parts[0]!)) return;
    patterns.push(holed(parts.map(decode)));
  };
  const sf = parsedSource(file);
  /** `h`: this node is in a hidden position (an sr-only subtree, an aria-label). */
  const visit = (n: ts.Node, h: boolean): void => {
    let inner = h;
    if (isComponent) {
      if (ts.isStringLiteral(n) && !ts.isImportDeclaration(n.parent))
        addText(n.text, h);
      else if (ts.isNoSubstitutionTemplateLiteral(n)) addText(n.text, h);
      else if (ts.isTemplateExpression(n))
        addTemplate(
          [n.head.text, ...n.templateSpans.map((s) => s.literal.text)],
          h,
        );
      else if (ts.isJsxAttribute(n)) {
        const name = n.name.getText(sf);
        const tag = n.parent.parent.tagName.getText(sf);
        if (
          isHiddenAttr(n) ||
          (/^\p{Lu}\w*$/u.test(tag) && hiddenProps(file, tag).has(name))
        )
          inner = true;
      } else if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
        if (ts.isJsxElement(n) && isSrOnly(n.openingElement)) inner = true;
        // The element's own text, `{…}` children as holes, nested
        // elements as boundaries: "Download {kind} PDF".
        const parts: string[] = [""];
        let holes = 0;
        for (const child of n.children) {
          if (ts.isJsxText(child)) {
            addText(child.text, inner);
            parts[parts.length - 1] += child.text;
          } else if (ts.isJsxExpression(child) && child.expression) {
            parts.push("");
            holes++;
          } else {
            // An element BEFORE any text or hole is a leading icon, a
            // boundary rather than a word: `<Plus /> Merge {n} PDF{s}`
            // reads "Merge 2 PDFs" on screen. Counted as a hole, it made
            // the pattern open with no literal word, and the opening-word
            // rule below dropped the button entirely (2026-10-30, the
            // double-sided-scans guide). A leading `{…}` is still a hole.
            if (holes === 0 && !/\p{L}/u.test(parts[0]!)) {
              parts[0] = "";
              continue;
            }
            parts.push("");
            holes++;
          }
        }
        if (holes > 0) addTemplate(parts, inner);
      }
    } else {
      // Outside the components: labels only — and whether one is drawn is
      // decided where a component renders it, so these count as visible.
      if (
        ts.isPropertyAssignment(n) &&
        /^(label|.*Label)$/.test(n.name.getText(sf)) &&
        ts.isStringLiteral(n.initializer)
      )
        addText(n.initializer.text, false);
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        /_LABELS?$/.test(n.name.text) &&
        n.initializer
      ) {
        const v = (x: ts.Node): void => {
          if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x))
            addText(x.text, false);
          ts.forEachChild(x, v);
        };
        v(n.initializer);
      }
    }
    ts.forEachChild(n, (c) => visit(c, inner));
  };
  visit(sf, false);
  const value = { exact, patterns, hidden };
  renderedCache.set(file, value);
  return value;
}

const { bySlug } = ownPanelModules();

/** What a set of tool pages renders, and the modules it was read from. */
function uiOf(slugs: readonly string[]): Rendered & { files: string[] } {
  const files = new Set<string>();
  for (const slug of slugs) {
    const panel = bySlug.get(slug);
    if (!panel) continue;
    for (const f of valueClosure(panel.file)) files.add(f);
  }
  const exact = new Set<string>();
  const hidden = new Set<string>();
  const patterns: RegExp[] = [];
  for (const f of files) {
    const r = renderedBy(f);
    for (const s of r.exact) exact.add(s);
    for (const s of r.hidden) hidden.add(s);
    patterns.push(...r.patterns);
  }
  // Visible anywhere in the scope is visible.
  for (const s of exact) hidden.delete(s);
  return { exact, patterns, hidden, files: [...files] };
}

/**
 * The screen-reader-only string a missing label names, for the message: the
 * label is in the code, and a sighted reader never sees it.
 */
function hiddenMatch(x: Extracted, ui: Rendered): string | null {
  const run = norm(x.run).split(" ");
  const coreLen = norm(x.core).split(" ").length;
  for (let n = coreLen; n <= run.length; n++) {
    const candidate = run.slice(0, n).join(" ");
    if (ui.hidden.has(candidate)) return candidate;
  }
  return null;
}

/**
 * A rendered string as a reader's sentence can carry it: the whole string,
 * and its leading clause (a prose sentence cannot carry "Drop your PDF here,
 * or" past its own comma).
 */
function leadingClauses(ui: Rendered): Set<string> {
  const out = new Set<string>();
  for (const s of ui.exact) {
    out.add(s);
    // A drop zone renders its "…, or" title followed by its "browse"
    // control (drop-sheet-face.tsx), so a reader sees the two as one line —
    // the composition drop-zone-label-claims.test.ts pins for tool pages.
    if (s.endsWith(", or") && ui.exact.has("browse")) out.add(`${s} browse`);
    const lead = s.split(/[,;:.!?…(]/)[0]!.trim();
    if (lead) out.add(lead);
  }
  return out;
}

/**
 * The rendered string L with core ⊑ L ⊑ run, as evidence — the exact string,
 * or the pattern that matched it — or null.
 */
function matches(
  x: Extracted,
  ui: Rendered,
  clauses: ReadonlySet<string>,
): string | null {
  const run = norm(x.run).split(" ");
  const coreLen = norm(x.core).split(" ").length;
  for (let n = coreLen; n <= run.length; n++) {
    const candidate = run.slice(0, n).join(" ");
    if (clauses.has(candidate)) return `= “${candidate}”`;
    const p = ui.patterns.find((re) => re.test(candidate));
    if (p) return `~ ${p.source}`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  Names that are on screen but not ours to render
 * ------------------------------------------------------------------ */

/**
 * Each entry is a phrase the guides tell a reader to act on that is
 * legitimately NOT a label in our UI, with why. Every entry must be USED by
 * the corpus (a test below fails on a stale one).
 */
const NOT_OUR_LABELS: Readonly<Record<string, string>> = {
  "Invoice number":
    "text inside the READER'S document — Split PDF's split-by-text example (pages that begin with it)",
  "Account summary": "the same split-by-text example, a second document kind",
  Enter:
    "a keyboard key — organize's keyboard reorder: press Enter or Space to grab a tile",
  Space: "a keyboard key — the same keyboard reorder",
};

/* ------------------------------------------------------------------ *
 *  The guard
 * ------------------------------------------------------------------ */

interface Finding {
  guide: string;
  at: string;
  rule: Rule;
  label: string;
  /** What it matched on screen, or null. */
  evidence?: string | null;
  /** When it matched nothing visible: the screen-reader-only string it names. */
  srOnly?: string;
}

const scopes = new Map<string, { ui: Rendered; clauses: Set<string> }>();
/**
 * The tools whose screens a label may be on: the guide's own `tools`, plus
 * any tool the SAME sentence names by its catalogue name ("use PDF to Word
 * with “Recognise text in scans (OCR)”") — but not by the label itself, or
 * "Press Rotate PDF" would summon Rotate PDF's screen to vouch for it.
 */
function scopeFor(guide: Guide, text: string, x: Extracted) {
  const rest = text.split(x.core).join(" ");
  const slugs = [
    ...new Set([
      ...guide.tools,
      ...tools.filter((t) => rest.includes(t.name)).map((t) => t.slug),
    ]),
  ].sort();
  const key = slugs.join(",");
  let scope = scopes.get(key);
  if (!scope) {
    const ui = uiOf(slugs);
    scope = { ui, clauses: leadingClauses(ui) };
    scopes.set(key, scope);
  }
  return scope;
}

function audit(list: readonly Guide[]) {
  const checked: Finding[] = [];
  const missing: Finding[] = [];
  const allowUsed = new Set<string>();
  const byRule = new Map<Rule, number>();
  let srOnlyHits = 0;
  for (const guide of list) {
    for (const { at, text } of proseStrings(guide)) {
      for (const x of extractLabels(text)) {
        const { ui, clauses } = scopeFor(guide, text, x);
        const f = { guide: guide.slug, at, rule: x.rule, label: x.core };
        byRule.set(x.rule, (byRule.get(x.rule) ?? 0) + 1);
        if (x.core in NOT_OUR_LABELS) {
          allowUsed.add(x.core);
          continue;
        }
        const evidence = matches(x, ui, clauses);
        checked.push({ ...f, evidence });
        if (!evidence) {
          const sr = hiddenMatch(x, ui);
          missing.push(sr ? { ...f, srOnly: sr } : f);
          if (sr) srOnlyHits++;
        }
      }
    }
  }
  return { checked, missing, allowUsed, byRule, srOnlyHits };
}

const show = (f: Finding) =>
  `${f.guide} ${f.at} [${f.rule}] “${f.label}”${f.evidence ? ` ${f.evidence}` : ""}${f.srOnly ? ` (only screen-reader text: “${f.srOnly}”)` : ""}`;

describe("every control a guide tells a reader to act on is on its tools' screens", () => {
  const result = audit(guides);

  it("health: the corpus is plausibly large, every rule fires, and is printed", () => {
    // Recorded 2026-10-30 on 36 guides — see the PR for the full corpus.
    // 2026-10-31, 39 guides: 207 checked (quoted=33, verb=162, chain=17,
    // button=1); the screen-reader rule failed one ("press Remove", a
    // tooltip-only X button), rewritten.
    console.log(
      `guide-ui-labels: ${result.checked.length} labels checked across ${guides.length} guides; by rule: ${[
        ...result.byRule,
      ]
        .map(([r, n]) => `${r}=${n}`)
        .join(", ")}; screen-reader-only matches: ${result.srOnlyHits}`,
    );
    if (process.env.GUIDE_UI_LABELS_PRINT)
      console.log(result.checked.map(show).join("\n"));
    expect(guides.length).toBeGreaterThanOrEqual(30);
    expect(
      result.checked.length,
      "implausibly few labels extracted — is the extractor broken?",
    ).toBeGreaterThanOrEqual(120);
    // Rule 1, the second direction: every rule catches a real guide phrase.
    for (const rule of ["verb", "quoted", "chain", "button"] as const)
      expect(
        result.byRule.get(rule) ?? 0,
        `rule ${rule} caught nothing`,
      ).toBeGreaterThan(0);
  });

  it("health: every guide's UI set is derived and non-trivial", () => {
    for (const guide of guides) {
      const ui = uiOf(guide.tools);
      expect(
        ui.files.filter((f) => f.startsWith(COMPONENTS)).length,
        `${guide.slug}: no component modules reached`,
      ).toBeGreaterThan(5);
      expect(
        ui.exact.size,
        `${guide.slug}: implausibly few strings`,
      ).toBeGreaterThan(100);
      // The walk DOES reach the tools catalogue — so "labels only" outside
      // the components is what keeps every tool's name and prose out, and
      // the Rotate PDF control below is what proves it.
      expect(ui.files.map(rel)).toContain("src/lib/tools/catalog.ts");
    }
  });

  it("every extracted label exists in what the guide's tools render", () => {
    expect(result.missing.map(show)).toEqual([]);
  });

  it("every allowlist entry is still used (no decoration)", () => {
    expect(
      Object.keys(NOT_OUR_LABELS).filter((k) => !result.allowUsed.has(k)),
    ).toEqual([]);
  });

  it("positive control: an invented control fails, through the same audit", () => {
    const merge = guides.find((g) => g.slug === "how-to-merge-pdf-files")!;
    const fake: Guide = {
      ...merge,
      steps: ["Press Frobnicate PDF to finish."],
      intro: [],
      sections: [],
      faq: [],
    };
    const { missing, checked } = audit([fake]);
    expect(checked.map((f) => f.label)).toContain("Frobnicate PDF");
    expect(missing.map((f) => f.label)).toContain("Frobnicate PDF");
    // A tool's NAME is not a control on its page.
    const named = audit([{ ...fake, steps: ["Press Rotate PDF."] }]);
    expect(named.missing.map((f) => f.label)).toEqual(["Rotate PDF"]);
  });

  it("negative control: a real label passes, through the same audit", () => {
    const crop = guides.find((g) => g.slug === "how-to-crop-a-pdf")!;
    const real: Guide = {
      ...crop,
      steps: ["Press Crop PDF, then Download cropped PDF."],
      intro: [],
      sections: [],
      faq: [],
    };
    const { missing, checked } = audit([real]);
    expect(checked.map((f) => f.label)).toEqual([
      "Crop PDF",
      "Download cropped PDF",
    ]);
    expect(missing).toEqual([]);
  });
});

describe("a label a sighted reader never sees is not a label", () => {
  // 2026-10-31: until then every string in a component counted as on
  // screen, so "choose Numbering style" passed — a `SegmentedControl` label
  // that renders only as its radiogroup's `aria-label`.
  const only = (slug: string, step: string): Guide => ({
    ...guides.find((g) => g.slug === slug)!,
    steps: [step],
    intro: [],
    sections: [],
    faq: [],
  });
  const missingOf = (slug: string, step: string) =>
    audit([only(slug, step)]).missing.map((f) => [f.label, f.srOnly]);

  it("health: each hidden position is seen, and a component's title is not one", () => {
    const numbers = uiOf(["page-numbers"]);
    // Through a component's prop into an `aria-label`.
    expect(numbers.hidden.has("Numbering style")).toBe(true);
    expect(numbers.exact.has("Numbering style")).toBe(false);
    // `<Section title="Format">` draws a heading: a component's `title` is
    // what the component makes of it, not the HTML attribute.
    expect(numbers.exact.has("Format")).toBe(true);
    const edit = uiOf(["edit-pdf"]);
    // An `sr-only` element's text (thumbnail-rail.tsx's keyboard-only Up
    // button, `cn(iconBtn, "sr-only focus:not-sr-only")`), and an intrinsic
    // `aria-label` (the toolbar's).
    expect(edit.hidden.has("Up")).toBe(true);
    expect(edit.hidden.has("Editor tools")).toBe(true);
    // find-panel.tsx: "Replace with" is an sr-only <label> AND the input's
    // placeholder — and a placeholder is drawn, so it is visible.
    expect(edit.exact.has("Replace with")).toBe(true);
    expect(edit.hidden.has("Replace with")).toBe(false);
  });

  it("positive control: a prop that reaches only aria-label fails, and says why", () => {
    expect(
      missingOf(
        "how-to-add-page-numbers-to-a-pdf",
        "Choose Numbering style, then press Add page numbers.",
      ),
    ).toEqual([["Numbering style", "Numbering style"]]);
  });

  it("positive control: sr-only text and an intrinsic aria-label fail", () => {
    expect(
      missingOf("how-to-add-text-to-a-pdf", "Under Editor tools pick a tool."),
    ).toEqual([["Editor tools", "Editor tools"]]);
    expect(
      missingOf("how-to-add-text-to-a-pdf", "Press Up to move a page."),
    ).toEqual([["Up", "Up"]]);
  });

  it("negative control: visible labels beside them pass", () => {
    // Visible through a placeholder, though its <label> is sr-only.
    expect(
      missingOf(
        "how-to-add-text-to-a-pdf",
        "Type the new words where it says “Replace with”.",
      ),
    ).toEqual([]);
    // TextField draws its `label` in a <label> — visible.
    expect(
      missingOf(
        "how-to-add-bates-numbers-to-a-pdf",
        "Under Prefix, type ACME-, then press Add page numbers.",
      ),
    ).toEqual([]);
  });
});

describe("a leading icon is a boundary, not a word", () => {
  const merge = guides.find((g) => g.slug === "how-to-merge-pdf-files")!;
  const only = (step: string): Guide => ({
    ...merge,
    steps: [step],
    intro: [],
    sections: [],
    faq: [],
  });
  it("an icon-led button with a count in it is matched", () => {
    // merge-runner.tsx: <Plus /> Merge {items.length} PDF{…}
    const { checked, missing } = audit([only("Press Merge 2 PDFs.")]);
    expect(checked.map((f) => f.label)).toEqual(["Merge 2 PDFs"]);
    expect(missing).toEqual([]);
  });
  it("and a label the button does not carry still fails", () => {
    const { missing } = audit([only("Press Merge 2 files.")]);
    expect(missing.map((f) => f.label)).toEqual(["Merge 2 files"]);
  });
});

describe("the extractor, on sentences the guides shipped", () => {
  const labels = (s: string) => extractLabels(s).map((x) => [x.rule, x.core]);
  it("reads each rule's shape", () => {
    expect(labels("Press Create PDF, then Download PDF.")).toEqual([
      ["verb", "Create PDF"],
      ["chain", "Download PDF"],
    ]);
    expect(labels("press Replace or Replace all")).toEqual([
      ["verb", "Replace"],
      ["chain", "Replace all"],
    ]);
    expect(labels("type a name or number and press “Find”")).toEqual([
      ["quoted", "Find"],
    ]);
    expect(labels("choose JPG or PNG photos")).toEqual([]);
    expect(
      labels("With “Flatten every page”, the pages become images."),
    ).toEqual([["quoted", "Flatten every page"]]);
    expect(labels("with a password")).toEqual([]);
    expect(
      labels("Tick Draw a thin border around each page for an outline."),
    ).toEqual([["verb", "Draw a thin border around"]]);
    expect(labels("Pick the PDF you want to split")).toEqual([]);
    expect(
      labels("Under Orientation keep Auto or choose Portrait or Landscape"),
    ).toEqual([
      ["verb", "Orientation"],
      ["verb", "Auto"],
      ["verb", "Portrait"],
      ["chain", "Landscape"],
    ]);
  });
});
