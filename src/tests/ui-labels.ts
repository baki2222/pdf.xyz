/**
 * A CONTROL NAME THE PROSE TELLS A READER TO USE IS TEXT THE TOOL'S UI DRAWS.
 *
 * The machinery both prose-to-UI label guards share — the guides'
 * (`src/lib/guides/guide-ui-labels.test.ts`) and the tool pages'
 * (`src/lib/tools/tool-page-ui-labels.test.ts`). Extracted 2026-10-31 from the
 * guide guard, where it was written, so the two cannot drift: a fix to the
 * extractor or to what counts as visible reaches both readers at once. Each
 * test owns its corpus, its exceptions and its controls; this module owns the
 * predicate.
 *
 * ── THE PROSE SIDE: discovered, after evaluation ────────────────────────────
 *
 * Every string anywhere in a document's value ({@link proseStrings}: walked,
 * not listed by field, so a field added to the type is read the day it
 * ships), AFTER the module's template strings run — the corpus is what a
 * reader receives, not the source text. Labels are extracted by four rules:
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
 * list was worked out against the real guides (its history is in the PR that
 * added the guide guard): the first run flagged "A field that reads Not set
 * has no value" and "keep Auto orientation".
 *
 * ── THE UI SIDE: derived ────────────────────────────────────────────────────
 *
 *   a document's tools → the module each tool page mounts as its panel
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
 * Prose writes for a SIGHTED reader ("choose Numbering style"), so a string
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
 * …unless the same string is ALSO visible anywhere in the scope (find-panel's
 * "Replace with" is an sr-only <label> and the input's placeholder, which is
 * drawn). A label that matches only hidden text fails with the hidden string
 * in the message.
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
 * PDF's screen to vouch for it (each test's positive control holds this).
 *
 * WHAT THAT COSTS, said plainly:
 *
 *  - It is a MODULE graph, so it over-approximates (CLAUDE.md rule 4): a
 *    string in a module the runner imports but never renders counts, and a
 *    label in a shared component passes for every runner that loads it. The
 *    direction is permissive. The tools catalogue (`src/lib/tools`), which
 *    every panel reaches and which holds every tool's NAME, description and
 *    FAQ prose, is read for labels only: with all its strings, "Press Merge
 *    PDF" would pass everywhere.
 *  - A string that exists on screen is not proof it is a BUTTON. This checks
 *    that the named control's text exists in the tools' UI, not its role.
 *  - Short cores are weak: "press Select", "press Download" pass on any
 *    on-screen "Select" / "Download" in the scope.
 *  - A label the extractor cannot see is not checked: one after an article
 *    ("pick a Page size"), after a verb not in the lists, or lower-case.
 *    Each test's corpus count and its floor are what say the extractor still
 *    sees most of them.
 *  - The union over all of a document's tools, not just the primary: guides
 *    name neighbours' controls ("in Compress PDF, press …").
 */
import ts from "typescript";
import path from "node:path";
import { formatForToken } from "@/lib/intent/formats";
import { tools } from "@/lib/tools";
import {
  SRC,
  ownPanelModules,
  parsedSource,
  resolveComponent,
  valueClosure,
} from "@/tests/tool-panel-modules";

/* ------------------------------------------------------------------ *
 *  The prose side
 * ------------------------------------------------------------------ */

export interface ProseString {
  /** Where in the value, e.g. `steps[2]`, `faqs[0].a`. */
  at: string;
  text: string;
}

/** Every string in a value, wherever it sits (walked, never listed by field). */
export function proseStrings(root: unknown): ProseString[] {
  const out: ProseString[] = [];
  const walk = (value: unknown, at: string): void => {
    if (typeof value === "string") out.push({ at, text: value });
    else if (Array.isArray(value))
      value.forEach((v, i) => walk(v, `${at}[${i}]`));
    else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value))
        walk(v, at ? `${at}.${k}` : k);
  };
  walk(root, "");
  return out;
}

/** Words that start a label: the reader is told to act on what follows. */
export const TRIGGERS = new Set([
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
 * ready.”", "the box marked “Add your PDF, or browse”" — bare, they are
 * ordinary prose ("with a password", "marked SAMPLE at low opacity").
 */
const QUOTE_TRIGGERS = new Set(["with", "when", "leave", "enter", "marked"]);
const CHAINS = new Set(["or", "and", "then"]);

export type Rule = "verb" | "quoted" | "chain" | "list" | "button";
export const RULES: readonly Rule[] = [
  "verb",
  "quoted",
  "chain",
  "list",
  "button",
];

export interface Extracted {
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
export function extractLabels(text: string): Extracted[] {
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
    // A LIST, "pick A, B or C": each comma item is a label too, but only
    // when the list closes with a chain word AND a label after it — a comma
    // alone is ordinary punctuation ("Under Output, pick …", "Press Merge
    // PDF, Ghostscript then runs"), so the items recorded on the way are
    // dropped again if it does not.
    const mark = out.length;
    while (
      tokens[c]?.kind === "punct" &&
      tokens[c]!.text === "," &&
      (tokens[c + 1]?.kind === "quote" || capitalLed(tokens[c + 1]))
    )
      c =
        tokens[c + 1]!.kind === "quote"
          ? quoted(c + 1, "list")
          : bare(c + 1, "list");
    if (tokens[c]?.kind === "punct" && tokens[c]!.text === ",") c++;
    let d = c + 1;
    if (lower(tokens[c]) === "and" && lower(tokens[d]) === "then") d++;
    const next = tokens[d];
    if (
      !CHAINS.has(lower(tokens[c])) ||
      !(next?.kind === "quote" || capitalLed(next))
    ) {
      out.length = mark;
      return;
    }
    if (next?.kind === "quote") chain(quoted(d, "chain"));
    else chain(bare(d, "chain"));
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

export const COMPONENTS = path.join(SRC, "components") + path.sep;

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

/**
 * Where a sentence ends a clause: punctuation, or a spaced em dash — the way
 * a label is glossed on screen ("Parallel — everyone at once", "Brief —
 * TL;DR + key points"), which the prose names by its first words.
 */
const CLAUSE = /[,;:.!?…(]| — /;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface Rendered {
  /** Strings a SIGHTED reader can see. */
  exact: Set<string>;
  /** Strings with `${…}` / `{…}` holes, as anchored patterns (visible only). */
  patterns: RegExp[];
  /**
   * A template's leading CLAUSE, when its literal head closes one before
   * the first hole: `Download all (${n})` draws "Download all" before its
   * count — the same cut {@link leadingClauses} makes in an exact string.
   */
  leads: Set<string>;
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

/**
 * The strings a `label:` initializer can evaluate to: a literal, or either
 * branch of `a ? "x" : "y"` / `a ?? "x"` / `a || "x"` — scan-to-pdf.ts's
 * `label: id === "fit" ? "Fit to photo" : found.label`, which a literal-only
 * read missed (2026-10-31: "pick A4, US Letter or Fit to photo" failed the
 * moment the list rule first checked it). Nothing else: a call's
 * arguments are not what it returns.
 */
function labelLiterals(x: ts.Expression): string[] {
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x))
    return [x.text];
  if (ts.isParenthesizedExpression(x)) return labelLiterals(x.expression);
  if (ts.isConditionalExpression(x))
    return [...labelLiterals(x.whenTrue), ...labelLiterals(x.whenFalse)];
  if (
    ts.isBinaryExpression(x) &&
    (x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      x.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  )
    return [...labelLiterals(x.left), ...labelLiterals(x.right)];
  return [];
}

const renderedCache = new Map<string, Rendered>();
/** Every string a module can put on screen (see the docblock for which). */
export function renderedBy(file: string): Rendered {
  const cached = renderedCache.get(file);
  if (cached) return cached;
  const exact = new Set<string>();
  const hidden = new Set<string>();
  const patterns: RegExp[] = [];
  const leads = new Set<string>();
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
    const head = norm(decode(parts[0]!));
    if (CLAUSE.test(head)) {
      const lead = head.split(CLAUSE)[0]!.trim();
      if (lead) leads.add(lead);
    }
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
        /^(label|.*Label)$/.test(n.name.getText(sf))
      )
        for (const t of labelLiterals(n.initializer)) addText(t, false);
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
  const value = { exact, patterns, hidden, leads };
  renderedCache.set(file, value);
  return value;
}

const { bySlug } = ownPanelModules();

/** The module a tool page mounts as its panel, or null when it mounts none. */
export const panelFileOf = (slug: string): string | null =>
  bySlug.get(slug)?.file ?? null;

/** What a set of tool pages renders, and the modules it was read from. */
export function uiOf(slugs: readonly string[]): Rendered & { files: string[] } {
  const files = new Set<string>();
  for (const slug of slugs) {
    const panel = bySlug.get(slug);
    if (!panel) continue;
    for (const f of valueClosure(panel.file)) files.add(f);
  }
  const exact = new Set<string>();
  const hidden = new Set<string>();
  const patterns: RegExp[] = [];
  const leads = new Set<string>();
  for (const f of files) {
    const r = renderedBy(f);
    for (const s of r.exact) exact.add(s);
    for (const s of r.hidden) hidden.add(s);
    patterns.push(...r.patterns);
    for (const s of r.leads) leads.add(s);
  }
  // Visible anywhere in the scope is visible.
  for (const s of exact) hidden.delete(s);
  return { exact, patterns, hidden, leads, files: [...files] };
}

/**
 * The screen-reader-only string a missing label names, for the message: the
 * label is in the code, and a sighted reader never sees it.
 */
export function hiddenMatch(x: Extracted, ui: Rendered): string | null {
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
 * or" past its own comma; see {@link CLAUSE}), and the leading clauses of
 * templates ({@link Rendered.leads}).
 */
export function leadingClauses(ui: Rendered): Set<string> {
  const out = new Set<string>();
  for (const s of ui.exact) {
    out.add(s);
    // A drop zone renders its "…, or" title followed by its "browse"
    // control (drop-sheet-face.tsx), so a reader sees the two as one line —
    // the composition drop-zone-label-claims.test.ts pins for tool pages.
    if (s.endsWith(", or") && ui.exact.has("browse")) out.add(`${s} browse`);
    // A heading that introduces a list ("Left as-is, still interactive:")
    // is the same words to a sentence that names it.
    if (s.endsWith(":")) out.add(s.slice(0, -1).trim());
    const lead = s.split(CLAUSE)[0]!.trim();
    if (lead) out.add(lead);
  }
  for (const s of ui.leads) out.add(s);
  return out;
}

/**
 * The rendered string L with core ⊑ L ⊑ run, as evidence — the exact string,
 * or the pattern that matched it — or null.
 */
export function matches(
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
 *  The audit: one document at a time, through the same scope rule
 * ------------------------------------------------------------------ */

/** A piece of prose a reader receives, and the tool pages it is about. */
export interface LabelDocument {
  /** A guide slug, or a tool slug. */
  id: string;
  /** The tools whose screens its labels may be on. */
  tools: readonly string[];
  /** The value whose every string is read ({@link proseStrings}). */
  value: unknown;
}

export interface Finding {
  doc: string;
  at: string;
  rule: Rule;
  label: string;
  /** What it matched on screen, or null. */
  evidence?: string | null;
  /** When it matched nothing visible: the screen-reader-only string it names. */
  srOnly?: string;
}

const scopes = new Map<
  string,
  { ui: Rendered & { files: string[] }; clauses: Set<string> }
>();
/**
 * The tools whose screens a label may be on: the document's own `tools`,
 * plus any tool the SAME sentence names by its catalogue name ("use PDF to
 * Word with “Recognise text in scans (OCR)”") — but not by the label itself,
 * or "Press Rotate PDF" would summon Rotate PDF's screen to vouch for it.
 */
export function scopeFor(
  own: readonly string[],
  text: string,
  x: Extracted,
): {
  slugs: string[];
  ui: Rendered & { files: string[] };
  clauses: Set<string>;
} {
  const rest = text.split(x.core).join(" ");
  const slugs = [
    ...new Set([
      ...own,
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
  return { slugs, ...scope };
}

export interface AuditResult {
  checked: Finding[];
  missing: Finding[];
  /** Exception keys the corpus used — an unused one is decoration. */
  allowUsed: Set<string>;
  byRule: Map<Rule, number>;
  srOnlyHits: number;
  /** Every module any scope was read from, for the health checks. */
  files: Set<string>;
  /** How many strings were read. */
  strings: number;
}

/**
 * Every label every document names, checked against its scope. `exempt`
 * names an extraction that is legitimately not a label in our UI (a keyboard
 * key, text in the reader's own document) by the exception KEY that covers
 * it, or returns null; a covered extraction is counted in `allowUsed` under
 * that key and not checked, so a caller can fail an exception nothing uses.
 */
export function auditLabels(
  docs: readonly LabelDocument[],
  exempt: (x: Extracted) => string | null,
): AuditResult {
  const checked: Finding[] = [];
  const missing: Finding[] = [];
  const allowUsed = new Set<string>();
  const byRule = new Map<Rule, number>();
  const files = new Set<string>();
  let srOnlyHits = 0;
  let strings = 0;
  for (const doc of docs) {
    for (const { at, text } of proseStrings(doc.value)) {
      strings++;
      for (const x of extractLabels(text)) {
        const { ui, clauses } = scopeFor(doc.tools, text, x);
        for (const f of ui.files) files.add(f);
        const f = { doc: doc.id, at, rule: x.rule, label: x.core };
        byRule.set(x.rule, (byRule.get(x.rule) ?? 0) + 1);
        const key = exempt(x);
        if (key !== null) {
          allowUsed.add(key);
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
  return { checked, missing, allowUsed, byRule, srOnlyHits, files, strings };
}

export const showFinding = (f: Finding): string =>
  `${f.doc} ${f.at} [${f.rule}] “${f.label}”${f.evidence ? ` ${f.evidence}` : ""}${f.srOnly ? ` (only screen-reader text: “${f.srOnly}”)` : ""}`;
