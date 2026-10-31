// @vitest-environment node
/**
 * A TOOL PAGE THAT TELLS A READER TO USE A CONTROL NAMES ONE ITS PANEL DRAWS.
 *
 * Every tool page carries authored prose — intro, use cases, "How it works"
 * steps, FAQ answers — that says "press Export DOCX", "Under Permissions, you
 * can untick …", "pick Paragraphs, Bullet points or Section outline". Until
 * 2026-10-31 only the “quoted” ones were checked (tool-page-substance.test.ts,
 * as a substring of the runner's source), and a bare control name was a copy
 * of JSX text that a relabel left behind: summarize-pdf.ts and
 * chat-with-pdf.ts said so in writing ("NOT GUARDED … a relabel … will not
 * fail anything").
 *
 * THE PROPERTY: a control name a tool page tells a reader to use is VISIBLE
 * text the tool's own UI renders. The predicate is the guides' one, shared
 * through `src/tests/ui-labels.ts` (four extraction rules plus `list`, the
 * core ⊑ label ⊑ run boundary rule, sr-only / aria / title text rejected);
 * read its docblock for what each rule and each cost is.
 *
 * THE CORPUS, derived: every tool in the catalogue (`tools`), and for each,
 * every string anywhere in its `toolContent` value — walked, never listed by
 * field, after the content module's template strings ran, so the text is what
 * the page receives (`page-copy.ts` hands these same values to the page). A
 * tool with no content or no panel is FATAL, not skipped.
 *
 * THE UI SIDE, derived the same way the guides' is: the tool's slug → the
 * panel module the page mounts (`ownPanelModules()`) → its value-import
 * closure → what those modules can draw. A sentence that names another tool
 * by its catalogue name may name that tool's controls too ("use OCR PDF
 * first …").
 *
 * WHAT THE FIRST RUN FOUND (2026-10-31), each fixed in the copy:
 *  - pdf-to-word / pdf-to-powerpoint told readers to press "Export"; the
 *    button reads "Export DOCX" / "Export PPTX";
 *  - grayscale-pdf: "press Convert" for "Convert to grayscale";
 *  - remove-pages: "the Delete button" for "Delete 3 pages" (the count is
 *    part of the label);
 *  - overlay-pdf: “Overlay onto” followed by the count, now the whole label;
 *  - ocr-pdf, redact-pdf: "Redo existing OCR" and "Remove text under boxes"
 *    ran into the sentence ("… only when", the trigger word "under") and are
 *    now quoted; protect-pdf's "Permissions" likewise got its comma;
 *  - jpg-to-pdf: "Auto orientation" — the chip is "Auto", under Orientation;
 *  - compress-pdf, pdf-to-pdfa, html-to-pdf, extract-tables: prose the
 *    extractor read as a control ("… and Ghostscript also turns", "Can I
 *    choose PDF/A-1b", "the note says Chromium …", "the ZIP before showing
 *    that button") was reworded so it does not claim to name one.
 * And on the UI side: create-forms' type switch read from `FIELD_TYPE_BUTTON`,
 * a name outside the `…_LABEL(S)` convention, so "Radio" and "List" were on
 * screen and invisible to the guard; renamed `FIELD_TYPE_BUTTON_LABELS`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { toolContent, type ToolContent } from "@/lib/tools/content";
import { ROOT, rel } from "@/tests/tool-panel-modules";
import {
  COMPONENTS,
  RULES,
  auditLabels,
  extractLabels,
  leadingClauses,
  panelFileOf,
  showFinding as show,
  uiOf,
  type Extracted,
  type LabelDocument,
} from "@/tests/ui-labels";

/* ------------------------------------------------------------------ *
 *  Exceptions: listed, each with its reason, each used
 * ------------------------------------------------------------------ */

interface NotOurLabel {
  why: string;
  /**
   * Where the thing named is written, when it is ours but not a label: the
   * file must still contain `text`, or the exception is stale.
   */
  evidence?: { file: string; text: string };
}

/** Phrases a tool page tells a reader to act on that are not UI text. */
const NOT_OUR_LABELS: Readonly<Record<string, NotOurLabel>> = {
  Space: {
    why: "a keyboard key — organize-pages' and rotate-pdf's keyboard steps: press Enter or Space",
  },
  X: {
    why: "an ICON a sighted reader sees, not text: merge-pdf's remove-file button is a lucide <X> glyph (its name, Remove …, is aria-label only)",
    evidence: {
      file: "src/components/tools/runner/merge-runner.tsx",
      text: '<X className="size-4" aria-hidden />',
    },
  },
  "Track Changes": {
    why: "Microsoft Word's review feature, in the reader's editor — pdf-to-word's use case for an exported DOCX",
  },
  "could not be decoded as a PNG image": {
    why: "an engine refusal the panel shows, quoted from the message, not a control — png-to-pdf's FAQ",
    evidence: {
      file: "src/lib/pdf/image-to-pdf.ts",
      text: 'could not be decoded as a ${format === "jpg" ? "JPG" : "PNG"} image.',
    },
  },
};

/**
 * The one exception by SHAPE: a quoted phrase that opens with "-" or "("
 * is a piece of a file name or document title ("-flattened", "(grayscale)"),
 * not a control. Only for `quoted` extractions (a bare word cannot start
 * with either), and only when NO tool's screen draws it: the UI does have
 * strings of that shape ("- 1 -", a page-number style; "(empty)"), and one of
 * those is checked like any other label.
 */
const NAME_FRAGMENT = "⟨file-name fragment⟩";
const everyScreen = leadingClauses(uiOf(tools.map((t) => t.slug)));
const isNameFragment = (x: Extracted): boolean =>
  x.rule === "quoted" && /^[-(]/.test(x.core) && !everyScreen.has(x.core);

const exempt = (x: Extracted): string | null =>
  Object.hasOwn(NOT_OUR_LABELS, x.core)
    ? x.core
    : isNameFragment(x)
      ? NAME_FRAGMENT
      : null;

/* ------------------------------------------------------------------ *
 *  The corpus
 * ------------------------------------------------------------------ */

function contentOf(slug: string): ToolContent {
  const content = toolContent[slug];
  if (!content) throw new Error(`${slug} has no tool-page content`);
  return content;
}

const docs: LabelDocument[] = tools.map((t) => ({
  id: t.slug,
  tools: [t.slug],
  value: contentOf(t.slug),
}));

const audit = (list: readonly LabelDocument[]) => auditLabels(list, exempt);

/** One tool page with only `text` as its prose. */
const only = (slug: string, text: string): LabelDocument => ({
  id: slug,
  tools: [slug],
  value: { steps: [{ title: "", body: text }] },
});
const missingOf = (slug: string, text: string) =>
  audit([only(slug, text)]).missing.map((f) => f.label);
const checkedOf = (slug: string, text: string) =>
  audit([only(slug, text)]).checked.map((f) => f.label);

const CONTENT_DIR =
  path.join(ROOT, "src", "lib", "tools", "content") + path.sep;

describe("every control a tool page tells a reader to use is on its panel", () => {
  const result = audit(docs);

  it("health: the corpus is plausibly large, every rule fires, and is printed", () => {
    // Recorded 2026-10-31 on 54 tool pages: 1908 strings, 378 labels checked
    // (verb=206, quoted=108, chain=36, list=25, button=17), 14 more covered
    // by the exceptions above.
    console.log(
      `tool-page-ui-labels: ${result.checked.length} labels checked in ${result.strings} strings across ${docs.length} tool pages; by rule: ${[
        ...result.byRule,
      ]
        .map(([r, n]) => `${r}=${n}`)
        .join(", ")}`,
    );
    if (process.env.TOOL_UI_LABELS_PRINT)
      console.log(result.checked.map(show).join("\n"));
    expect(docs.length).toBe(tools.length);
    expect(tools.length).toBeGreaterThanOrEqual(50);
    expect(
      result.strings,
      "implausibly few strings — is the walk reading the content?",
    ).toBeGreaterThanOrEqual(1500);
    expect(
      result.checked.length,
      "implausibly few labels extracted — is the extractor broken?",
    ).toBeGreaterThanOrEqual(300);
    // Rule 1, the second direction: every rule catches a real tool-page phrase.
    for (const rule of RULES)
      expect(
        result.byRule.get(rule) ?? 0,
        `rule ${rule} caught nothing`,
      ).toBeGreaterThan(0);
  });

  it("health: every tool page mounts a panel, and its UI set is non-trivial", () => {
    for (const tool of tools) {
      expect(panelFileOf(tool.slug), `${tool.slug}: no panel`).not.toBeNull();
      const ui = uiOf([tool.slug]);
      expect(
        ui.files.filter((f) => f.startsWith(COMPONENTS)).length,
        `${tool.slug}: no component modules reached`,
      ).toBeGreaterThan(5);
      expect(
        ui.exact.size,
        `${tool.slug}: implausibly few strings`,
      ).toBeGreaterThan(100);
    }
  });

  it("health: no tool page's own prose is in any UI scope", () => {
    // A content module in the closure would vouch for itself: summarize-pdf.ts
    // holds LENGTH_LABEL, which the UI side reads as labels.
    expect(result.files.size).toBeGreaterThan(100);
    expect(
      [...result.files].filter((f) => f.startsWith(CONTENT_DIR)).map(rel),
    ).toEqual([]);
  });

  it("every extracted label exists in what the tool's panel renders", () => {
    expect(result.missing.map(show)).toEqual([]);
  });

  it("every exception is still used, and its evidence still holds", () => {
    expect(
      [...Object.keys(NOT_OUR_LABELS), NAME_FRAGMENT].filter(
        (k) => !result.allowUsed.has(k),
      ),
    ).toEqual([]);
    for (const [label, { evidence }] of Object.entries(NOT_OUR_LABELS))
      if (evidence)
        expect(
          readFileSync(path.join(ROOT, evidence.file), "utf8"),
          `${label}: ${evidence.file} no longer holds its evidence`,
        ).toContain(evidence.text);
  });

  it("the name-fragment shape exempts file-name pieces and nothing else", () => {
    const shaped = (core: string, rule: Extracted["rule"] = "quoted") =>
      isNameFragment({ rule, core, run: core });
    expect(shaped("-flattened")).toBe(true);
    expect(shaped("(grayscale)")).toBe(true);
    expect(shaped("Download flattened PDF")).toBe(false);
    expect(shaped("-flattened", "verb")).toBe(false);
    // The shape on screen is a label, not a fragment: page-numbers' "- 1 -".
    expect(everyScreen.has("- 1 -")).toBe(true);
    expect(shaped("- 1 -")).toBe(false);
  });

  it("positive control: an invented control fails, through the same audit", () => {
    expect(missingOf("merge-pdf", "Press Frobnicate PDF to finish.")).toEqual([
      "Frobnicate PDF",
    ]);
    // A tool's NAME is not a control on another tool's page…
    expect(missingOf("merge-pdf", "Press Rotate PDF.")).toEqual(["Rotate PDF"]);
    // …and the label the first run caught fails again if it comes back, as
    // it shipped ("press Export, which …"). Not "press Export to send it":
    // the button is a template, `Export ${output}`, whose hole takes any
    // word, so "Export to" fits it — the permissive direction, said plainly.
    expect(missingOf("pdf-to-word", "Press Export, which uploads it.")).toEqual(
      ["Export"],
    );
  });

  it("negative control: a real label passes, through the same audit", () => {
    expect(checkedOf("pdf-to-word", "Press Export DOCX.")).toEqual([
      "Export DOCX",
    ]);
    expect(missingOf("pdf-to-word", "Press Export DOCX.")).toEqual([]);
  });

  it("the labels the content files' notes say are guarded are checked", () => {
    // summarize-pdf.ts and chat-with-pdf.ts said NOT GUARDED until
    // 2026-10-31; their notes now name what this file checks. A comment is
    // not a guard, so the names are pinned here: a label that stops being
    // extracted makes those notes false, and this fails.
    const labelsOf = (slug: string) =>
      new Set(
        audit(docs.filter((d) => d.id === slug)).checked.map((f) => f.label),
      );
    const summarize = labelsOf("summarize-pdf");
    for (const label of [
      "Add your PDF, or browse",
      "Summarize PDF",
      "Notify me when this ships",
      "Brief — TL;DR + key points",
      "Standard — the main points",
      "Detailed — every major section",
      "Paragraphs",
      "Bullet points",
      "Section outline",
    ])
      expect(summarize, `summarize-pdf: ${label}`).toContain(label);
    expect(labelsOf("chat-with-pdf")).toContain("Ask the PDF");
  });
});

/* ------------------------------------------------------------------ *
 *  What the tool pages added to the shared predicate, each with its
 *  real phrase and a control that it does not wave anything through
 * ------------------------------------------------------------------ */

describe("the shared predicate, on phrases tool pages shipped", () => {
  it("list: “A, B or C” checks every item, and a lone comma checks none", () => {
    expect(
      extractLabels(
        "In Format, pick Paragraphs, Bullet points or Section outline.",
      ).map((x) => [x.rule, x.core]),
    ).toEqual([
      ["verb", "Paragraphs"],
      ["list", "Bullet points"],
      ["chain", "Section outline"],
    ]);
    expect(
      extractLabels("Under Output, pick Searchable PDF").map((x) => x.core),
    ).toEqual(["Output", "Searchable PDF"]);
    expect(
      extractLabels("Press Merge PDF, Ghostscript then runs.").map(
        (x) => x.core,
      ),
    ).toEqual(["Merge PDF"]);
  });

  it("marked: introduces a label only when it is quoted", () => {
    expect(
      extractLabels('Click the box marked "Add your PDF, or browse".').map(
        (x) => x.core,
      ),
    ).toEqual(["Add your PDF, or browse"]);
    expect(extractLabels("marked SAMPLE at low opacity")).toEqual([]);
  });

  it("a template's leading clause is a label; a head with no clause is not", () => {
    // compress-batch.tsx: `Download all (${n})`.
    expect(uiOf(["compress-pdf"]).leads.has("Download all")).toBe(true);
    expect(missingOf("compress-pdf", "press “Download all” for a ZIP")).toEqual(
      [],
    );
    // page-select-runner.tsx: `Delete ${n} page${…}` — "Delete" alone is
    // not what the button says.
    expect(missingOf("remove-pages", "Then press Delete.")).toEqual(["Delete"]);
    expect(missingOf("remove-pages", "Then press “Delete 3 pages”.")).toEqual(
      [],
    );
  });

  it("a spaced em dash ends a clause; the gloss is not part of the name", () => {
    // request-signatures: <option>Parallel — everyone at once</option>
    expect(missingOf("request-signatures", "choose Parallel.")).toEqual([]);
    expect(missingOf("request-signatures", "choose Parallel mode.")).toEqual([
      "Parallel mode",
    ]);
  });

  it("a heading's trailing colon is not part of its name", () => {
    // flatten-runner.tsx: "Left as-is, still interactive:"
    expect(
      missingOf(
        "flatten-pdf",
        'lists them under "Left as-is, still interactive"',
      ),
    ).toEqual([]);
    expect(
      missingOf("flatten-pdf", 'lists them under "Left as-is, still live"'),
    ).toEqual(["Left as-is, still live"]);
  });

  it("a label: initializer is read through its branches", () => {
    // scan-to-pdf.ts: label: id === "fit" ? "Fit to photo" : found.label
    expect(uiOf(["scan-to-pdf"]).exact.has("Fit to photo")).toBe(true);
    expect(missingOf("scan-to-pdf", "pick Fit to photo.")).toEqual([]);
  });

  it("create-forms' type switch is read as labels", () => {
    // FIELD_TYPE_BUTTON_LABELS, renamed from FIELD_TYPE_BUTTON so the
    // `…_LABELS` convention reads it.
    const ui = uiOf(["create-forms"]);
    expect(ui.exact.has("Radio")).toBe(true);
    expect(ui.exact.has("List")).toBe(true);
  });
});
