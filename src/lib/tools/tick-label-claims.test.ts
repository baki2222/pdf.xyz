// @vitest-environment node
/**
 * A page that tells the reader to tick a box names a checkbox that exists.
 *
 * OCR PDF's panel had one checkbox, "Skip pages that already have text", until
 * 2026-09-27, when it was replaced by "Redo existing OCR" (off by default:
 * skipping text pages became the engine's default). The page went on telling
 * readers to "tick Skip pages that already have text", twice, one of them in
 * the HowTo structured data. The old label survived only in a source comment,
 * so a reader looked for a control that did not exist, and one who ticked the
 * only box there asked for the opposite. Found by a verifier at 028d3a10.
 *
 * This ties the copy to the controls, over what each page SERVES: wherever a
 * served field says "tick" or "untick" followed by a quoted name or a
 * capitalised one, that name must be the label of a checkbox some component
 * renders. The labels are DISCOVERED, never typed: every `type="checkbox"`
 * under src/components is walked to its enclosing `<label>`, whose JSX text
 * fragments are its name; a label that renders a `{label}` prop belongs to a
 * wrapper component, and every `label="…"` passed to that component is taken.
 * A checkbox with no enclosing `<label>` is fatal, not skipped.
 *
 * An unquoted name has no closing mark, so the claim is satisfied by its
 * longest leading run of two or more words that is a whole label ("Tick
 * Redo existing OCR only when…" → "Redo existing OCR").
 *
 * WHAT THIS DOES NOT SEE: a label named without "tick" ("turn on Skip…",
 * "check the box"), a one-word label named unquoted, and a label that exists
 * on a DIFFERENT tool's panel — the set is every checkbox, not this page's.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "./catalog";
import type { Tool } from "./types";
import { withoutComments } from "./copy-surface";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(rel);
      return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)
        ? [rel]
        : [];
    },
  );
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The text a slice of TSX renders: its JSX text fragments, split at every
 * `{…}`, plus the string literals inside those expressions (`{checked ?
 * "Checked" : "Unchecked"}`). An attribute value (`className="…"`) follows
 * `=` and is not taken.
 */
function textFragments(jsx: string): string[] {
  return [
    ...[...jsx.matchAll(/>([^<>]*)</g)].flatMap((m) =>
      m[1]!.split(/\{[^}]*\}/),
    ),
    ...[...jsx.matchAll(/(?<![=\w])"([^"\n]+)"/g)].map((m) => m[1]!),
  ]
    .map(squash)
    .filter((s) => /[A-Za-z]/.test(s));
}

interface Checkbox {
  file: string;
  labels: string[];
}

const SOURCES = new Map(
  sourceFiles("src/components").map((file) => [
    file,
    withoutComments(readFileSync(path.join(ROOT, file), "utf8")),
  ]),
);

/** Every checkbox a component renders, and the names it can carry. */
function checkboxes(): Checkbox[] {
  const found: Checkbox[] = [];
  for (const [file, code] of SOURCES) {
    for (const m of code.matchAll(/type="checkbox"/g)) {
      const start = code.lastIndexOf("<label", m.index);
      const end = code.indexOf("</label>", m.index);
      if (
        start < 0 ||
        end < 0 ||
        code.slice(start, m.index).includes("</label>")
      )
        throw new Error(`${file}: a checkbox with no enclosing <label>`);
      const block = code.slice(start, end + "</label>".length);
      const labels = textFragments(block);
      if (/\{\s*label\s*\}/.test(block)) {
        // A wrapper: its name is whatever each caller passes as `label`.
        const fn = [
          ...code.slice(0, m.index).matchAll(/\bfunction\s+([A-Z]\w*)/g),
        ].pop()?.[1];
        if (!fn)
          throw new Error(`${file}: a {label} checkbox outside a component`);
        for (const other of SOURCES.values())
          for (const use of other.matchAll(new RegExp(`<${fn}\\b`, "g"))) {
            const tail = other.slice(use.index);
            const props = tail.slice(0, tail.search(/\/>|<\//));
            const label = /\blabel="([^"]+)"/.exec(props)?.[1];
            if (label) labels.push(squash(label));
          }
      }
      found.push({ file, labels });
    }
  }
  return found;
}

const CHECKBOXES = checkboxes();
const LABELS: ReadonlySet<string> = new Set(
  CHECKBOXES.flatMap((c) => c.labels),
);

/** Every string the page serves, one field each. */
function servedFields(tool: Tool): string[] {
  return [
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
  ];
}

const TICK =
  /\b(?:[Uu]nt|[Tt])ick\s+(?:“([^”]+)”|"([^"]+)"|([A-Z][^.,;:!?“”"()]*))/g;

/** The names a field tells the reader to tick, as written. */
function tickClaims(field: string): string[] {
  return [...field.matchAll(TICK)].map((m) => squash(m[1] ?? m[2] ?? m[3]!));
}

function namesACheckbox(claim: string, quoted: boolean): boolean {
  if (quoted) return LABELS.has(claim);
  const words = claim.split(" ");
  for (let k = words.length; k >= 2; k--)
    if (LABELS.has(words.slice(0, k).join(" "))) return true;
  return false;
}

/** The names in a field that no checkbox carries. */
function unknownTicks(field: string): string[] {
  return [...field.matchAll(TICK)]
    .filter((m) => !namesACheckbox(squash(m[1] ?? m[2] ?? m[3]!), !m[3]))
    .map((m) => m[0]);
}

function offenders(): string[] {
  return tools.flatMap((tool) =>
    servedFields(tool)
      .flatMap(unknownTicks)
      .map((hit) => `${tool.slug}: ${hit}`),
  );
}

describe("a page that says tick names a checkbox that exists", () => {
  it("health check: the checkbox labels are discovered from every component, wrappers included", () => {
    expect(CHECKBOXES.length).toBeGreaterThanOrEqual(7);
    expect(CHECKBOXES.length).toBeLessThan(40);
    // Every checkbox resolved to at least one name, so none is invisible.
    expect(CHECKBOXES.filter((c) => c.labels.length === 0)).toEqual([]);
    // Positive controls: a plain <label>, a nested <span> label, and one
    // reached only through the Toggle wrapper's `label` prop.
    expect(LABELS.has("Add a date field next to each signature")).toBe(true);
    expect(LABELS.has("Redo existing OCR")).toBe(true);
    expect(LABELS.has("Flatten after filling")).toBe(true);
    expect(LABELS.has("Checked by default")).toBe(true);
    // The retired label lives on only in a comment, which is not a control.
    expect(LABELS.has("Skip pages that already have text")).toBe(false);
  });

  it("health check: the pages serve tick claims for this to read", () => {
    const claims = tools.flatMap((tool) =>
      servedFields(tool).flatMap(tickClaims),
    );
    expect(claims.length).toBeGreaterThanOrEqual(4);
    expect(claims.length).toBeLessThan(60);
  });

  it("the predicate catches the sentences that shipped, and not the fixed ones", () => {
    for (const shipped of [
      "When typed pages and scanned pages sit in the same file, tick Skip pages that already have text so the typed pages are left untouched and only the image pages are recognised.",
      "Under Output, pick Searchable PDF, Text only (a .txt file), or Both. Tick Skip pages that already have text if part of the PDF was typed rather than scanned.",
    ])
      expect(unknownTicks(shipped), shipped).not.toEqual([]);
    for (const fixed of [
      "Tick Redo existing OCR only when an earlier OCR text layer is poor and should be recognised again; text typed into the document is kept either way.",
      "Tick “Flatten after filling”: the values are drawn into the page.",
      'Untick "Add a date field next to each signature" for signature boxes only.',
      // Lowercase after "tick" is a verb phrase, not a control name.
      "Type into text fields, tick checkboxes, pick radio options.",
    ])
      expect(unknownTicks(fixed), fixed).toEqual([]);
  });

  it("no page tells the reader to tick a box that no component renders", () => {
    expect(offenders()).toEqual([]);
  });
});
