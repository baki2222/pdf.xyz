// @vitest-environment jsdom
/**
 * The shell a page draws before its sheet's code arrives IS the sheet: the
 * same boxes, classes and words, so the live sheet replaces it without
 * moving a pixel, and the one drop primitive stays one (`drop-surface.test`
 * allows a file input in the shell for exactly this reason).
 *
 * Both are rendered as the server renders them and compared node by node:
 * tag, every attribute but the ones that are a render's own (an `id`, the
 * `for` and `aria-describedby` that point at one — compared as present or
 * not), and text. The live sheet's hidden input behind `pick()` is its own
 * (hidden, never laid out). Then the same for the guide desk, whose shell
 * is what every guide serves.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { GuideDesk } from "@/components/intent/guide-desk";
import { GuideDeskShell } from "@/components/intent/guide-desk-shell";
import { DropSheet } from "./drop-sheet";
import { DropSheetShell } from "./drop-sheet-shell";

/**
 * A render's own, not its look: ids and what points at them, which surface
 * it is, and whether it is registered as the page's target (no style reads
 * `data-page-drop-target`; the shell is never one — a file released before
 * the live sheet is here is the drop layer's).
 */
const OWN = new Set([
  "id",
  "for",
  "data-drop-sheet-shell",
  "data-page-drop-target",
]);
const POINTERS = new Set(["aria-describedby"]);

/** A render, as nested [tag, attributes, children] — what a person would see laid out. */
function shape(element: ReactElement): unknown {
  const doc = new DOMParser().parseFromString(
    `<body>${renderToStaticMarkup(element)}</body>`,
    "text/html",
  );
  const walk = (node: Node): unknown => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof Element)) return null;
    const attributes = [...node.attributes]
      .filter((a) => !OWN.has(a.name))
      .map((a) => [a.name, POINTERS.has(a.name) ? "→" : a.value])
      .sort();
    const children = [...node.childNodes]
      .filter(
        (child) => !(child instanceof Element && child.hasAttribute("hidden")),
      )
      .map(walk)
      .filter((child) => child !== null && child !== "");
    return [node.tagName.toLowerCase(), attributes, children];
  };
  return [...doc.body.childNodes].map(walk);
}

const SHEET = {
  accept: ".pdf,application/pdf",
  title: "Drop your PDFs to open Merge PDF with them, or",
  hint: "Accepts PDF · Max 100 MB per file",
  className: "w-full",
};

describe("a drop sheet's shell is the sheet", () => {
  it("no style reads what the comparison leaves out", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    // Health: the stylesheet was read, and it does style the sheet.
    expect(css).toContain("crop-marks");
    // As an attribute selector (`[id…]`, `[data-…]`): a word in a comment
    // or a property is not one.
    const selector = (name: string) =>
      new RegExp(String.raw`\[${name}[\]=~^$*|]`);
    for (const name of OWN) expect(css, name).not.toMatch(selector(name));
    // Positive control: the pattern finds a selector the stylesheet has.
    expect(css).toMatch(selector("data-live"));
  });

  it("compact and sheet faces: the same markup as the live sheet's server render", () => {
    for (const variant of ["compact", "sheet"] as const) {
      for (const multiple of [true, false]) {
        expect(
          shape(
            <DropSheetShell
              {...SHEET}
              variant={variant}
              multiple={multiple}
              hintId="h"
            />,
          ),
          `${variant}, multiple=${multiple}`,
        ).toEqual(
          shape(
            <DropSheet
              {...SHEET}
              variant={variant}
              multiple={multiple}
              onFiles={() => {}}
            />,
          ),
        );
      }
    }
  });

  it("positive control: a different face, a different word or a missing hint is told apart", () => {
    const live = shape(
      <DropSheet {...SHEET} variant="compact" multiple onFiles={() => {}} />,
    );
    expect(
      shape(<DropSheetShell {...SHEET} variant="sheet" multiple hintId="h" />),
    ).not.toEqual(live);
    expect(
      shape(
        <DropSheetShell
          {...SHEET}
          title="Drop a PDF, or"
          variant="compact"
          multiple
          hintId="h"
        />,
      ),
    ).not.toEqual(live);
    expect(
      shape(
        <DropSheetShell
          {...SHEET}
          hint={undefined}
          variant="compact"
          multiple
          hintId="h"
        />,
      ),
    ).not.toEqual(live);
  });

  it("the guide desk's shell is the guide desk, for a tool that opens files and one that opens none", () => {
    for (const opens of ["many", "one", null] as const) {
      const props = {
        tool: { slug: "merge-pdf", name: "Merge PDF" },
        opens,
        noun: { one: "a PDF", many: "PDFs" },
        accept: SHEET.accept,
        hint: SHEET.hint,
      };
      const shell = shape(<GuideDeskShell {...props} />);
      expect(shell, `opens=${opens}`).toEqual(shape(<GuideDesk {...props} />));
      // Health: the comparison saw the sheet, its picker and the slot.
      expect(JSON.stringify(shell)).toContain('"file"');
      expect(JSON.stringify(shell)).toContain("guide-desk-status");
    }
  });
});
