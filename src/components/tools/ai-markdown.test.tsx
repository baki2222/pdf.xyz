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
  parseInline,
  parseMarkdown,
  safeHref,
  type Block,
  type Inline,
} from "./ai-markdown";
import { AI_RESULT_CHUNK } from "./ai-result-chunk";
import { expectFasterThan, expectRatioBelow } from "@/tests/time-bound";

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
  "",
  "The lease was signed in",
  "2024. It renews each year.",
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
    // A wrapped line that starts with a year goes on with its paragraph: only
    // a list starting at 1 ends one (review, 2026-11-18: this drew an
    // <ol start="2024">).
    expect(root.querySelectorAll("ol")).toHaveLength(2);
    expect([...root.querySelectorAll("p")].map((p) => p.textContent)).toContain(
      `The lease was signed in${LF}2024. It renews each year.`,
    );
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

  it("only a list starting at 1, or a bullet with text, ends a paragraph", () => {
    const cases: [string, string[], string[]][] = [
      // [text, the paragraphs outside a list, the list items]
      [`Text${LF}2024. continues`, [`Text${LF}2024. continues`], []],
      [`Text${LF}2) continues`, [`Text${LF}2) continues`], []],
      [`Text${LF}-`, [`Text${LF}-`], []],
      [
        `> Quoted${LF}2024. still quoted`,
        [`Quoted${LF}2024. still quoted`],
        [],
      ],
      // Positive controls: these do start a list.
      [`Text${LF}1. first`, ["Text"], ["first"]],
      [`Text${LF}- bullet`, ["Text"], ["bullet"]],
      // A list's own items are numbered on, whatever the number.
      [`1. a${LF}2. b${LF}3. c`, [], ["a", "b", "c"]],
      [`7. a${LF}8. b`, [], ["a", "b"]],
    ];
    for (const [text, paragraphs, items] of cases) {
      const root = draw(text);
      const outside = [...root.querySelectorAll("p")].filter(
        (p) => !p.closest("li"),
      );
      expect(
        outside.map((p) => p.textContent),
        text,
      ).toEqual(paragraphs);
      expect(
        [...root.querySelectorAll("li")].map((li) => li.textContent),
        text,
      ).toEqual(items);
    }
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

  /**
   * The property, as a function, so its positive control runs through it:
   * under a heading of level `base - 1`, every heading is at least the base,
   * at most h6, and never more than one level deeper than the one before it
   * (axe heading-order), and the shallowest is the base.
   */
  function outlineGaps(got: number[], base: number): string[] {
    const found: string[] = [];
    let previous = base - 1;
    for (const level of got) {
      if (level > previous + 1) found.push(`h${level} after h${previous}`);
      if (level < base || level > 6) found.push(`h${level} outside`);
      previous = level;
    }
    if (got.length > 0 && Math.min(...got) !== base)
      found.push(`shallowest h${Math.min(...got)}`);
    return found;
  }

  it("the shallowest heading is drawn at the base, each deeper one level at a time, never past h6", () => {
    const cases: [string, number, number[]][] = [
      [`# A${LF}## B${LF}### C`, 3, [3, 4, 5]],
      [`# A${LF}## B${LF}### C`, 4, [4, 5, 6]],
      // A level the model skipped is closed up (review, 2026-11-18: this
      // drew h4 then h6 under the result card's h3, and axe's heading-order
      // failed on the served page).
      [`## Summary${LF}${LF}Text${LF}${LF}#### Details`, 4, [4, 5]],
      [`# A${LF}### C${LF}###### F${LF}## B`, 3, [3, 4, 5, 4]],
      // Two headings the model wrote at one depth stay at one level (a cap
      // alone, over the shallowest-depth shift, drew these h4 then h5).
      [`# A${LF}### C${LF}### C2`, 3, [3, 4, 4]],
      // Past h6 the levels stay at h6 rather than skipping back in.
      [`# A${LF}## B${LF}### C${LF}#### D`, 4, [4, 5, 6, 6]],
      // INVERTED (review, 2026-11-18). This case once pinned [5, 3]: the
      // text's first heading, its deepest, drew two levels under the
      // outside heading. The first heading now starts at the base.
      [`### C${LF}# A`, 3, [3, 3]],
      [`### only${LF}# top`, 3, [3, 3]],
      [`- item${LF}  ## In a list`, 4, [4]],
      [`> ### Quoted${LF}${LF}# Top${LF}## Under`, 3, [3, 3, 4]],
    ];
    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const [text, base, want] of cases) {
      const got = levels(text, base);
      expect(got, text).toEqual(want);
      expect(outlineGaps(got, base), text).toEqual([]);
    }
  });

  it("positive control: the property catches a skipped level, a deep first heading and a heading above the base", () => {
    // What the shallowest-depth shift drew for the cases above.
    expect(outlineGaps([4, 6], 4)).toEqual(["h6 after h4"]);
    expect(outlineGaps([5, 3], 3)).toEqual(["h5 after h2"]);
    expect(outlineGaps([2, 3], 3)).toEqual(["h2 outside", "shallowest h2"]);
    expect(outlineGaps([3, 4, 5], 3)).toEqual([]);
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

/**
 * 200 KB in every shape that makes a naive parser quadratic or deep.
 *
 * REPAIRED 2026-11-22 (ci-flake audit 2026-11-19, line 543): `fill("*")`,
 * `fill("_")` and `fill("- ")` were each ONE thematic break — a line made
 * only of `*`, `_` or `- ` is an `hr` before it is anything else — so three
 * members named for the emphasis scanner and for deep lists never reached
 * either, and the health check (count and length) could not tell. A letter
 * in front, or at the end, makes them the paragraph and the list their
 * names promise; {@link reachOf} holds every member to what it is named for.
 */
const PATHOLOGICAL: [string, string][] = [
  ["stars", `x${fill("*")}`],
  ["underscores", `x${fill("_")}`],
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
  ["bullets", `${fill("- ")}x`],
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

/** Plain prose, the same 200 KB: the cost every shape is measured against. */
const PROSE = fill("The lease runs for three years.\n");
/** One time-boxed sample lasts at least this long. */
const SAMPLE_MS = 100;
/**
 * The timeout that fails an unbounded parse (see the "inside the default
 * timeout" test): vitest's 5 s default, written out.
 */
const PARSE_BACKSTOP_MS = 5_000;
const PARSE_TESTS = { timeout: PARSE_BACKSTOP_MS };

interface Reach {
  /** The whole input became one thematic break. */
  loneHr: boolean;
  /** The deepest nesting of strong emphasis. */
  strong: number;
  /** The deepest nesting of lists. */
  lists: number;
}

function reachOf(blocks: Block[]): Reach {
  const strongIn = (nodes: Inline[]): number =>
    Math.max(
      0,
      ...nodes.map((n) =>
        n.t === "text" || n.t === "code"
          ? 0
          : (n.t === "strong" ? 1 : 0) + strongIn(n.c),
      ),
    );
  const walk = (bs: Block[]): { strong: number; lists: number } => {
    let strong = 0;
    let lists = 0;
    for (const b of bs) {
      if (b.t === "h" || b.t === "p") strong = Math.max(strong, strongIn(b.c));
      const inner =
        b.t === "quote"
          ? [walk(b.c)]
          : b.t === "list"
            ? b.items.map(walk).map((r) => ({ ...r, lists: r.lists + 1 }))
            : [];
      for (const r of inner) {
        strong = Math.max(strong, r.strong);
        lists = Math.max(lists, r.lists);
      }
    }
    return { strong, lists };
  };
  return {
    loneHr: blocks.length === 1 && blocks[0]!.t === "hr",
    ...walk(blocks),
  };
}

/** Whether a PATHOLOGICAL member reaches the code its name targets. */
function reaches(name: string, reach: Reach): boolean {
  if (name === "stars" || name === "underscores")
    return reach.strong === MAX_DEPTH;
  if (name === "bullets") return reach.lists === MAX_DEPTH;
  return !reach.loneHr;
}

describe("bounded", () => {
  it("health check: every shape is at least 200 KB", () => {
    expect(PATHOLOGICAL).toHaveLength(21);
    for (const [name, text] of PATHOLOGICAL)
      expect(text.length, name).toBeGreaterThanOrEqual(KB200 - 10);
  });

  it(
    "health check: every shape reaches the code it is named for",
    PARSE_TESTS,
    () => {
      for (const [name, text] of PATHOLOGICAL) {
        const reach = reachOf(parseMarkdown(text));
        expect(reaches(name, reach), `${name} ${JSON.stringify(reach)}`).toBe(
          true,
        );
      }
      // Positive control: the members as they were, one `hr` each, fail it.
      for (const [name, was] of [
        ["stars", fill("*")],
        ["underscores", fill("_")],
        ["bullets", fill("- ")],
      ] as const)
        expect(reaches(name, reachOf(parseMarkdown(was))), name).toBe(false);
    },
  );

  /**
   * WAS: each shape timed once against `took < 1_500` ms, in this test,
   * under a title saying "well under a second" (ci-flake audit 2026-11-19,
   * line 583: 1,219 ms for the whole loop on a CI run, so 1.23x proven).
   * The timing is now its own test below; this one keeps vitest's 5 s
   * default ON PURPOSE: with `CLOSER_TRIES` unbounded, "open strong" alone
   * takes about 7 s on the dev host and more on CI, so the default fails it
   * on every runner, a bound that does not move with the runner's speed the
   * way a measured one does. Do not give this test a longer timeout.
   *
   * Written out (PARSE_BACKSTOP_MS), not left to the default, so a change
   * to the suite's default cannot loosen it unseen. Review 2026-11-22
   * proved it: `CLOSER_TRIES` 4096 (64 honest) fails this test and the
   * health check above with "Test timed out in 5000ms" (10,088 and
   * 11,205 ms on the dev host), while the ratio test below only records.
   * CI maximum 1,219 ms for the loop (44373418087), so 5 s is 4.1x.
   */
  it(
    "each 200 KB shape parses, losing no more than its marks, inside the default timeout",
    () => {
      for (const [name, text] of PATHOLOGICAL) {
        const blocks = parseMarkdown(text);
        expect(blockText(blocks).length, name).toBeLessThanOrEqual(text.length);
      }
    },
    PARSE_BACKSTOP_MS,
  );

  /**
   * The parse's cost shape, against plain prose of the same 200 KB parsed in
   * the same run: each shape's best time per call over one time-boxed
   * sample (at least SAMPLE_MS, so a cheap shape is many calls and a timer
   * tick is noise), divided by the prose's best of three such samples.
   * K = 100 comes from the audit's dev-host figures (repaired stars and
   * underscores about 27x cold; `CLOSER_TRIES` 4096 puts open strong near
   * 131x) and is NOT a CI figure — no CI run has printed one — so both
   * bounds record (measure mode) until the harvest has five CI runs, one of
   * them slow; then the bound is set at 2x the CI maximum or more. Both
   * are on the pending list (src/tests/wall-clock-pending.ts), not
   * witnessed: `reached` (every shape reaches the code it is named for,
   * asserted here so the timing is of the work its name promises) cannot
   * see a cost — `CLOSER_TRIES` 4096 left it true and this test green
   * (witness audit 2026-11-22). What fails on that is the 5 s backstop of
   * the test above; the 30 s timeout here cannot hide it.
   */
  it("each 200 KB shape parses in a bounded multiple of plain prose", () => {
    const sample = (text: string) => {
      let calls = 0;
      let spent = 0;
      let blocks: Block[] = [];
      const t0 = performance.now();
      do {
        blocks = parseMarkdown(text);
        calls += 1;
        spent = performance.now() - t0;
      } while (spent < SAMPLE_MS);
      return { perCall: spent / calls, blocks };
    };
    sample(PROSE.slice(0, 2_000));
    const prose = Math.min(
      sample(PROSE).perCall,
      sample(PROSE).perCall,
      sample(PROSE).perCall,
    );
    for (const [name, text] of PATHOLOGICAL) {
      const { perCall, blocks } = sample(text);
      const reached = reaches(name, reachOf(blocks));
      expect(reached, name).toBe(true);
      expectRatioBelow("ai-markdown-shape-vs-prose", perCall, prose, 100, {
        mode: "measure",
        instance: name,
      });
      expectFasterThan("ai-markdown-shape-ceiling", perCall, 1_500, {
        mode: "measure",
        instance: name,
      });
    }
  }, 30_000);

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

  it("the page buttons are first-load in the chat panel, so they work without the chunk", () => {
    // Review, 2026-11-18: with ChatAnswer lazy, a refused chunk left the
    // plain answer with no buttons. The panel draws PlainCitedAnswer until
    // the chunk arrives (e2e/ai-markdown.spec.ts refuses it and presses one).
    expect(importers("citation-buttons")).toEqual([
      "components/tools/chat-answer.tsx",
      "components/tools/chat-with-pdf-worker-panel.tsx",
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
