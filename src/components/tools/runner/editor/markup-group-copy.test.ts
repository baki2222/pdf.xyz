import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import annotate from "@/lib/tools/content/annotate-pdf";
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
    // Five today (Whiteout, Redact, Highlight, Draw, Note); fewer than four
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
    // The shipped first step, verbatim from before 2026-11-01.
    expect(
      unnamed(
        "Highlight is ready — drag across the page where it goes. Whiteout, Draw and Note are beside it in the toolbar.",
      ),
    ).toEqual(["Redact"]);
  });
});
