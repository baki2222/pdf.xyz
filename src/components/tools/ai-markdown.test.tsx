// @vitest-environment jsdom
/**
 * The AI summary and chat answer drawn as formatted Markdown (competitor
 * audit #4, 2026-11-17), held to three properties:
 *
 *  1. FORMATTED: headings, lists, bold, italic, code, links, tables, quotes
 *     and rules become their elements, and the marks are gone.
 *  2. INERT: whatever the model writes, the DOM holds only the elements and
 *     attributes the renderer makes (ALLOWLISTS, each exercised by the
 *     formatting corpus, so neither list can hold a name nothing renders),
 *     and every href is http, https or mailto.
 *  3. BOUNDED: a hostile 200 KB answer of every shape parses quickly, and the
 *     DOM never holds more characters than the source (the result views'
 *     character cap is a claim about what is drawn).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  LINK_SCHEMES,
  MAX_DEPTH,
  MarkdownText,
  headingLevel,
  parseInline,
  parseMarkdown,
  safeHref,
  type Block,
  type Inline,
} from "./ai-markdown";
import { AI_RESULT_CHUNK } from "./ai-result-chunk";

afterEach(cleanup);

const ch = (...codes: number[]) => String.fromCharCode(...codes);
const TAB = ch(9);
const LF = ch(10);

function draw(text: string, headingBase = 3) {
  return render(<MarkdownText text={text} headingBase={headingBase} />)
    .container.firstElementChild as HTMLElement;
}

/** Every element below (not including) the root. */
const elements = (root: Element) => [...root.querySelectorAll("*")];

// ── 1. Formatted ────────────────────────────────────────────────────────

const FORMATTING = [
  "# Lease summary",
  "",
  "The lease runs for **three years** and the *tenant* pays `rent` monthly.",
  "",
  "## Key points",
  "",
  "1. Rent is due on the first",
  "   - paid by transfer",
  "   - late after five days",
  "2. Notice is ninety days",
  "",
  "Then:",
  "",
  "5. Starts at five",
  "",
  "- A bullet with a [link](https://example.com/terms) and <https://example.org>",
  "- See https://example.net/a_(b).",
  "- Write to [the landlord](mailto:landlord@example.com)",
  "",
  "> A quoted line",
  "",
  "---",
  "",
  "```",
  "const rent = 1200;",
  "```",
  "",
  "| Item | Amount |",
  "| :--- | -----: |",
  "| Rent | 1,200 |",
  "| Deposit | 2,400 |",
  "",
  "### Detail",
  "",
  "***Both*** and snake_case_name stay apart.",
].join(LF);

describe("formatted", () => {
  it("draws every kind, with the marks gone", () => {
    const root = draw(FORMATTING, 3);
    expect(root.getAttribute("data-chunk")).toBe(AI_RESULT_CHUNK);
    expect(root.querySelector("h3")!.textContent).toBe("Lease summary");
    expect(root.querySelector("h4")!.textContent).toBe("Key points");
    expect(root.querySelector("h5")!.textContent).toBe("Detail");
    expect(root.querySelector("strong")!.textContent).toBe("three years");
    expect(root.querySelector("em")!.textContent).toBe("tenant");
    expect(root.querySelector("p code")!.textContent).toBe("rent");
    expect(root.querySelector("pre code")!.textContent).toBe(
      "const rent = 1200;",
    );
    // A numbered list with a nested bullet list in its first item.
    const ol = root.querySelector("ol")!;
    expect(ol.children).toHaveLength(2);
    expect(
      [...ol.querySelectorAll(":scope > li > div > ul > li")].map(
        (li) => li.textContent,
      ),
    ).toEqual(["paid by transfer", "late after five days"]);
    expect(root.querySelectorAll("ol")[1]!.getAttribute("start")).toBe("5");
    const links = [...root.querySelectorAll("a")];
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["link", "https://example.com/terms"],
      ["https://example.org", "https://example.org/"],
      ["https://example.net/a_(b)", "https://example.net/a_(b)"],
      ["the landlord", "mailto:landlord@example.com"],
    ]);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    }
    expect(root.querySelector("blockquote")!.textContent).toBe("A quoted line");
    expect(root.querySelectorAll("hr")).toHaveLength(1);
    const table = root.querySelector("table")!;
    expect([...table.querySelectorAll("th")].map((t) => t.textContent)).toEqual(
      ["Item", "Amount"],
    );
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(
      (table.querySelector("th:nth-child(2)") as HTMLElement).style.textAlign,
    ).toBe("right");
    // `***x***` is bold italic; an underscore inside a word is a letter.
    expect(root.querySelector("strong > em")!.textContent).toBe("Both");
    expect(root.textContent).toContain("snake_case_name");
    // No mark survives in the drawn text (the code block keeps its own text).
    const prose = root.textContent!.replace("const rent = 1200;", "");
    for (const mark of ["**", "# ", "](", "```", "| :---"])
      expect(prose, mark).not.toContain(mark);
  });

  it("plain text stays one paragraph, line breaks kept", () => {
    const text = `First line${LF}second line [p.3]`;
    const root = draw(text);
    expect(root.querySelectorAll("p")).toHaveLength(1);
    expect(root.textContent).toBe(text);
    expect(root.style.whiteSpace).toBe("pre-wrap");
  });

  it("unclosed marks are shown as written", () => {
    for (const text of [
      "**bold",
      "*em",
      "`code",
      "[label](see the notes",
      "<b>unclosed",
      "a * b * c",
      "2 * 3 = 6",
    ]) {
      const root = draw(text);
      expect(root.textContent, text).toBe(text);
      expect(root.querySelectorAll("strong, em, code, a"), text).toHaveLength(
        0,
      );
    }
    // An unclosed fence runs to the end, as CommonMark has it.
    expect(draw(`\`\`\`${LF}open`).querySelector("pre")!.textContent).toBe(
      "open",
    );
  });

  it("a list nested four spaces deep is still nested", () => {
    const root = draw(["- a", "    - b", "        - c"].join(LF));
    expect(root.querySelectorAll("ul")).toHaveLength(3);
    expect(root.querySelector("ul ul ul")!.textContent).toBe("c");
  });
});

// ── Heading levels ──────────────────────────────────────────────────────

describe("headings continue the page's outline", () => {
  const levels = (text: string, base: number) =>
    [...draw(text, base).querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) =>
      Number(h.tagName[1]),
    );

  it("the shallowest heading is drawn at the base, deeper ones under it, never past h6", () => {
    const cases: [string, number, number[]][] = [
      [`# A${LF}## B${LF}### C`, 3, [3, 4, 5]],
      [`# A${LF}## B${LF}### C`, 4, [4, 5, 6]],
      [`## B${LF}### C${LF}###### F`, 4, [4, 5, 6]],
      [`### C${LF}# A`, 3, [5, 3]],
      [`- item${LF}  ## In a list`, 4, [4]],
    ];
    for (const [text, base, want] of cases) {
      const got = levels(text, base);
      expect(got, text).toEqual(want);
      // The property, as well as the examples.
      expect(Math.min(...got)).toBe(base);
      expect(Math.max(...got)).toBeLessThanOrEqual(6);
    }
  });

  it("positive control: without the shift, ## under base 4 would be an h5", () => {
    expect(headingLevel(2, 2, 4)).toBe(4);
    expect(headingLevel(2, 1, 4)).toBe(5);
    expect(headingLevel(6, 1, 4)).toBe(6);
  });
});

// ── 2. Inert ────────────────────────────────────────────────────────────

/**
 * Every element and attribute the renderer may make. Both directions are
 * checked: the hostile corpus makes nothing outside these, and the
 * formatting corpus makes every one of them.
 */
const ALLOWED_TAGS = new Set([
  "p",
  "h3",
  "h4",
  "h5",
  "strong",
  "em",
  "code",
  "pre",
  "a",
  "ul",
  "ol",
  "li",
  "div",
  "blockquote",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]);
/**
 * The schemes a link may open, written HERE rather than read from the module
 * under test: a check that took its allowlist from the renderer would accept
 * whatever the renderer was changed to allow (it did, under mutation).
 */
const WEB_SCHEMES = ["http:", "https:", "mailto:"];

const ALLOWED_ATTRIBUTES = new Set([
  "class",
  "style",
  "href",
  "target",
  "rel",
  "start",
  "scope",
  "role",
  "aria-label",
  "tabindex",
]);

/** Link destinations in every spelling a reader's browser might run. */
const HOSTILE_DESTINATIONS = [
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  ` javascript:alert(1)`,
  `java${TAB}script:alert(1)`,
  `java${ch(13)}script:alert(1)`,
  `${ch(1)}javascript:alert(1)`,
  `javascript${ch(0)}:alert(1)`,
  `java${ch(0xad)}script:alert(1)`,
  "&#106;avascript:alert(1)",
  "&#x6A;avascript:alert(1)",
  "javascript&colon;alert(1)",
  "jav&#x09;ascript:alert(1)",
  "javascript://example.com/%0Aalert(1)",
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  "DATA:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "VBScript:msgbox(1)",
  "file:///etc/passwd",
  "//evil.example/x",
  "/relative/path",
  "#top",
  "https:javascript:alert(1)",
  `https://example.com/${ch(0)}`,
];

const HOSTILE = [
  ...HOSTILE_DESTINATIONS.flatMap((d) => [
    `[click](${d})`,
    `[click](<${d}>)`,
    `[click]( ${d} "title")`,
    `![img](${d})`,
    `<${d}>`,
    d,
  ]),
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '<a href="javascript:alert(1)">x</a>',
  "<iframe src=javascript:alert(1)></iframe>",
  "<svg onload=alert(1)>",
  "<style>*{display:none}</style>",
  "&lt;script&gt;alert(1)&lt;/script&gt;",
  "[[[[x](javascript:alert(1))]]]",
  "[a [b](https://ok.example) c](javascript:alert(1))",
  "[x](https://ok.example/(a(b)c))",
  "**[x](javascript:alert(1))**",
  "`[x](javascript:alert(1))`",
  "| a | b |\n| - | - |\n| [x](javascript:alert(1)) | <img src=x onerror=alert(1)> |",
  "> <script>alert(1)</script>",
  "- [x](vbscript:msgbox(1))\n  - <img src=x onerror=alert(1)>",
  "```html\n<script>alert(1)</script>\n```",
];

function assertInert(root: Element, label: string) {
  for (const el of elements(root)) {
    expect(
      ALLOWED_TAGS.has(el.tagName.toLowerCase()),
      `${label}: <${el.tagName}>`,
    ).toBe(true);
    for (const attr of el.getAttributeNames()) {
      expect(ALLOWED_ATTRIBUTES.has(attr), `${label}: ${attr}`).toBe(true);
    }
    const href = el.getAttribute("href");
    if (href !== null)
      expect(
        WEB_SCHEMES.includes(new URL(href).protocol),
        `${label}: ${href}`,
      ).toBe(true);
  }
}

describe("inert", () => {
  it("health check: the hostile corpus is the size it was written at", () => {
    expect(HOSTILE_DESTINATIONS).toHaveLength(23);
    expect(HOSTILE.length).toBe(23 * 6 + 16);
  });

  it("no hostile entry makes an element, attribute or href outside the allowlists", () => {
    for (const text of HOSTILE) {
      const root = draw(text);
      assertInert(root, JSON.stringify(text));
      expect(root.querySelectorAll("a[href*=script i]")).toHaveLength(0);
    }
  });

  it("no hostile destination becomes a link, in any syntax", () => {
    for (const d of HOSTILE_DESTINATIONS) {
      expect(safeHref(d), JSON.stringify(d)).toBeNull();
      for (const text of [`[click](${d})`, `<${d}>`, d, `![img](${d})`])
        expect(draw(text).querySelectorAll("a"), text).toHaveLength(0);
    }
  });

  it("markup is characters on the page", () => {
    const root = draw(
      "<script>alert(1)</script> and <img src=x onerror=alert(1)>",
    );
    expect(root.textContent).toBe(
      "<script>alert(1)</script> and <img src=x onerror=alert(1)>",
    );
    expect(root.querySelectorAll("script, img")).toHaveLength(0);
  });

  it("a link that is refused is shown as the characters the model wrote", () => {
    const text = "[click](javascript:alert(1))";
    expect(draw(text).textContent).toBe(text);
  });

  it("both directions: the formatting corpus makes every allowed tag and attribute", () => {
    const root = draw(FORMATTING, 3);
    // The renderer's own root carries the chunk marker; its children are the corpus.
    const all = [root, ...elements(root)];
    const tags = new Set(elements(root).map((el) => el.tagName.toLowerCase()));
    const attributes = new Set(all.flatMap((el) => el.getAttributeNames()));
    expect([...ALLOWED_TAGS].filter((t) => !tags.has(t))).toEqual([]);
    expect([...ALLOWED_ATTRIBUTES].filter((a) => !attributes.has(a))).toEqual(
      [],
    );
    // ...and itself passes the same check.
    assertInert(root, "formatting corpus");
  });

  it("positive control: assertInert fails on a script, an onerror and a javascript: href", () => {
    for (const html of [
      "<script></script>",
      '<p onclick="x"></p>',
      '<a href="javascript:alert(1)">x</a>',
      '<a href="data:text/html,x">x</a>',
    ]) {
      const host = document.createElement("div");
      host.innerHTML = html;
      expect(() => assertInert(host, html), html).toThrow();
    }
  });

  it("the module's schemes are the brief's three, no more", () => {
    expect([...LINK_SCHEMES]).toEqual(WEB_SCHEMES);
  });

  it("safe addresses are links (positive control for the refusals above)", () => {
    expect(safeHref("https://example.com/a?b=c#d")).toBe(
      "https://example.com/a?b=c#d",
    );
    expect(safeHref("HTTP://EXAMPLE.COM")).toBe("http://example.com/");
    expect(safeHref("mailto:a@example.com")).toBe("mailto:a@example.com");
  });
});

// ── Text runs and the leaf ──────────────────────────────────────────────

describe("the leaf draws text runs, never a link's text", () => {
  it("every text run outside a link reaches the leaf, whole", () => {
    const seen: string[] = [];
    render(
      <MarkdownText
        text={
          "See **rent [p.2]** and [p.3]; [the terms [p.4]](https://example.com)."
        }
        headingBase={3}
        leaf={(t) => {
          seen.push(t);
          return t;
        }}
      />,
    );
    expect(seen).toEqual(["See ", "rent [p.2]", " and [p.3]; ", "."]);
  });
});

// ── 3. Bounded ──────────────────────────────────────────────────────────

/** The characters a parse keeps as text, in order. */
function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => (n.t === "text" || n.t === "code" ? n.v : inlineText(n.c)))
    .join("");
}
function blockText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.t) {
        case "h":
        case "p":
          return inlineText(b.c);
        case "code":
          return b.v;
        case "quote":
          return blockText(b.c);
        case "list":
          return b.items.map(blockText).join("");
        case "hr":
          return "";
        case "table":
          return [b.head, ...b.rows]
            .flat()
            .map((cell) => inlineText(cell))
            .join("");
      }
    })
    .join("");
}

const KB200 = 200_000;
const fill = (unit: string) => unit.repeat(Math.ceil(KB200 / unit.length));

/** 200 KB in every shape that makes a naive parser quadratic or deep. */
const PATHOLOGICAL: [string, string][] = [
  ["stars", fill("*")],
  ["underscores", fill("_")],
  ["open strong", fill("**a ")],
  ["star letter", fill("*a")],
  ["letter star", fill("a*")],
  ["open brackets", fill("[")],
  ["open links", fill("[a](")],
  ["close brackets", fill("]")],
  ["backticks", fill("` ")],
  ["backtick runs", fill("a``")],
  ["angle", fill("<")],
  ["angle letters", fill("<a")],
  ["quotes", fill("> ")],
  ["bullets", fill("- ")],
  ["backslashes", fill("\\")],
  ["urls", fill("http://")],
  ["url parens", `https://e.x/${fill(")")}`],
  ["pipes", fill("|-|\n")],
  ["hashes", fill("#")],
  [
    "staircase list",
    Array.from({ length: 20_000 }, (_, k) => `${" ".repeat(k % 40)}- x`).join(
      LF,
    ),
  ],
  ["hostile answer", fill(`${HOSTILE.join(LF)}${LF}${FORMATTING}${LF}`)],
];

describe("bounded", () => {
  it("health check: every shape is at least 200 KB", () => {
    expect(PATHOLOGICAL).toHaveLength(21);
    for (const [name, text] of PATHOLOGICAL)
      expect(text.length, name).toBeGreaterThanOrEqual(KB200 - 10);
  });

  it("each 200 KB shape parses in well under a second, losing no more than its marks", () => {
    for (const [name, text] of PATHOLOGICAL) {
      const started = performance.now();
      const blocks = parseMarkdown(text);
      const took = performance.now() - started;
      expect(took, name).toBeLessThan(1_500);
      expect(blockText(blocks).length, name).toBeLessThanOrEqual(text.length);
    }
  });

  it("text with no marks keeps every character", () => {
    expect(inlineText(parseInline(fill("a * ")))).toBe(fill("a * "));
    expect(inlineText(parseInline(fill("[")))).toBe(fill("["));
    expect(inlineText(parseInline(fill("<a")))).toBe(fill("<a"));
  });

  it("nesting stops at MAX_DEPTH, and the rest is shown as written", () => {
    const deep = "> ".repeat(MAX_DEPTH + 5) + "end";
    const root = draw(deep);
    expect(root.querySelectorAll("blockquote").length).toBe(MAX_DEPTH);
    expect(root.textContent).toContain("end");
  });

  it("the hostile 200 KB answer renders inert, with no more characters than its source", () => {
    const text = PATHOLOGICAL.at(-1)![1];
    const root = draw(text);
    expect(root.textContent!.length).toBeLessThanOrEqual(text.length);
    assertInert(root, "hostile 200 KB");
  }, 60_000);

  it("the DOM never holds more characters than the source, entry by entry", () => {
    for (const text of [...HOSTILE, FORMATTING])
      expect(draw(text).textContent!.length, text).toBeLessThanOrEqual(
        text.length,
      );
  });
});

// ── Lazy: who may import the renderer ───────────────────────────────────

const SRC = path.join(process.cwd(), "src");
function sources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
      ? [full]
      : [];
  });
}
/** A value import or re-export (not `import type`) of `name`, by any path. */
const importsOf = (name: string) =>
  new RegExp(
    `^(?:import|export)\\s+(?!type\\b)[^;]*?from\\s+["'][^"']*/${name}["']`,
    "m",
  );

describe("the renderer is reached only through the lazy AI result chunk", () => {
  const files = sources();
  const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
  const importers = (name: string) =>
    files
      .filter((f) => importsOf(name).test(readFileSync(f, "utf8")))
      .map(rel)
      .sort();

  it("health check: the walk saw the codebase", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("ai-markdown is imported by the views and the chat answer only", () => {
    expect(importers("ai-markdown")).toEqual([
      "components/tools/ai-result-views.tsx",
      "components/tools/chat-answer.tsx",
    ]);
  });

  it("chat-answer is imported by the views only (no page loads it up front)", () => {
    expect(importers("chat-answer")).toEqual([
      "components/tools/ai-result-views.tsx",
    ]);
  });

  it("positive control: the pattern sees a value import, not a type import", () => {
    expect(
      importsOf("chat-answer").test(
        'import { ChatAnswer } from "./chat-answer";',
      ),
    ).toBe(true);
    expect(
      importsOf("chat-answer").test('import type { X } from "./chat-answer";'),
    ).toBe(false);
  });
});
