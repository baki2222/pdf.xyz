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
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guides } from "./catalog";
import type { Guide } from "./types";
import { formatForToken } from "@/lib/intent/formats";
import { tools } from "@/lib/tools";
import {
  SRC,
  ownPanelModules,
  rel,
  resolveSpecifier,
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

const sources = new Map<string, ts.SourceFile>();
function source(file: string): ts.SourceFile {
  let sf = sources.get(file);
  if (!sf) {
    sf = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    sources.set(file, sf);
  }
  return sf;
}

/** Modules `file` loads for their values: static, re-export, `import()`. */
function valueEdges(file: string): string[] {
  const out: string[] = [];
  const add = (spec: string) => {
    const r = resolveSpecifier(file, spec);
    if (r) out.push(r);
  };
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const typeOnly =
        !!c &&
        (c.isTypeOnly ||
          (!c.name &&
            !!c.namedBindings &&
            ts.isNamedImports(c.namedBindings) &&
            c.namedBindings.elements.length > 0 &&
            c.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (!typeOnly) add(n.moduleSpecifier.text);
      return;
    }
    if (
      ts.isExportDeclaration(n) &&
      !n.isTypeOnly &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier)
    ) {
      add(n.moduleSpecifier.text);
      return;
    }
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0])
    )
      add(n.arguments[0].text);
    ts.forEachChild(n, visit);
  };
  visit(source(file));
  return out;
}

/** Every module reachable from `entry` by value edges. */
function closure(entry: string): string[] {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    for (const next of valueEdges(queue.pop()!))
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  return [...seen];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Rendered {
  exact: Set<string>;
  /** Strings with `${…}` / `{…}` holes, as anchored patterns. */
  patterns: RegExp[];
}

/** A string with holes, as a pattern whose holes are one or more words. */
const holed = (parts: string[]): RegExp =>
  new RegExp(
    `^${parts.map((p) => escape(norm(p))).join("\\s*[\\p{L}\\p{N}][^]*?\\s*")}$`,
    "u",
  );

const renderedCache = new Map<string, Rendered>();
/** Every string a module can put on screen (see the docblock for which). */
function renderedBy(file: string): Rendered {
  const cached = renderedCache.get(file);
  if (cached) return cached;
  const exact = new Set<string>();
  const patterns: RegExp[] = [];
  const isComponent = file.startsWith(COMPONENTS);
  const addText = (s: string) => {
    const t = norm(decode(s));
    if (t) exact.add(t);
  };
  const addTemplate = (parts: string[]) => {
    // A pattern must OPEN with a literal word: `${name} PDF` would match
    // every "<anything> PDF" a guide could invent ("Frobnicate PDF" passed
    // through one on the first run).
    if (!/\p{L}/u.test(parts[0]!)) return;
    patterns.push(holed(parts.map(decode)));
  };
  const sf = source(file);
  const visit = (n: ts.Node): void => {
    if (isComponent) {
      if (ts.isStringLiteral(n) && !ts.isImportDeclaration(n.parent))
        addText(n.text);
      else if (ts.isNoSubstitutionTemplateLiteral(n)) addText(n.text);
      else if (ts.isTemplateExpression(n))
        addTemplate([
          n.head.text,
          ...n.templateSpans.map((s) => s.literal.text),
        ]);
      else if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
        // The element's own text, `{…}` children as holes, nested
        // elements as boundaries: "Download {kind} PDF".
        const parts: string[] = [""];
        let holes = 0;
        for (const child of n.children) {
          if (ts.isJsxText(child)) {
            addText(child.text);
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
        if (holes > 0) addTemplate(parts);
      }
    } else {
      // Outside the components: labels only.
      if (
        ts.isPropertyAssignment(n) &&
        /^(label|.*Label)$/.test(n.name.getText(sf)) &&
        ts.isStringLiteral(n.initializer)
      )
        addText(n.initializer.text);
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        /_LABELS?$/.test(n.name.text) &&
        n.initializer
      ) {
        const v = (x: ts.Node): void => {
          if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x))
            addText(x.text);
          ts.forEachChild(x, v);
        };
        v(n.initializer);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const value = { exact, patterns };
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
    for (const f of closure(panel.file)) files.add(f);
  }
  const exact = new Set<string>();
  const patterns: RegExp[] = [];
  for (const f of files) {
    const r = renderedBy(f);
    for (const s of r.exact) exact.add(s);
    patterns.push(...r.patterns);
  }
  return { exact, patterns, files: [...files] };
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
        if (!evidence) missing.push(f);
      }
    }
  }
  return { checked, missing, allowUsed, byRule };
}

const show = (f: Finding) =>
  `${f.guide} ${f.at} [${f.rule}] “${f.label}”${f.evidence ? ` ${f.evidence}` : ""}`;

describe("every control a guide tells a reader to act on is on its tools' screens", () => {
  const result = audit(guides);

  it("health: the corpus is plausibly large, every rule fires, and is printed", () => {
    // Recorded 2026-10-30 on 36 guides — see the PR for the full corpus.
    console.log(
      `guide-ui-labels: ${result.checked.length} labels checked across ${guides.length} guides; by rule: ${[
        ...result.byRule,
      ]
        .map(([r, n]) => `${r}=${n}`)
        .join(", ")}`,
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
