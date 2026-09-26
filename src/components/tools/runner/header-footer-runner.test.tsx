// @vitest-environment jsdom
/**
 * The header/footer runner, in a browser whose locale writes dates in a script
 * pdf.xyz cannot draw.
 *
 * Found 2026-09 (audit): the runner filled `{date}` with
 * `new Date().toLocaleDateString()`. In `ar-EG` that is "٢٧/٩/٢٠٢٦" (with
 * U+200F marks), in `fa-IR` "۱۴۰۵/۷/۵". The preview pill showed it; Run then
 * refused the whole job for "Arabic" text the user never typed, and the only
 * way out was deleting `{date}`. `src/lib/pdf/header-footer.test.ts` holds
 * the engine half over ICU's whole locale list; this file holds the CHAIN —
 * the runner's own button, the real engine, the downloaded bytes — because the
 * defect lived in the runner, above every engine test.
 *
 * The browser's default locale is emulated at the two places a page can read
 * it without naming one: `Intl.DateTimeFormat` and `Date#toLocaleDateString`.
 * The health check proves the emulation took before anything relies on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { readAsViewer } from "@/tests/pdfjs-viewer";
import { HeaderFooterEditor } from "./header-footer-runner";
import type { LoadedPdf } from "./use-single-pdf";

const NOW = new Date(2026, 8, 27, 12, 0, 0);

const RealDateTimeFormat = Intl.DateTimeFormat;
const realToLocaleDateString = Date.prototype.toLocaleDateString;
const realCreateObjectURL = URL.createObjectURL;

/** Make `locale` the page's default, as a browser in that language would. */
function emulateDefaultLocale(locale: string) {
  function DateTimeFormat(
    locales?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ) {
    return new RealDateTimeFormat(locales ?? locale, options);
  }
  DateTimeFormat.supportedLocalesOf = RealDateTimeFormat.supportedLocalesOf;
  Intl.DateTimeFormat = DateTimeFormat as unknown as typeof Intl.DateTimeFormat;
  Date.prototype.toLocaleDateString = function (
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    return realToLocaleDateString.call(this, locales ?? locale, options);
  };
}

let downloaded: Blob | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  downloaded = null;
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    downloaded = blob as Blob;
    return "blob:download";
  };
  URL.revokeObjectURL ??= () => undefined;
  // The bytes are captured above; jsdom cannot follow the download link.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.useRealTimers();
  Intl.DateTimeFormat = RealDateTimeFormat;
  Date.prototype.toLocaleDateString = realToLocaleDateString;
  URL.createObjectURL = realCreateObjectURL;
  vi.restoreAllMocks();
});

async function loadedPdf(): Promise<LoadedPdf> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const bytes = await doc.save();
  return {
    file: new File([Buffer.from(bytes)], "input.pdf", {
      type: "application/pdf",
    }),
    bytes,
    pageCount: 1,
    rotations: [0],
  };
}

/** The locales whose own date no face we ship can draw. */
const REFUSED_LOCALES = ["ar-EG", "fa-IR"];

describe("header-footer runner: {date} in a locale we cannot draw", () => {
  for (const locale of REFUSED_LOCALES) {
    it(`${locale}: previews and stamps a date the reader can see`, async () => {
      emulateDefaultLocale(locale);
      // HEALTH CHECK: the emulation took — the old code path would now read
      // this locale's non-Latin digits.
      expect(new Date().toLocaleDateString()).not.toMatch(/^[0-9/]+$/);
      expect(new Intl.DateTimeFormat().resolvedOptions().locale).toBe(locale);

      render(<HeaderFooterEditor pdf={await loadedPdf()} onReset={() => {}} />);
      fireEvent.change(screen.getByLabelText("Footer text"), {
        target: { value: "Printed {date}" },
      });

      // The preview settles on a date written in Latin digits.
      const pill = await waitFor(() => {
        const found = screen.getByText(/^Printed /);
        expect(found.textContent).toMatch(/^Printed [0-9]/);
        return found;
      });
      const previewed = pill.textContent!;

      fireEvent.click(screen.getByRole("button", { name: /add header/i }));
      await screen.findByRole(
        "heading",
        { name: /header & footer added/i },
        { timeout: 5000 },
      );
      expect(screen.queryByRole("alert")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
      expect(downloaded, "the download button produced no file").not.toBeNull();
      const bytes = new Uint8Array(await downloaded!.arrayBuffer());
      const [page] = await readAsViewer(bytes);
      // What the reader sees is what the preview promised.
      expect(page!.runs.map((r) => r.str).join(" ")).toContain(previewed);
    });
  }
});
