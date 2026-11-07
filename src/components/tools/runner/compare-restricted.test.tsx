// @vitest-environment jsdom
// @native-canvas
/**
 * Compare PDF on RESTRICTED files (audit compare-pdf#5): PDFs that open
 * without a password but carry their author's restrictions — signed
 * contracts and bank statements, exactly what people compare.
 *
 * Compare never writes a PDF; its text comes from pdf.js, which opens such
 * files. Until 2026-11-08 the card's page count came from pdf-lib, which
 * refuses ANY /Encrypt, so both files were listed under "Some files were
 * skipped" before the comparison could read them. The count now comes from
 * pdf.js too.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { extractPdfText } from "@/lib/pdf/text";
import { getToolBySlug } from "@/lib/tools";
import { pageFaq } from "@/lib/tools/page-copy";
import { withAppRouter } from "@/tests/app-router";
import { PDF_NEEDS_PASSWORD_MESSAGE } from "@/lib/pdf/encryption";
import {
  ASSEMBLE_COPY_FIXTURE,
  NO_ASSEMBLE_COPY_FIXTURE,
  OPEN_PASSWORD_FIXTURE,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { ComparePdfRunner } from "./compare-pdf-runner";

const legacyReader = () => import("pdfjs-dist/legacy/build/pdf.mjs");
const extract = (bytes: Uint8Array) => extractPdfText(bytes, legacyReader);

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

const file = (name: string, fixture: string) =>
  new File([readRestrictedFixture(fixture).slice()], name, {
    type: "application/pdf",
  });

describe("compare-pdf: two PDFs their authors restricted", () => {
  it("both are accepted with their page counts, and compared", async () => {
    render(withAppRouter(<ComparePdfRunner extract={extract} />));
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [
          file("granted.pdf", ASSEMBLE_COPY_FIXTURE.file),
          // Copying withheld too: Compare writes nothing, so nothing of the
          // author's restrictions is lifted by reading it.
          file("withheld.pdf", NO_ASSEMBLE_COPY_FIXTURE.file),
        ],
      },
    });
    await screen.findByText("2/2 selected", undefined, { timeout: 10_000 });
    expect(screen.queryByText(/skipped/i)).toBeNull();
    expect(screen.queryByText(/editing restrictions/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /compare pdfs/i }));
    // Same pages, same text: the two files differ only in their grant.
    expect(
      await screen.findByText(/pages 2 vs 2/, undefined, { timeout: 10_000 }),
    ).toBeInTheDocument();
  }, 30_000);

  // The FAQ's other half: "A PDF that needs a password to open is refused as
  // it is added, listed under Some files were skipped with a note to unlock
  // it first." The count moved from pdf-lib to pdf.js on 2026-11-08, so this
  // is the case the move could break.
  it("a PDF that needs a password to open is skipped as password-protected", async () => {
    render(withAppRouter(<ComparePdfRunner extract={extract} />));
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [
          file("granted.pdf", ASSEMBLE_COPY_FIXTURE.file),
          file("locked.pdf", OPEN_PASSWORD_FIXTURE.file),
        ],
      },
    });
    expect(
      await screen.findByText("Some files were skipped", undefined, {
        timeout: 10_000,
      }),
    ).toBeInTheDocument();
    const row = screen.getByText(/locked\.pdf/).closest("li");
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain(PDF_NEEDS_PASSWORD_MESSAGE);
    await screen.findByText("1/2 selected", undefined, { timeout: 10_000 });
    expect(screen.queryByText("2/2 selected")).toBeNull();
  }, 30_000);

  it("the page says a restricted file is compared, not refused", () => {
    const answers = pageFaq(getToolBySlug("compare-pdf")!).map((f) => f.answer);
    expect(
      answers.some((a) =>
        /opens without a password but whose author restricted it is compared/.test(
          a,
        ),
      ),
    ).toBe(true);
  });
});
