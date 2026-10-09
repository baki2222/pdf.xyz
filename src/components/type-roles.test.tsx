// @vitest-environment jsdom
/**
 * Type roles: one spelling per role, one size per role, one rhythm per page.
 *
 * WHAT SHIPPED. The mono kicker that opens a section, a panel or a list was
 * spelled out longhand at every call site — `font-mono text-xs font-medium
 * tracking-[0.18em] uppercase`, 30-odd times — and drifted the way a value
 * typed in thirty places drifts: the hero's kicker tracked at 0.14em on a
 * phone and 0.2em above it, the hero's list label at 0.2em, everything else
 * at 0.18em. The homepage's section h2s were `text-4xl sm:text-5xl` with two
 * different leadings, and three of its eleven sections breathed at `sm:py-28`
 * while the rest used `sm:py-24`.
 *
 * THE RULES, each checked where it can fail:
 *  1. A kicker is the `kicker` utility. A class string that spells the role
 *     out — mono, extra-small, uppercase, tracked — is the defect, wherever it
 *     is. Checked over the string literals of every shipped source (comments
 *     are not class names), with the shipped spellings as the corpus.
 *  2. On the homepage, as RENDERED: the one H1 is the display-1 step; every
 *     section that carries an h2 sets it in display-2 and breathes at the one
 *     rhythm, `py-20 sm:py-24`.
 *  3. `SectionHeading` is also the H1 of three page templates (/tools, /guides
 *     and every category page); that path keeps the page-title size, because
 *     display-2 is a section step and a page title is not a section.
 *
 * KNOWN BOUND: the status console's dense labels (`text-[0.7rem]`) and the
 * staged-file list's (`text-[11px]`) are tracked uppercase mono at a smaller
 * size. They are a different role at a different size, and rule 1 does not
 * claim them.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";
import { SectionHeading } from "@/components/ui/section-heading";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/* ------------------------------------------------------------------ *
 *  1. The kicker is one utility
 * ------------------------------------------------------------------ */

/** A class list that spells the kicker role out instead of naming it. */
export function isKickerLonghand(classes: string): boolean {
  const tokens = classes.split(/\s+/).map((t) => t.replace(/^(?:\w+:)+/, ""));
  const tracked = tokens.some((t) => {
    const m = /^tracking-\[(0?\.\d+)em\]$/.exec(t);
    return m !== null && Number(m[1]) >= 0.1;
  });
  return (
    tracked &&
    tokens.includes("font-mono") &&
    tokens.includes("uppercase") &&
    tokens.includes("text-xs")
  );
}

/**
 * Verbatim, as they shipped on 2026-10-09 — the retired trackings written
 * with "·" for their hyphen and restored at runtime, because Tailwind scans
 * test files too and would otherwise keep shipping the classes this file
 * exists to retire.
 */
const SHIPPED_LONGHAND = [
  "text-faint font-mono text-xs font-medium tracking-[0.18em] uppercase",
  "text-muted font-mono text-xs font-medium tracking·[0.14em] uppercase sm:tracking·[0.2em]",
  "text-faint font-mono text-xs font-medium tracking·[0.2em] uppercase",
].map((c) => c.replaceAll("·", "-"));

/** Every string literal (and template chunk) in a source: its class strings. */
function literals(
  file: string,
  source: string,
): { text: string; line: number }[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: { text: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      out.push({
        text: node.text,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function shippedSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (full !== path.join(SRC, "tests")) walk(full);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
        out.push(full);
    }
  };
  walk(SRC);
  return out;
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

describe("the kicker is one utility, not a spelling", () => {
  const files = shippedSources();
  const all = files.flatMap((f) =>
    literals(f, readFileSync(f, "utf8")).map((l) => ({ file: rel(f), ...l })),
  );

  it("health check: the walk reads the class strings of everything that ships", () => {
    expect(files.length).toBeGreaterThanOrEqual(200);
    expect(
      all.filter((l) => /(?<![\w-])font-mono(?![\w-])/.test(l.text)).length,
    ).toBeGreaterThanOrEqual(20);
  });

  it("positive control: every shipped spelling is caught, and the near misses are not", () => {
    expect(SHIPPED_LONGHAND.filter((c) => !isKickerLonghand(c))).toEqual([]);
    // The dense status labels are a smaller size, a different role.
    expect(
      isKickerLonghand(
        "text-faint font-mono text-[0.7rem] font-medium tracking-[0.18em] uppercase",
      ),
    ).toBe(false);
    // A mono figure is not a kicker.
    expect(isKickerLonghand("font-mono text-xs tabular-nums")).toBe(false);
  });

  it("no shipped class string spells the kicker out", () => {
    expect(
      all
        .filter((l) => isKickerLonghand(l.text))
        .map((l) => `${l.file}:${l.line}  ${l.text}`),
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  2. The homepage, as rendered
 * ------------------------------------------------------------------ */

function home(): Document {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(<HomePage />),
    "text/html",
  );
}

const classes = (el: Element | null | undefined) =>
  new Set((el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));

/** Sections that open with an h2: the homepage's content sections. */
const contentSections = (doc: Document) =>
  [...doc.querySelectorAll("section")].filter((s) => s.querySelector("h2"));

/** What breaks the one-rhythm rule in a rendered page, by section heading. */
export function rhythmBreaks(doc: Document): string[] {
  return contentSections(doc).flatMap((section) => {
    const owners = [section, ...section.children];
    const name = section.querySelector("h2")?.textContent?.trim() ?? "?";
    const breaks: string[] = [];
    if (
      !owners.some((el) => {
        const c = classes(el);
        return c.has("py-20") && c.has("sm:py-24");
      })
    )
      breaks.push(`${name}: not py-20 sm:py-24`);
    if (
      [section, ...section.querySelectorAll("*")].some((el) =>
        classes(el).has("sm:py-28"),
      )
    )
      breaks.push(`${name}: sm:py-28`);
    return breaks;
  });
}

/** Section h2s not set in the display-2 step. */
export function offScaleHeadings(doc: Document): string[] {
  return contentSections(doc)
    .map((s) => s.querySelector("h2")!)
    .filter((h2) => !classes(h2).has("text-display-2"))
    .map((h2) => h2.textContent?.trim() ?? "?");
}

describe("the homepage, as rendered", () => {
  it("health check: the render holds the sections it is made of", () => {
    expect(contentSections(home()).length).toBeGreaterThanOrEqual(8);
  });

  it("the one H1 is the display-1 step", () => {
    const h1s = [...home().querySelectorAll("h1")];
    expect(h1s).toHaveLength(1);
    expect([...classes(h1s[0])]).toContain("text-display-1");
  });

  it("every section h2 is the display-2 step", () => {
    expect(offScaleHeadings(home())).toEqual([]);
  });

  it("every section breathes at one rhythm", () => {
    expect(rhythmBreaks(home())).toEqual([]);
  });

  it("positive control: a section off the rhythm and off the scale is named", () => {
    const doc = home();
    const [first] = contentSections(doc);
    const h2 = first!.querySelector("h2")!;
    for (const el of [first!, ...first!.children]) {
      el.setAttribute(
        "class",
        (el.getAttribute("class") ?? "").replace(/\bsm:py-24\b/, "sm:py-28"),
      );
    }
    h2.setAttribute("class", "font-display text-4xl sm:text-5xl");
    const name = h2.textContent!.trim();
    // Read for the mutated section only, so the control holds on any tree.
    expect(rhythmBreaks(doc).filter((b) => b.startsWith(`${name}:`))).toEqual([
      `${name}: not py-20 sm:py-24`,
      `${name}: sm:py-28`,
    ]);
    expect(offScaleHeadings(doc).filter((n) => n === name)).toEqual([name]);
  });
});

/* ------------------------------------------------------------------ *
 *  3. SectionHeading as a page title
 * ------------------------------------------------------------------ */

describe("SectionHeading is a section step as an h2 and a page title as an h1", () => {
  const render = (as: "h1" | "h2") =>
    new DOMParser()
      .parseFromString(
        renderToStaticMarkup(<SectionHeading as={as} title="Title" />),
        "text/html",
      )
      .querySelector(as);

  it("as h2 it is display-2", () => {
    expect([...classes(render("h2"))]).toContain("text-display-2");
  });

  it("as h1 it keeps the page-title size every other page title uses", () => {
    const h1 = classes(render("h1"));
    expect(h1.has("text-display-2")).toBe(false);
    expect([...h1]).toEqual(
      expect.arrayContaining(["text-4xl", "sm:text-5xl"]),
    );
  });
});
