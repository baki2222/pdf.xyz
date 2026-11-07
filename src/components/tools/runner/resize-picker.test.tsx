// @vitest-environment jsdom
// @native-canvas
/**
 * Audit resize-pdf#6 (2026-11-06): Resize PDF's "Selected pages" took a typed
 * list only, and nothing showed which pages were which size — while the page
 * promotes "Making mixed page sizes match", where the odd-sized pages are
 * exactly what a person needs to see.
 *
 * Selected pages now draws the pages, each labelled with its size (a named
 * paper size when it is one), and a press toggles a page and rewrites the
 * list. Judged on the download: the pages pressed are resized, the others
 * keep their size.
 *
 * Not done here, and said in the report: a preview of the resized page.
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
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { RESIZE_MODES, RESIZE_SIZES } from "@/lib/pdf/resize";
import { fromPoints } from "@/lib/pdf/length-units";
import { ResizeEditor } from "./resize-runner";
import { pageSizeCaption } from "./resize-page-sizes";

const A4 = RESIZE_SIZES.find((s) => s.id === "a4")!;
const LETTER = RESIZE_SIZES.find((s) => s.id === "letter")!;
/** A4, US Letter turned, and a size with no name. */
const SIZES: [number, number][] = [
  [A4.size.width, A4.size.height],
  [LETTER.size.height, LETTER.size.width],
  [400, 300],
];

let downloads: Blob[] = [];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  downloads = [];
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) downloads.push(obj);
    return `blob:resize-picker/${downloads.length}`;
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetAnnouncer();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

async function mount() {
  const doc = await PDFDocument.create();
  for (const size of SIZES) doc.addPage(size);
  const bytes = await doc.save();
  render(
    <ResizeEditor
      pdf={{
        file: new File([new Uint8Array(bytes)], "mixed.pdf", {
          type: "application/pdf",
        }),
        bytes,
        pageCount: SIZES.length,
        rotations: SIZES.map(() => 0 as const),
        digitalSignatures: countDigitalSignatures(bytes),
      }}
      onReset={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("radio", { name: "Selected pages" }));
}

const tile = (n: number) =>
  screen.findByRole(
    "button",
    { name: new RegExp(`^Page ${n}\\b`) },
    { timeout: 10_000 },
  );

describe("pageSizeCaption", () => {
  it("names a paper size either way round, and measures one with no name", () => {
    expect(pageSizeCaption(A4.size.width, A4.size.height)).toBe(A4.label);
    expect(pageSizeCaption(LETTER.size.height, LETTER.size.width)).toBe(
      `${LETTER.label} landscape`,
    );
    expect(pageSizeCaption(400, 300)).toBe(
      `${fromPoints(400, "mm")} × ${fromPoints(300, "mm")} mm`,
    );
  });
});

describe("Resize PDF · pick the pages, each labelled with its size", () => {
  it("each page says its size, so the odd one out shows", async () => {
    await mount();
    expect((await tile(1)).getAttribute("aria-label")).toBe(
      `Page 1, ${A4.label}`,
    );
    expect((await tile(2)).getAttribute("aria-label")).toBe(
      `Page 2, ${LETTER.label} landscape`,
    );
    expect((await tile(3)).getAttribute("aria-label")).toBe(
      `Page 3, ${pageSizeCaption(400, 300)}`,
    );
  }, 30_000);

  it("a press writes the list; Even pages picks 2, 4, …", async () => {
    await mount();
    const box = screen.getByRole("textbox", { name: "Pages" });
    fireEvent.click(await tile(3));
    expect(box).toHaveValue("3");
    fireEvent.click(screen.getByRole("button", { name: /^even pages$/i }));
    expect(box).toHaveValue("2");
    fireEvent.change(box, { target: { value: "1, 3" } });
    expect(await tile(1)).toHaveAttribute("aria-pressed", "true");
    expect(await tile(2)).toHaveAttribute("aria-pressed", "false");
  }, 30_000);

  it("resizes the pages pressed and leaves the others their size", async () => {
    await mount();
    // "Change canvas only": fit's content wrap builds its stream with a
    // TextEncoder from Node's realm, which pdf-lib under jsdom does not take
    // for a Uint8Array (an environment seam; resize.test.ts proves fit). The
    // page choice under test is the same for both modes.
    fireEvent.click(
      screen.getByRole("radio", {
        name: RESIZE_MODES.find((m) => m.id === "canvas")!.label,
      }),
    );
    fireEvent.click(await tile(3));
    fireEvent.click(screen.getByRole("button", { name: /^resize pdf$/i }));
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: /download resized pdf/i },
        { timeout: 10_000 },
      ),
    );
    await waitFor(() => expect(downloads).toHaveLength(1));
    const out = await PDFDocument.load(
      new Uint8Array(await downloads[0]!.arrayBuffer()),
    );
    const sizes = out
      .getPages()
      .map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
    expect(sizes[0]).toEqual(SIZES[0]!.map(Math.round));
    expect(sizes[1]).toEqual(SIZES[1]!.map(Math.round));
    // Page 3 is landscape; "Match each page" turns A4 to match it.
    expect(sizes[2]).toEqual([
      Math.round(A4.size.height),
      Math.round(A4.size.width),
    ]);
  }, 30_000);
});

describe("Resize PDF · the page says what Selected pages does", () => {
  it("names the thumbnails and their size labels, with a caption the code draws", async () => {
    const { default: content } = await import("@/lib/tools/content/resize-pdf");
    const all = [
      ...content.steps.map((s) => s.body),
      ...content.useCases.map((u) => u.body),
    ].join(" ");
    expect(all).toMatch(/each labelled with its size/);
    // The example caption is one the code produces, not a typed guess.
    expect(all).toContain(
      `such as ${A4.label} or ${pageSizeCaption(400, 300)}`,
    );
  });
});
