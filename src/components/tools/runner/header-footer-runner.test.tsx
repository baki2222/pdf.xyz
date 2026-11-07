// @vitest-environment jsdom
// @native-canvas
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
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";

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

async function loadedPdf(pages = 1): Promise<LoadedPdf> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([612, 792]);
  const bytes = await doc.save();
  return {
    file: new File([Buffer.from(bytes)], "input.pdf", {
      type: "application/pdf",
    }),
    bytes,
    pageCount: pages,
    rotations: Array.from({ length: pages }, () => 0),
    digitalSignatures: countDigitalSignatures(bytes),
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
      // Either outcome settles within the wait; a refusal is reported by its
      // own text rather than as a bare timeout.
      await waitFor(
        () => {
          const alert = screen.queryByRole("alert");
          if (alert) throw new Error(`Run was refused: ${alert.textContent}`);
          screen.getByRole("heading", { name: /header & footer added/i });
        },
        { timeout: 3000 },
      );

      fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
      expect(downloaded, "the download button produced no file").not.toBeNull();
      const bytes = new Uint8Array(await downloaded!.arrayBuffer());
      const [page] = await readAsViewer(bytes);
      // What the reader sees is what the preview promised.
      expect(page!.runs.map((r) => r.str).join(" ")).toContain(previewed);
    });
  }
});

/**
 * Audit #27 (2026-11-06), the chain: the engine refuses a line wider than the
 * page, and the runner — which has no font-size control — must show that
 * refusal, not the "added" panel over a clipped file.
 */
describe("header-footer runner: a header too wide for the page", () => {
  const NOTICE =
    "CONFIDENTIAL - This document contains proprietary information of Acme Corporation Ltd and must not be copied, disclosed or distributed to third parties";

  it("is refused on screen with how much of it fits, and no file is offered", async () => {
    render(<HeaderFooterEditor pdf={await loadedPdf()} onReset={() => {}} />);
    fireEvent.change(screen.getByLabelText("Header text"), {
      target: { value: NOTICE },
    });
    fireEvent.click(screen.getByRole("button", { name: /add header/i }));
    const alert = await screen.findByRole("alert", undefined, {
      timeout: 3000,
    });
    expect(alert.textContent).toMatch(
      /too wide for page 1.*room for [0-9]+ of its 151 characters/,
    );
    expect(
      screen.queryByRole("heading", { name: /header & footer added/i }),
    ).toBeNull();
  });
});

/** Run the editor as it stands and return each downloaded page's text. */
async function runAndRead(): Promise<string[]> {
  fireEvent.click(screen.getByRole("button", { name: /add header/i }));
  await waitFor(
    () => {
      const alert = screen.queryByRole("alert");
      if (alert) throw new Error(`Run was refused: ${alert.textContent}`);
      screen.getByRole("heading", { name: /header & footer added/i });
    },
    { timeout: 3000 },
  );
  fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
  expect(downloaded, "the download button produced no file").not.toBeNull();
  const bytes = new Uint8Array(await downloaded!.arrayBuffer());
  return (await readAsViewer(bytes)).map((p) =>
    p.runs.map((r) => r.str).join(" "),
  );
}

/**
 * Audit header-footer#2 (2026-11-06): no page options at all — the FAQ
 * answered "Can I leave the header off the cover page?" with "Not here". The
 * chain: the runner's own controls, the real engine, the downloaded pages.
 */
describe("header-footer runner: page settings", () => {
  it("leaves the cover blank while still counting it", async () => {
    render(<HeaderFooterEditor pdf={await loadedPdf(3)} onReset={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^pages/i }));
    fireEvent.click(screen.getByLabelText(/leave the cover page blank/i));
    // The preview shows the first page that gets the footer.
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    expect(await runAndRead()).toEqual(["", "Page 2 of 3", "Page 3 of 3"]);
    expect(screen.getByText(/applied to 2 of 3 pages/i)).toBeTruthy();
  });

  it("starts on a later page and counts from First number", async () => {
    render(<HeaderFooterEditor pdf={await loadedPdf(3)} onReset={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^pages/i }));
    fireEvent.change(screen.getByLabelText("Start on page"), {
      target: { value: "2" },
    });
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(await runAndRead()).toEqual(["", "Page 1 of 2", "Page 2 of 2"]);
  });

  it("will not run when the settings leave no page", async () => {
    render(<HeaderFooterEditor pdf={await loadedPdf(2)} onReset={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^pages/i }));
    fireEvent.change(screen.getByLabelText("Start on page"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Skip last pages"), {
      target: { value: "1" },
    });
    const run = screen.getByRole("button", { name: /add header/i });
    // RunButton stays focusable and says why (aria-disabled, never disabled).
    expect(run.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/no page gets the header or footer/i)).toBeTruthy();
  });
});
