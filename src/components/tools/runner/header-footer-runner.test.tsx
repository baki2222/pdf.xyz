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
  within,
} from "@testing-library/react";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { readAsViewer } from "@/tests/pdfjs-viewer";
import { HeaderFooterEditor } from "./header-footer-runner";
import type { LoadedPdf } from "./use-single-pdf";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { recallOptions, rememberOptions } from "@/lib/intent/option-memory";

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
  window.localStorage.clear();
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
      fireEvent.change(screen.getByLabelText("Footer center"), {
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
    fireEvent.change(screen.getByLabelText("Header center"), {
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

  // Was "starts on a later page and counts from First number", though it
  // never set First number: dropping `startAt` from the Run call kept it
  // green (review of audit header-footer#2, 2026-11-07). Each page setting
  // now has a test that fails when its own line leaves the Run call.
  it("starts on a later page, which counts as First number", async () => {
    render(<HeaderFooterEditor pdf={await loadedPdf(3)} onReset={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^pages/i }));
    fireEvent.change(screen.getByLabelText("Start on page"), {
      target: { value: "2" },
    });
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(await runAndRead()).toEqual(["", "Page 1 of 2", "Page 2 of 2"]);
  });

  it("counts {n} and {total} from First number", async () => {
    render(<HeaderFooterEditor pdf={await loadedPdf(3)} onReset={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^pages/i }));
    fireEvent.change(screen.getByLabelText("First number"), {
      target: { value: "5" },
    });
    expect(screen.getByText("Page 5 of 7")).toBeTruthy();
    expect(await runAndRead()).toEqual([
      "Page 5 of 7",
      "Page 6 of 7",
      "Page 7 of 7",
    ]);
  });

  it("leaves the last pages bare and out of {total}", async () => {
    render(<HeaderFooterEditor pdf={await loadedPdf(3)} onReset={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^pages/i }));
    fireEvent.change(screen.getByLabelText("Skip last pages"), {
      target: { value: "1" },
    });
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(await runAndRead()).toEqual(["Page 1 of 2", "Page 2 of 2", ""]);
    expect(screen.getByText(/applied to 2 of 3 pages/i)).toBeTruthy();
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

/**
 * Audit header-footer#3 (2026-11-06): the engine takes left, center and right
 * slots per band, but the runner sent `{ [align]: text }` — one slot per band
 * — so "Acme Ltd" at the left beside a date at the right could not be made.
 * The chain: six fields, the real engine, the downloaded page's positions.
 */
describe("header-footer runner: left, center and right in one band", () => {
  it("offers three fields per band, the footer's page count in the center", async () => {
    render(<HeaderFooterEditor pdf={await loadedPdf()} onReset={() => {}} />);
    for (const band of ["Header", "Footer"])
      for (const slot of ["left", "center", "right"])
        expect(screen.getByLabelText(`${band} ${slot}`)).toBeTruthy();
    expect(
      (screen.getByLabelText("Footer center") as HTMLInputElement).value,
    ).toBe("Page {n} of {total}");
  });

  it("stamps text at the left and the right of the same band", async () => {
    render(<HeaderFooterEditor pdf={await loadedPdf(2)} onReset={() => {}} />);
    fireEvent.change(screen.getByLabelText("Header left"), {
      target: { value: "Acme Ltd" },
    });
    fireEvent.change(screen.getByLabelText("Header right"), {
      target: { value: "Draft 3" },
    });
    fireEvent.change(screen.getByLabelText("Footer left"), {
      target: { value: "Confidential" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add header/i }));
    await screen.findByRole("heading", { name: /header & footer added/i });
    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    const pages = await readAsViewer(
      new Uint8Array(await downloaded!.arrayBuffer()),
    );
    expect(pages).toHaveLength(2);
    for (const [i, page] of pages.entries()) {
      const at = (s: string) => {
        const run = page.runs.find((r) => r.str === s);
        expect(run, `page ${i + 1} has no "${s}"`).toBeTruthy();
        return run!;
      };
      expect(at("Acme Ltd").x).toBeLessThan(at("Draft 3").x);
      expect(at("Confidential").x).toBeLessThan(at(`Page ${i + 1} of 2`).x);
    }
  });

  it("starts the default footer in the box a one-box footer last used", async () => {
    rememberOptions("header-footer", { footerAlign: "right" });
    render(<HeaderFooterEditor pdf={await loadedPdf()} onReset={() => {}} />);
    expect(
      (screen.getByLabelText("Footer right") as HTMLInputElement).value,
    ).toBe("Page {n} of {total}");
    expect(
      (screen.getByLabelText("Footer center") as HTMLInputElement).value,
    ).toBe("");
    // Moved to the left and run: the left box is what is kept.
    fireEvent.change(screen.getByLabelText("Footer right"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Footer left"), {
      target: { value: "{n}" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add header/i }));
    await screen.findByRole("heading", { name: /header & footer added/i });
    expect(recallOptions("header-footer")).toEqual({ footerAlign: "left" });
  });

  it("inserts a field into the box last used in that band", async () => {
    render(<HeaderFooterEditor pdf={await loadedPdf()} onReset={() => {}} />);
    const right = screen.getByLabelText("Header right") as HTMLInputElement;
    fireEvent.focus(right);
    fireEvent.click(
      screen.getByRole("button", { name: "Insert {date} into Header right" }),
    );
    expect(right.value).toBe("{date}");
    expect(
      (screen.getByLabelText("Header center") as HTMLInputElement).value,
    ).toBe("");
  });

  // Review of audit header-footer#3 (2026-11-07): the field buttons were
  // named only "{n}", "{total}" and "{date}" — the same in both bands — while
  // the box they fill is whichever was last focused, named only by a visible
  // span the buttons were not tied to. A screen-reader user could not tell
  // where a field would land. They were about 20px tall on a phone.
  it("names the box each field button fills, in its group and its own name", async () => {
    render(<HeaderFooterEditor pdf={await loadedPdf()} onReset={() => {}} />);
    const groupOf = (name: string) => screen.getByRole("group", { name });
    for (const band of ["Header", "Footer"]) {
      const group = groupOf(`Insert into ${band} center`);
      for (const token of ["{n}", "{total}", "{date}"])
        expect(
          within(group).getByRole("button", {
            name: `Insert ${token} into ${band} center`,
          }).textContent,
        ).toBe(token);
    }
    fireEvent.focus(screen.getByLabelText("Footer left"));
    const left = within(groupOf("Insert into Footer left"));
    const button = left.getByRole("button", {
      name: "Insert {n} into Footer left",
    });
    // The header's group still names its own box.
    expect(groupOf("Insert into Header center")).toBeTruthy();
    // At least 44px tall on a phone; compact from the sm breakpoint.
    expect(button.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["min-h-11", "sm:min-h-0"]),
    );
  });
});

/**
 * Audit header-footer#4 (2026-11-06): the engine took a size, a margin and an
 * ink the runner never set, and the FAQ said "No" to changing them. The chain:
 * the runner's own controls, the real engine, the downloaded file.
 */
describe("header-footer runner: size, margin, font and color", () => {
  async function drawnWith(bytes: Uint8Array) {
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    const fonts = page.node
      .Resources()
      ?.lookupMaybe(PDFName.of("Font"), PDFDict);
    const baseFonts = (fonts?.keys() ?? []).map((key) =>
      String(fonts!.lookup(key, PDFDict).get(PDFName.of("BaseFont"))),
    );
    const contents = doc.context.lookup(page.node.get(PDFName.of("Contents")));
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    const ops = streams
      .filter((x): x is PDFRawStream => x instanceof PDFRawStream)
      .map((x) => {
        const raw = Buffer.from(x.getContents());
        return (
          x.dict.get(PDFName.of("Filter")) ? inflateSync(raw) : raw
        ).toString("latin1");
      })
      .join(" ");
    return { baseFonts, ops };
  }

  it("draws the size, margin, typeface and colour picked", async () => {
    render(<HeaderFooterEditor pdf={await loadedPdf()} onReset={() => {}} />);
    fireEvent.change(screen.getByLabelText("Footer center"), {
      target: { value: "FOOTMARK" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /size, margin, font and color/i }),
    );
    fireEvent.change(screen.getByLabelText("Font size"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Large" }));
    fireEvent.click(screen.getByRole("radio", { name: "Times" }));
    fireEvent.change(screen.getByLabelText("Color"), {
      target: { value: "#cc0000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add header/i }));
    await screen.findByRole("heading", { name: /header & footer added/i });
    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    const bytes = new Uint8Array(await downloaded!.arrayBuffer());
    const { baseFonts, ops } = await drawnWith(bytes);
    expect(baseFonts).toEqual(["/Times-Roman"]);
    expect(ops).toMatch(/(^|\s)0\.8 0 0 rg(\s|$)/);
    expect(ops).toMatch(/(^|\s)20 Tf(\s|$)/);
    const [page] = await readAsViewer(bytes);
    const run = page!.runs.find((r) => r.str === "FOOTMARK")!;
    // Large is 60 pt from the bottom edge of the 792 pt page.
    expect(792 - run.y).toBeCloseTo(60, 0);
  });

  it("control: untouched, the run draws what it always did", async () => {
    render(<HeaderFooterEditor pdf={await loadedPdf()} onReset={() => {}} />);
    fireEvent.change(screen.getByLabelText("Footer center"), {
      target: { value: "FOOTMARK" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add header/i }));
    await screen.findByRole("heading", { name: /header & footer added/i });
    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    const bytes = new Uint8Array(await downloaded!.arrayBuffer());
    const { baseFonts, ops } = await drawnWith(bytes);
    expect(baseFonts).toEqual(["/Helvetica"]);
    expect(ops).toMatch(/(^|\s)10 Tf(\s|$)/);
    const [page] = await readAsViewer(bytes);
    const run = page!.runs.find((r) => r.str === "FOOTMARK")!;
    expect(792 - run.y).toBeCloseTo(32, 0);
  });
});
