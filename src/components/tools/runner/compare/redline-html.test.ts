// @vitest-environment jsdom
// @native-canvas
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor } from "@/lib/a11y/contrast";
import type {
  ComparablePdfText,
  PdfCompareResult,
} from "@/lib/pdf/compare-pdf";
import { MAX_WORD_PAIR_TOKENS } from "@/lib/pdf/compare/words";
import { comparablePdf, pageHeaderPair } from "@/tests/compare-fixtures";
import { compareExtractedPdfText } from "./compare-result";
import {
  COMPARE_REDLINE_CHUNK,
  REDLINE_CSP,
  REDLINE_CSS,
  REDLINE_CSS_SHA256,
  buildRedlineHtml,
  escapeHtml,
} from "./redline-html";

/**
 * The HTML redline (S4, 2026-11-15) is the .txt report's changes as a web
 * page a person downloads, opens offline and may send on. These tests read
 * the page the way a browser does — `DOMParser` over the bytes — and hold it
 * to the .txt built from the SAME result: the rows, the word marks and the
 * header must be the report's, not a second reading of the comparison.
 *
 * The hostile strings are built from char codes, never typed as escapes: the
 * tool layer has turned a typed escape into the raw character before
 * (memory: "invisible characters in instruments").
 */

const ch = (...codes: number[]) => String.fromCharCode(...codes);
const FFFD = ch(0xfffd);

function doc(name: string, lines: string[]): ComparablePdfText {
  return pagedDoc(name, [lines]);
}

function pagedDoc(name: string, pages: string[][]): ComparablePdfText {
  const texts = pages.map((p) => p.join("\n"));
  const text = texts.join("\n\n");
  return {
    name,
    size: text.length,
    extracted: {
      pageCount: pages.length,
      pages: texts.map((t, i) => ({
        pageNumber: i + 1,
        text: t,
        characterCount: t.length,
      })),
      text,
      characterCount: text.length,
      hasText: text.trim().length > 0,
    },
  };
}

const html = (r: PdfCompareResult) =>
  new DOMParser().parseFromString(buildRedlineHtml(r), "text/html");

type Row = { kind: "  " | "- " | "+ "; text: string };

/** A row's visible line text: no marker, no screen-reader cue. */
function lineText(row: Element): string {
  const copy = row.cloneNode(true) as Element;
  copy.querySelectorAll(".m, .sr").forEach((n) => n.remove());
  return copy.textContent ?? "";
}

function rowsOf(section: Element): Row[] {
  return [...section.querySelectorAll(".l")].map((row) => ({
    kind: row.classList.contains("r")
      ? "- "
      : row.classList.contains("a")
        ? "+ "
        : "  ",
    text: lineText(row),
  }));
}

/** The word marks of a row: <del>/<ins> preceded by a "[removed: " cue. */
function wordMarks(row: Element, tag: "del" | "ins"): string[] {
  return [...row.querySelectorAll(tag)]
    .filter((m) =>
      /^\[(?:removed|added): $/.test(
        m.previousElementSibling?.textContent ?? "",
      ),
    )
    .map((m) => m.textContent ?? "");
}

/** The .txt's hunks, each its lines after the `@@` header. */
function reportHunks(report: string): string[][] {
  const body = report.slice(report.indexOf("\nChanges:\n") + 10);
  return body
    .split(/\n\n(?=@@ )/)
    .filter((h) => h.startsWith("@@ "))
    .map((h) => h.split("\n").slice(1));
}

/** `[-a-]` / `{+b+}` contents of a hunk's `~ ` lines, in order. */
function tildeMarks(lines: string[], open: "[-" | "{+"): string[] {
  const re = open === "[-" ? /\[-(.*?)-\]/g : /\{\+(.*?)\+\}/g;
  return lines
    .filter((l) => l.startsWith("~ "))
    .flatMap((l) => [...l.matchAll(re)].map((m) => m[1]!));
}

/** The header lines of the .txt: from "Pages:" to the blank before Changes. */
function reportHeader(report: string): string[] {
  const lines = report.split("\n");
  const from = lines.findIndex((l) => l.startsWith("Pages: "));
  const to = lines.indexOf("Changes:");
  return lines.slice(from, to).filter((l) => l !== "");
}

function htmlHeader(page: Document): string[] {
  const dts = [...page.querySelectorAll("header dl dt")];
  const fields = dts.map(
    (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`,
  );
  const notes = [...page.querySelectorAll("header > p")]
    .slice(1)
    .map((p) => p.textContent ?? "");
  return [...fields, ...notes];
}

/** Every agreement this file asserts, for one result. */
function expectAgreement(result: PdfCompareResult) {
  const page = html(result);
  const report = result.report;
  const lines = report.split("\n");
  expect(page.querySelector("h1")?.textContent).toBe(lines[0]);
  expect(page.querySelector("header > p")?.textContent).toBe(lines[2]);
  expect(htmlHeader(page)).toEqual(reportHeader(report));
  const sections = [...page.querySelectorAll("main section")];
  const hunks = reportHunks(report);
  const headers = lines
    .filter((l) => l.startsWith("@@ "))
    .map((l) => l.slice(3, -3).replace(" -> ", " → "));
  expect(sections.length).toBe(hunks.length);
  expect(headers.length).toBe(hunks.length);
  sections.forEach((section, n) => {
    const txt = hunks[n]!;
    expect(section.querySelector("h3")?.textContent).toBe(headers[n]);
    expect(rowsOf(section)).toEqual(
      txt
        .filter((l) => !l.startsWith("~ "))
        .map((l) => ({ kind: l.slice(0, 2), text: l.slice(2) })),
    );
    const rows = [...section.querySelectorAll(".l")];
    expect(rows.flatMap((r) => wordMarks(r, "del"))).toEqual(
      tildeMarks(txt, "[-"),
    );
    expect(rows.flatMap((r) => wordMarks(r, "ins"))).toEqual(
      tildeMarks(txt, "{+"),
    );
  });
  if (hunks.length === 0) {
    const said = report.slice(report.indexOf("\nChanges:\n") + 10);
    expect(page.querySelector("main > p")?.textContent).toBe(said);
  }
  return page;
}

describe("the HTML redline agrees with the .txt report", () => {
  it("health: a hunked result has one section per hunk, and marks", async () => {
    const { left, right } = pageHeaderPair();
    const result = compareExtractedPdfText(
      await comparablePdf("v1.pdf", left),
      await comparablePdf("v2.pdf", right),
    );
    expect(result.hunks.length).toBeGreaterThanOrEqual(1);
    const page = expectAgreement(result);
    expect(page.querySelectorAll("main section").length).toBe(
      result.hunks.length,
    );
    expect(
      [...page.querySelectorAll("main section h3")].map((h) => h.textContent),
    ).toContain("Page 2 → page 3");
    expect(page.querySelectorAll("del").length).toBeGreaterThanOrEqual(1);
    expect(page.querySelectorAll("ins").length).toBeGreaterThanOrEqual(1);
  });

  const base = Array.from({ length: 30 }, (_, i) => `Clause ${i + 1} stands`);
  const edited = [...base];
  edited[4] = "Clause 5 stands amended";
  edited[12] = "Clause 13 changed entirely to something new";
  edited.splice(20, 0, "An inserted clause with no partner");
  edited.splice(26, 1);

  it.each([
    ["identical", doc("a.pdf", base), doc("b.pdf", base), {}],
    ["different", doc("a.pdf", base), doc("b.pdf", edited), {}],
    ["left-no-text", doc("scan.pdf", []), doc("b.pdf", base), {}],
    ["right-no-text", doc("a.pdf", base), doc("scan.pdf", []), {}],
    ["no-text", doc("a.pdf", []), doc("b.pdf", []), {}],
  ] as const)("%s", (verdict, a, b, options) => {
    const result = compareExtractedPdfText(a, b, options);
    expect(result.verdict).toBe(verdict);
    expectAgreement(result);
  });

  it("ignore case: an added line's unchanged words are the second file's", () => {
    const result = compareExtractedPdfText(
      doc("a.pdf", ["Total due now 100"]),
      doc("b.pdf", ["TOTAL DUE NOW 120"]),
      { ignoreCase: true },
    );
    const page = expectAgreement(result);
    const added = page.querySelector(".l.a")!;
    expect(lineText(added)).toBe("TOTAL DUE NOW 120");
    expect(wordMarks(added, "ins")).toEqual(["120"]);
    const removed = page.querySelector(".l.r")!;
    expect(lineText(removed)).toBe("Total due now 100");
  });

  it("ignore page headers and numbers: the set-aside counts are in the header", () => {
    // engine.test.ts's furniture pair: a running header, and page numbers
    // that count with the pages (of 3, of 4), plus one changed body line.
    const pages = (bodies: string[], of: number) =>
      bodies.map((b, i) => ["Acme Corp", b, `Page ${i + 1} of ${of}`]);
    const result = compareExtractedPdfText(
      pagedDoc("a.pdf", pages(["alpha text", "bravo text", "charlie text"], 3)),
      pagedDoc("b.pdf", pages(["alpha text", "bravo 2", "charlie text"], 4)),
      { ignoreFurniture: true },
    );
    expect(result.dropped.left).toBeGreaterThan(0);
    const page = expectAgreement(result);
    const options = [...page.querySelectorAll("dt")].find(
      (dt) => dt.textContent === "Options",
    )!.nextElementSibling!.textContent;
    expect(options).toMatch(/set aside from the first PDF/);
  });

  it("a pair a word-mark bound skipped is listed unmarked, and the sentence says so", () => {
    const long = (w: string) =>
      Array.from({ length: MAX_WORD_PAIR_TOKENS }, (_, i) =>
        i === 7 ? w : `w${i}`,
      ).join(" ");
    const result = compareExtractedPdfText(
      doc("a.pdf", ["Intro", long("old"), "Outro"]),
      doc("b.pdf", ["Intro", long("new"), "Outro"]),
    );
    expect(result.wordFallbacks).toBeGreaterThan(0);
    const page = expectAgreement(result);
    expect(page.querySelectorAll("del, ins")).toHaveLength(0);
    expect(page.body.textContent).toContain("Word marks skipped for");
  });

  it("an unpaired line is one whole mark, with no word cues", () => {
    const result = compareExtractedPdfText(
      doc("a.pdf", ["Keep this", "Keep that"]),
      doc("b.pdf", ["Keep this", "Keep that", "A brand new closing line"]),
    );
    const page = expectAgreement(result);
    const ins = page.querySelectorAll(".l.a ins");
    expect([...ins].map((n) => n.textContent)).toEqual([
      "A brand new closing line",
    ]);
  });

  it("is deterministic: the same result gives the same bytes", async () => {
    const { left, right } = pageHeaderPair();
    const a = await comparablePdf("v1.pdf", left);
    const b = await comparablePdf("v2.pdf", right);
    expect(buildRedlineHtml(compareExtractedPdfText(a, b))).toBe(
      buildRedlineHtml(compareExtractedPdfText(a, b)),
    );
  });
});

/* ------------------------------------------------------------------ *
 *  Escaping
 * ------------------------------------------------------------------ */

/** Each hostile string, and what a reader must get back as text. */
const LONE_HIGH = ch(0xd800);
const LONE_LOW = ch(0xdc00);
const CORPUS: [string, string][] = [
  ["<script>alert(1)</script>", "<script>alert(1)</script>"],
  ['"><img src=x onerror=alert(1)>', '"><img src=x onerror=alert(1)>'],
  ["javascript:alert(1)", "javascript:alert(1)"],
  ["</del><ins>", "</del><ins>"],
  ["</style>", "</style>"],
  ["]]>", "]]>"],
  ["<!--", "<!--"],
  ["&amp;", "&amp;"],
  ["it's", "it's"],
  [`a${ch(0)}b`, `a${FFFD}b`],
  [`a${ch(1)}b`, `a${FFFD}b`],
  [`a${ch(0x1b)}b`, `a${FFFD}b`],
  [`a${ch(0x7f)}b`, `a${FFFD}b`],
  [`a${ch(0xfffe)}b`, `a${FFFD}b`],
  [`a${ch(0xffff)}b`, `a${FFFD}b`],
  [`a${LONE_HIGH}b`, `a${FFFD}b`],
  [`a${LONE_LOW}b`, `a${FFFD}b`],
  [`a${ch(0x202e)}gnp.exe`, `a${ch(0x202e)}gnp.exe`],
  // A real pair survives whole; tab is allowed.
  [`x${ch(0xd83d, 0xde00)}y${ch(9)}z`, `x${ch(0xd83d, 0xde00)}y${ch(9)}z`],
];

const ELEMENTS = new Set([
  "html",
  "head",
  "meta",
  "title",
  "style",
  "body",
  "header",
  "h1",
  "h2",
  "h3",
  "bdi",
  "span",
  "p",
  "dl",
  "dt",
  "dd",
  "main",
  "section",
  "div",
  "del",
  "ins",
  "footer",
]);
const ATTRIBUTES = new Set([
  "lang",
  "class",
  "dir",
  "id",
  "aria-labelledby",
  "aria-hidden",
  "name",
  "content",
  "charset",
  "http-equiv",
]);

function hostileResult(): PdfCompareResult {
  const lines = CORPUS.map(([s]) => s);
  const result = compareExtractedPdfText(
    doc("left.pdf", ["Shared opening line", ...lines.map((l) => `L ${l}`)]),
    doc("right.pdf", ["Shared opening line", ...lines.map((l) => `R ${l}`)]),
  );
  const names = lines.join(" | ");
  return { ...result, leftName: `${names}.pdf`, rightName: `x${names}.pdf` };
}

describe("everything the PDFs and the file names carry is text", () => {
  it.each(CORPUS)("escapeHtml(%j) reads back as its text", (input, want) => {
    const out = escapeHtml(input);
    expect(out).not.toMatch(/[<>"']/);
    const box = document.createElement("div");
    box.innerHTML = `<span title="${out}">${out}</span>`;
    expect(box.firstElementChild!.textContent).toBe(want);
    expect(box.firstElementChild!.getAttribute("title")).toBe(want);
    expect(box.querySelectorAll("*")).toHaveLength(1);
  });

  it("a hostile result builds no element or attribute beyond the page's own", () => {
    const result = hostileResult();
    const page = html(result);
    const all = [...page.querySelectorAll("*")];
    // Health: the page is there, with its rows.
    expect(all.length).toBeGreaterThan(40);
    expect(page.querySelectorAll(".l").length).toBeGreaterThanOrEqual(
      CORPUS.length,
    );
    expect(
      page.querySelectorAll("script, img, link, iframe, object, a"),
    ).toHaveLength(0);
    const elements = all
      .map((e) => e.localName)
      .filter((n) => !ELEMENTS.has(n));
    expect(elements, "elements outside the page's own").toEqual([]);
    const attributes = all.flatMap((e) =>
      e.getAttributeNames().filter((a) => !ATTRIBUTES.has(a)),
    );
    expect(attributes, "attributes outside the page's own").toEqual([]);
  });

  it("each hostile string is recovered verbatim, forbidden code points as U+FFFD", () => {
    const result = hostileResult();
    const page = html(result);
    const names = CORPUS.map(([, want]) => want).join(" | ");
    // The <title> element's text, not `document.title`, which collapses
    // whitespace (the corpus has a tab).
    expect(page.querySelector("title")?.textContent).toBe(
      `${names}.pdf vs x${names}.pdf: PDF comparison`,
    );
    const files = [...page.querySelectorAll("h1 .f")].map((f) => f.textContent);
    expect(files).toEqual([`${names}.pdf`, `x${names}.pdf`]);
    // The rows carry what the report carries, with the same replacement.
    const fix = (s: string) =>
      [...s]
        .map((c) => {
          const code = c.codePointAt(0)!;
          return (code < 32 && code !== 9 && code !== 10) ||
            code === 0x7f ||
            code === 0xfffe ||
            code === 0xffff ||
            (code >= 0xd800 && code <= 0xdfff)
            ? FFFD
            : c;
        })
        .join("");
    const want = reportHunks(result.report)
      .flat()
      .filter((l) => !l.startsWith("~ "))
      .map((l) => fix(l.slice(2)));
    const got = [...page.querySelectorAll(".l")].map(lineText);
    expect(got).toEqual(want);
    // Health: the hostile lines are among them.
    expect(got.some((g) => g.includes("<script>alert(1)</script>"))).toBe(true);
    expect(got.some((g) => g.includes("</del><ins>"))).toBe(true);
  });

  it("a bidi override in a line cannot move the row's marker: every row sets dir=auto, the marker first", () => {
    const page = html(hostileResult());
    const rows = [...page.querySelectorAll(".l")];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.getAttribute("dir")).toBe("auto");
      expect(row.firstElementChild?.className).toBe("m");
    }
    expect(rows.some((r) => (r.textContent ?? "").includes(ch(0x202e)))).toBe(
      true,
    );
  });

  it("is well-formed XML for every case, hostile ones included", async () => {
    const { left, right } = pageHeaderPair();
    const results = [
      hostileResult(),
      compareExtractedPdfText(
        await comparablePdf("v1.pdf", left),
        await comparablePdf("v2.pdf", right),
      ),
      compareExtractedPdfText(doc("a.pdf", []), doc("b.pdf", ["x"])),
      compareExtractedPdfText(doc("a.pdf", ["x"]), doc("b.pdf", ["x"])),
    ];
    for (const r of results) {
      const xml = new DOMParser().parseFromString(
        buildRedlineHtml(r),
        "application/xml",
      );
      expect(xml.getElementsByTagName("parsererror")).toHaveLength(0);
      expect(xml.documentElement.localName).toBe("html");
    }
    // Positive control: the parser does report a malformed document.
    const bad = new DOMParser().parseFromString(
      "<html><p>a<br></p></html>",
      "application/xml",
    );
    expect(bad.getElementsByTagName("parsererror").length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 *  Self-contained, and the CSP's hash is the stylesheet's
 * ------------------------------------------------------------------ */

describe("a file name cannot reorder the heading around it", () => {
  // 2026-11-15 review: a first file named "contract \u202Evdr.pdf" turned the
  // h1 into "contract fdp.lanif sv fdp.rdv". A <span> does not isolate bidi,
  // so the override ran on past the name into " vs " and the second name.
  // <bdi> scopes each name's direction to the name. (The <title> cannot hold
  // markup and is still open; see the PR.)
  it("each name in the h1 is its own bidi isolate", () => {
    const base = hostileResult();
    const page = html({
      ...base,
      leftName: `contract ${String.fromCharCode(0x202e)}vdr.pdf`,
      rightName: "final.pdf",
    });
    const names = [...page.querySelectorAll("h1 .f")];
    expect(names.map((n) => n.textContent)).toEqual([
      `contract ${String.fromCharCode(0x202e)}vdr.pdf`,
      "final.pdf",
    ]);
    expect(names.map((n) => n.localName)).toEqual(["bdi", "bdi"]);
    // " vs " sits outside both isolates, as the h1's own text.
    expect(page.querySelector("h1")!.textContent).toContain("vdr.pdf vs final");
  });
});

describe("the page loads nothing and runs nothing", () => {
  async function realHtml() {
    const { left, right } = pageHeaderPair();
    return buildRedlineHtml(
      compareExtractedPdfText(
        await comparablePdf("v1.pdf", left),
        await comparablePdf("v2.pdf", right),
      ),
    );
  }

  it("names no resource: no src, href, url(), @import, script, link or style attribute", async () => {
    const raw = await realHtml();
    for (const re of [
      /\bsrc=/i,
      /\bhref=/i,
      /url\(/i,
      /@import/i,
      /<script/i,
      /<link/i,
      /\sstyle=/i,
    ])
      expect(raw, String(re)).not.toMatch(re);
    // Positive control: the same regexes see each of them.
    expect('<img src="x" style="a" />').toMatch(/\bsrc=/i);
    expect('<img src="x" style="a" />').toMatch(/\sstyle=/i);
  });

  it("starts with the doctype, the charset within 1024 bytes, the CSP before any content", async () => {
    const raw = await realHtml();
    expect(raw.startsWith("<!DOCTYPE html>\n")).toBe(true);
    const charset = raw.indexOf('<meta charset="utf-8" />');
    expect(charset).toBeGreaterThan(0);
    expect(new TextEncoder().encode(raw.slice(0, charset)).length).toBeLessThan(
      1024,
    );
    const csp = raw.indexOf(
      `<meta http-equiv="Content-Security-Policy" content="${REDLINE_CSP}" />`,
    );
    expect(csp).toBeGreaterThan(charset);
    expect(csp).toBeLessThan(raw.indexOf("<title>"));
    expect(csp).toBeLessThan(raw.indexOf("<style>"));
    const page = new DOMParser().parseFromString(raw, "text/html");
    const metas = page.querySelectorAll(
      'meta[http-equiv="Content-Security-Policy"]',
    );
    expect(metas).toHaveLength(1);
    expect(metas[0]!.getAttribute("content")).toBe(REDLINE_CSP);
  });

  it("the policy forbids everything but its own stylesheet", () => {
    expect(REDLINE_CSP).toBe(
      `default-src 'none'; style-src 'sha256-${REDLINE_CSS_SHA256}'; base-uri 'none'; form-action 'none'`,
    );
  });

  it("the CSP's hash is the SHA-256 of the exact bytes between <style> and </style>", async () => {
    const raw = await realHtml();
    const open = raw.indexOf("<style>") + "<style>".length;
    const css = raw.slice(open, raw.indexOf("</style>", open));
    expect(css).toBe(REDLINE_CSS);
    const hash = createHash("sha256").update(css, "utf8").digest("base64");
    expect(hash).toBe(REDLINE_CSS_SHA256);
    expect(raw).toContain(`'sha256-${hash}'`);
    expect(raw.match(/<style>/g)).toHaveLength(1);
  });

  it("the stylesheet holds nothing an escape would have to carry, and no inline style anywhere", () => {
    expect(REDLINE_CSS).not.toMatch(/[<&]/);
    expect(REDLINE_CSS).not.toMatch(/url\(|@import|expression\(/i);
  });

  it("the generator meta is the lazy-chunk marker, so the minifier keeps it", async () => {
    const page = new DOMParser().parseFromString(await realHtml(), "text/html");
    expect(
      page.querySelector('meta[name="generator"]')?.getAttribute("content"),
    ).toBe(COMPARE_REDLINE_CHUNK);
  });
});

/* ------------------------------------------------------------------ *
 *  Contrast, read from the stylesheet itself
 * ------------------------------------------------------------------ */

function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,8})/gi)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  );
}

describe("the redline's colours pass 4.5:1 in light, dark and print", () => {
  const light = /^:root\{([^}]*)\}/.exec(REDLINE_CSS)?.[1] ?? "";
  const dark =
    /@media \(prefers-color-scheme: ?dark\)\{:root\{([^}]*)\}/.exec(
      REDLINE_CSS,
    )?.[1] ?? "";
  const print = /@media print\{:root\{([^}]*)\}/.exec(REDLINE_CSS)?.[1] ?? "";
  const PAIRS = [
    ["fg", "bg"],
    ["muted", "bg"],
    ["fg", "del-bg"],
    ["fg", "ins-bg"],
    ["del-fg", "del-bg"],
    ["ins-fg", "ins-bg"],
  ] as const;

  it("health: each scheme defines every token the pairs read", () => {
    for (const block of [light, dark, print]) {
      const t = tokens(block);
      for (const [a, b] of PAIRS) {
        expect(t[a], a).toBeTruthy();
        expect(t[b], b).toBeTruthy();
      }
    }
    // The schemes differ: a dark block that copied the light one is blind.
    expect(tokens(dark).bg).not.toBe(tokens(light).bg);
  });

  it.each([
    ["light", light],
    ["dark", dark],
    ["print", print],
  ])("%s", (_, block) => {
    const t = tokens(block);
    for (const [fg, bg] of PAIRS) {
      const ratio = contrastRatio(parseColor(t[fg]!)!, parseColor(t[bg]!)!);
      expect(
        ratio,
        `${fg} on ${bg}: ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("meaning never rests on colour: the + and − markers are text, and ins is thickened", async () => {
    const result = compareExtractedPdfText(
      doc("a.pdf", ["one two"]),
      doc("b.pdf", ["one three"]),
    );
    const page = html(result);
    expect(page.querySelector(".l.r .m")?.textContent).toBe("−");
    expect(page.querySelector(".l.a .m")?.textContent).toBe("+");
    expect(REDLINE_CSS).toMatch(/ins\{[^}]*text-decoration-thickness:2px/);
  });
});
