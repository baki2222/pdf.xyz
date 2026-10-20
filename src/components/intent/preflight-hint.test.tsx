// @vitest-environment jsdom
/**
 * The preflight hint as a reader meets it (redesign C.2, E.9): a note in the
 * file's header whose button opens the tool its sentence names — carrying
 * the file only when that tool can take it, and saying so only then.
 *
 *  - `hintCarries` is the label's verdict and `handoffPayload` is the
 *    launch's: held equal over EVERY tool in the catalogue, so the button
 *    cannot say "with this file" for a launch that would open the tool empty;
 *  - the FileHeader draws the hint for the tool its page is (the tool-run
 *    context) and only from a probe the file opened with;
 *  - the button really launches: Fill Forms receives the file, under a
 *    `hint` origin, and the router goes there.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { handoffPayload } from "@/lib/handoff";
import { takeCarriedHandoff } from "@/lib/handoff/carry";
import type { PdfProbe } from "@/lib/pdf/probe-result";
import { getAllToolSlugs } from "@/lib/tools";
import { FileHeader } from "@/components/tools/runner/single-pdf-runner";
import { ToolRunProvider } from "@/components/tools/runner/tool-context";
import { PDFDocument } from "pdf-lib";
import { SinglePdfRunner } from "@/components/tools/runner/single-pdf-runner";
import { hintCarries, PreflightHint } from "./preflight-hint";
import {
  loadPreflightHint,
  loadedPreflightHint,
  resetPreflightHintForTests,
} from "./preflight-hint-chunk";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const pdfFile = (name = "annex.pdf") =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, {
    type: "application/pdf",
  });

const probe = (over: Partial<PdfProbe> = {}): PdfProbe => ({
  read: "ok",
  lock: "none",
  pages: 3,
  formFields: 0,
  sample: ["text", "text", "text"],
  ...over,
});
const SCAN = probe({ sample: ["image-only", "image-only", "image-only"] });
const FORM = probe({ formFields: 4 });

function routed(ui: React.ReactElement) {
  const router = {
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };
  render(
    <AppRouterContext.Provider value={router as never}>
      {ui}
    </AppRouterContext.Provider>,
  );
  return router;
}

describe("the label's verdict is the launch's", () => {
  it("over every tool: 'with this file' exactly when the launch would carry it", () => {
    const slugs = getAllToolSlugs();
    expect(slugs.length).toBeGreaterThan(40);
    const file = pdfFile();
    let carrying = 0;
    for (const slug of slugs) {
      const launch = handoffPayload(slug, [file]).length > 0;
      expect(hintCarries(slug, file), slug).toBe(launch);
      if (launch) carrying += 1;
    }
    // Health: both answers occur, so neither side is constant.
    expect(carrying).toBeGreaterThan(0);
    expect(carrying).toBeLessThan(slugs.length);
  });
});

describe("PreflightHint", () => {
  it("a form in Sign PDF: a note whose button carries the file to Fill Forms", async () => {
    const router = routed(
      <PreflightHint slug="sign-pdf" probe={FORM} file={pdfFile()} />,
    );
    const note = screen.getByRole("note");
    expect(note.textContent).toContain(
      "This PDF has 4 fillable fields — Fill Forms keeps them fillable",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open Fill Forms with this file" }),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/tools/fill-forms"),
    );
    // The carry the next page will claim is addressed to that tool.
    expect(takeCarriedHandoff("/tools/fill-forms")).not.toBeNull();
  });

  it("a scan in PDF to Text: OCR PDF cannot take the file yet, and the note says where it goes", () => {
    routed(<PreflightHint slug="pdf-to-text" probe={SCAN} file={pdfFile()} />);
    const note = screen.getByRole("note");
    expect(note.textContent).toContain(
      "No selectable text on pages 1–3 — OCR PDF makes it searchable first",
    );
    const button = screen.getByRole("button", { name: /^Open OCR PDF/ });
    // Today the target takes no hand-off: the label must not promise one.
    expect(button.textContent).toBe(
      hintCarries("ocr-pdf", pdfFile())
        ? "Open OCR PDF with this file"
        : "Open OCR PDF",
    );
    if (!hintCarries("ocr-pdf", pdfFile()))
      expect(note.textContent).toMatch(
        /uploads to the secure worker only when/,
      );
  });

  it("nothing for a file without the fact", () => {
    routed(<PreflightHint slug="sign-pdf" probe={probe()} file={pdfFile()} />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("FileHeader draws the hint for the page's own tool", () => {
  beforeAll(loadPreflightHint);
  const tool = (slug: string) => ({
    slug,
    name: slug,
    category: "edit" as never,
  });
  const header = (slug: string, p: PdfProbe | null | undefined) =>
    routed(
      <ToolRunProvider tool={tool(slug)} plan={{ targets: [] }}>
        <FileHeader
          pdf={{
            file: pdfFile(),
            pageCount: 3,
            ...(p !== undefined ? { probe: p } : {}),
          }}
        />
      </ToolRunProvider>,
    );

  it("in Edit PDF, a form's hint sits inside the header", () => {
    header("edit-pdf", FORM);
    const note = screen.getByRole("note");
    expect(note.closest("[data-file-header]")).not.toBeNull();
  });

  it("not for a tool with no hint row, nor for a file opened without a probe", () => {
    header("rotate-pdf", FORM);
    expect(screen.queryByRole("note")).toBeNull();
    cleanup();
    header("edit-pdf", undefined);
    expect(screen.queryByRole("note")).toBeNull();
    cleanup();
    header("edit-pdf", null);
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("the composed chain: a form opened in a hinted tool", () => {
  it("is probed as it opens, and its header carries the hint in the SAME update that draws it", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const field = doc.getForm().createTextField("who");
    field.addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
    const bytes = await doc.save();
    // As a fresh page: the hint's module has not been fetched.
    resetPreflightHintForTests();
    expect(loadedPreflightHint()).toBeNull();
    // Record, at every commit, whether the header was drawn without its hint.
    const seen: string[] = [];
    function Editor({ pdf }: { pdf: Parameters<typeof FileHeader>[0]["pdf"] }) {
      seen.push(pdf.probe === undefined ? "no-probe" : "probed");
      return <FileHeader pdf={pdf} />;
    }
    routed(
      <ToolRunProvider
        tool={{ slug: "edit-pdf", name: "Edit PDF", category: "edit" as never }}
        plan={{ targets: [] }}
      >
        <SinglePdfRunner toolName="Edit PDF">
          {(pdf) => <Editor pdf={pdf} />}
        </SinglePdfRunner>
      </ToolRunProvider>,
    );
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array(bytes)], "form.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    await screen.findByText("form.pdf");
    // Synchronously: the editor's first update already holds the hint.
    expect(screen.getByRole("note").textContent).toContain(
      "This PDF has 1 fillable field",
    );
    expect(seen).not.toContain("no-probe");
    expect(seen.length).toBeGreaterThan(0);
  });
});
