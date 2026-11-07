import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import annotate from "@/lib/tools/content/annotate-pdf";
import editPdf from "@/lib/tools/content/edit-pdf";
import { flattenForPhraseSearch } from "@/lib/tools/copy-surface";
import { TOOL_BUTTONS, TOOL_GROUPS } from "./toolbar";

/**
 * Every place that lists Annotate PDF's Mark up group names the whole group.
 *
 * WHAT SHIPPED. Redact joined the group on 2026-10-24 (MARKUP_KINDS in
 * offered-kinds). The derived tool fact counted five mark-up tools from that
 * day, while the authored intro, the "Mark up the page" step and the runner's
 * first-step line went on naming four — "Whiteout, Draw and Note are beside
 * it" — until 2026-11-01. Each sentence was true when written; the group
 * grew underneath them.
 *
 * The labels come from the toolbar's own group, so a tool added to it is a
 * label every listing must name, and a renamed button moves the check too.
 */
const markUp = TOOL_GROUPS.find((group) => group.name === "Mark up");
const labels = (markUp?.tools ?? []).map(
  (tool) => TOOL_BUTTONS.find((button) => button.tool === tool)?.label ?? tool,
);

const runnerSource = flattenForPhraseSearch(
  readFileSync(
    path.join(process.cwd(), "src/components/tools/runner/annotate-runner.tsx"),
    "utf8",
  ),
);
const firstStep = /firstStep=\{(.*?)\}\s*emptyReason=/.exec(runnerSource)?.[1];
const markUpStep = annotate.steps.find((s) => s.title === "Mark up the page");

const LISTINGS: Record<string, string | undefined> = {
  "the intro's toolbar sentence": annotate.intro[0],
  'the "Mark up the page" step': markUpStep?.body,
  "the runner's first-step line": firstStep,
};

const unnamed = (text: string): string[] =>
  labels.filter((label) => !new RegExp(`\\b${label}\\b`).test(text));

describe("Annotate PDF names its whole Mark up group", () => {
  it("health: the group and every listing were found", () => {
    expect(markUp, 'no "Mark up" group in TOOL_GROUPS').toBeDefined();
    // Nine today (Whiteout, Redact, Highlight, Underline, Strikethrough,
    // Draw, Highlighter, Note, Comment); fewer than four
    // means the lookup broke, not that the group shrank.
    expect(labels.length).toBeGreaterThanOrEqual(4);
    expect(labels).toContain("Highlight");
    for (const [where, text] of Object.entries(LISTINGS)) {
      expect(text, `${where} not found`).toBeTruthy();
    }
  });

  it.each(Object.keys(LISTINGS))("%s names every Mark up tool", (where) => {
    expect(unnamed(LISTINGS[where]!)).toEqual([]);
  });

  it("CONTROL: a listing that drops a tool is caught, by name", () => {
    const intro = LISTINGS["the intro's toolbar sentence"]!;
    expect(unnamed(intro.replace(/\bRedact\b/g, "Erase"))).toEqual(["Redact"]);
    // The shipped first step, verbatim from before 2026-11-01. Until
    // 2026-11-08 it missed only Redact; Underline and Strikethrough joined
    // the group that day (audit annotate-pdf#2), and Comment (audit
    // annotate-pdf#4) and Highlighter (#5); it misses them too.
    expect(
      unnamed(
        "Highlight is ready — drag across the page where it goes. Whiteout, Draw and Note are beside it in the toolbar.",
      ),
    ).toEqual([
      "Redact",
      "Underline",
      "Strikethrough",
      "Highlighter",
      "Comment",
    ]);
  });
});

/**
 * Edit PDF mounts the same editor, so the same Mark up group is in its
 * toolbar (review of 62aa1808/ab344f36, 2026-11-08: Highlighter and Comment
 * reached Edit PDF's toolbar and none of its listings). The step and the
 * source docblock name controls by their labels; the intro lists what you
 * can add as nouns ("freehand drawing", "notes"), so it is read for each
 * label as the start of a word, in any case.
 */
const editSource = flattenForPhraseSearch(
  readFileSync(
    path.join(process.cwd(), "src/lib/tools/content/edit-pdf.ts"),
    "utf8",
  ).replace(/^\s*\*\s?/gm, " "),
);
const editDocblock =
  /Control names are the toolbar's \(`TOOL_BUTTONS`[^:]*:(.*?)\) and the run/.exec(
    editSource,
  )?.[1];
const editStep = editPdf.steps.find(
  (s) => s.title === "Pick a tool and click on the page",
);

const EDIT_LISTINGS: Record<string, string | undefined> = {
  'Edit PDF\'s "Pick a tool and click on the page" step': editStep?.body,
  "Edit PDF's docblock list of control names": editDocblock,
};

const unnamedAsNoun = (text: string): string[] =>
  labels.filter((label) => !new RegExp(`\\b${label}`, "i").test(text));

describe("Edit PDF names the whole Mark up group too", () => {
  it("health: every Edit PDF listing was found", () => {
    for (const [where, text] of Object.entries(EDIT_LISTINGS))
      expect(text, `${where} not found`).toBeTruthy();
    expect(editPdf.intro[0]).toBeTruthy();
  });

  it.each(Object.keys(EDIT_LISTINGS))(
    "%s names every Mark up tool",
    (where) => {
      expect(unnamed(EDIT_LISTINGS[where]!)).toEqual([]);
    },
  );

  it("the intro's list of what you can add names every Mark up tool", () => {
    expect(unnamedAsNoun(editPdf.intro[0]!)).toEqual([]);
  });

  it("CONTROL: the intro and step as shipped before this review miss Highlighter, Comment (and the intro, Redact)", () => {
    expect(
      unnamedAsNoun(
        "Edit PDF shows every page of your PDF and lets you add to it by clicking on the page: text boxes, rectangles, ellipses, lines and arrows, whiteout boxes, highlights, underlines and strikethroughs that follow the words you select, freehand drawing and notes.",
      ),
    ).toEqual(["Redact", "Highlighter", "Comment"]);
    expect(
      unnamed(
        "Rectangle, Ellipse, Line, Arrow, Whiteout and Redact draw where you drag. Highlight, Underline and Strikethrough follow the words you drag across. Draw follows your pointer. Text and Note place a box you type into.",
      ),
    ).toEqual(["Highlighter", "Comment"]);
  });
});
