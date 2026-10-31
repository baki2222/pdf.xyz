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
 * THE PREDICATE lives in `src/tests/ui-labels.ts` (moved there 2026-10-31,
 * when tool pages got the same guard in
 * `src/lib/tools/tool-page-ui-labels.test.ts`): the four extraction rules,
 * the core ⊑ label ⊑ run boundary rule, the derived UI side, what counts as
 * visible, and what all of it costs. This file owns the GUIDE corpus — every
 * string in every `Guide` value, scoped to `guide.tools` — its exceptions,
 * and its controls. `GUIDE_UI_LABELS_PRINT=1` prints every extraction and
 * what it matched.
 */
import { describe, expect, it } from "vitest";
import { guides } from "./catalog";
import type { Guide } from "./types";
import { rel } from "@/tests/tool-panel-modules";
import {
  COMPONENTS,
  RULES,
  auditLabels,
  extractLabels,
  showFinding as show,
  uiOf,
} from "@/tests/ui-labels";

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

const audit = (list: readonly Guide[]) =>
  auditLabels(
    list.map((g) => ({ id: g.slug, tools: g.tools, value: g })),
    (x) => (Object.hasOwn(NOT_OUR_LABELS, x.core) ? x.core : null),
  );

describe("every control a guide tells a reader to act on is on its tools' screens", () => {
  const result = audit(guides);

  it("health: the corpus is plausibly large, every rule fires, and is printed", () => {
    // Recorded 2026-10-30 on 36 guides — see the PR for the full corpus.
    // 2026-10-31, 39 guides: 207 checked (quoted=33, verb=162, chain=17,
    // button=1); the screen-reader rule failed one ("press Remove", a
    // tooltip-only X button), rewritten.
    // 2026-10-31, 42 guides, with the tool pages' additions to the shared
    // predicate (the list rule, template and em-dash clauses): 258 checked
    // (quoted=51, verb=185, chain=21, list=6, button=1); the list rule's
    // first run caught "Fit to photo", a label the UI side could not read.
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
    for (const rule of RULES)
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
