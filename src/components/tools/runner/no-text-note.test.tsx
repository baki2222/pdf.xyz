// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import { withoutComments } from "@/lib/tools/copy-surface";
import { NO_ADJUST, NO_OUTPUT, ResultPanel } from "./runner-kit";
import {
  NoSelectableTextNote,
  OCR_TOOL_HREF,
  OCR_TOOL_NAME,
} from "./no-text-note";

/**
 * PDF to Text and PDF to Markdown answered a scanned PDF with a GREEN success
 * panel and a plain-text hint to "Use OCR PDF when OCR is enabled" — no link,
 * and a hedge that suggested OCR might not exist while production OCR was
 * live. This renders what the user receives.
 */
afterEach(cleanup);

describe("the no-text outcome has a way forward", () => {
  it("links to the OCR tool, which exists and outputs the TXT the note promises", () => {
    render(<NoSelectableTextNote />);
    const link = screen.getByRole("link", { name: `Open ${OCR_TOOL_NAME}` });
    expect(link.getAttribute("href")).toBe(OCR_TOOL_HREF);
    const tool = getToolBySlug(OCR_TOOL_HREF.replace(/^\/tools\//, ""));
    expect(tool?.name).toBe(OCR_TOOL_NAME);
    expect(tool?.outputs).toContain("TXT");
    expect(screen.getByText(/output TXT/)).toBeTruthy();
  });

  it("a warn-toned panel does not read as success; the default still does", () => {
    const { container, unmount } = render(
      <ResultPanel
        title="No selectable text found"
        tone="warn"
        onReset={() => {}}
        output={NO_OUTPUT("no text")}
        onAdjust={NO_ADJUST("no settings")}
      >
        <span />
      </ResultPanel>,
    );
    expect(
      container.querySelector("[data-tone]")?.getAttribute("data-tone"),
    ).toBe("warn");
    unmount();
    const ok = render(
      <ResultPanel
        title="Text extracted"
        onReset={() => {}}
        output={NO_OUTPUT("a fixture")}
        onAdjust={NO_ADJUST("no settings")}
      >
        <span />
      </ResultPanel>,
    );
    expect(
      ok.container.querySelector("[data-tone]")?.getAttribute("data-tone"),
    ).toBe("ok");
  });
});

describe("every no-text branch uses the note and the warn tone", () => {
  const DIR = path.join(process.cwd(), "src", "components", "tools", "runner");

  /*
   * THE PROPERTY, not one spelling of it: a real link to OCR PDF, and a
   * panel that is not green. It asked for `<NoSelectableTextNote` and a
   * `tone={… "warn" …}` literal until the merge with L11 (05b2f6c), whose
   * Compare PDF says which of the two files needs OCR, links OCR PDF from
   * that sentence (`href={OCR_TOOL_HREF}` — the note's own constant) and
   * picks its tone per verdict from a table (`tone: "warn"`). A second note
   * would put a second OCR link, and "This PDF has no selectable text", in a
   * panel about two PDFs.
   */
  function problems(source: string): string[] {
    const out: string[] = [];
    if (
      !/<NoSelectableTextNote\b/.test(source) &&
      !/href=\{OCR_TOOL_HREF\}/.test(source)
    )
      out.push("no NoSelectableTextNote");
    if (
      !/tone=\{[^}]*"warn"[^}]*\}/.test(source) &&
      !/\btone:\s*"warn"/.test(source)
    )
      out.push("no warn tone");
    return out;
  }

  it("discovered: the runners that can report 'No selectable text found'", () => {
    const runners = readdirSync(DIR)
      .filter((f) => /\.tsx$/.test(f) && !f.includes(".test."))
      .map((f) => ({
        file: f,
        source: withoutComments(readFileSync(path.join(DIR, f), "utf8")),
      }))
      .filter((r) => r.source.includes("No selectable text found"));
    // PDF to Text, PDF to Markdown and Compare PDF today (Compare was found
    // by this walk: the first version named only the two runners it was about).
    expect(runners.length).toBeGreaterThanOrEqual(3);
    const offenders = runners
      .map((r) => [r.file, problems(r.source)] as const)
      .filter(([, p]) => p.length > 0);
    expect(offenders).toEqual([]);
  });

  it("positive control: the branch that shipped is flagged twice", () => {
    const shipped = `<ResultPanel title="No selectable text found" onReset={onReset}>
      <p>This PDF does not contain selectable text. Use OCR PDF when OCR is enabled.</p>
    </ResultPanel>`;
    expect(problems(shipped)).toEqual([
      "no NoSelectableTextNote",
      "no warn tone",
    ]);
  });

  it("control: the per-verdict spelling passes, and a neutral one does not", () => {
    // Compare PDF's shape: a link on OCR_TOOL_HREF and a tone table.
    const table = `const t = { "no-text": { title: "x", tone: "warn" } };
      <Link href={OCR_TOOL_HREF}>OCR PDF</Link>`;
    expect(problems(table)).toEqual([]);
    // What L11 shipped before the merge gave it a warn tone to use.
    expect(problems(table.replace('"warn"', '"neutral"'))).toEqual([
      "no warn tone",
    ]);
    // A link to some other tool is not a way to OCR.
    expect(
      problems(table.replace("OCR_TOOL_HREF", "UNLOCK_TOOL_HREF")),
    ).toEqual(["no NoSelectableTextNote"]);
  });
});
