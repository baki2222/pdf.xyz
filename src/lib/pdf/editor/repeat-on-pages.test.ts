// @vitest-environment node
/**
 * Audit sign-pdf#6 (2026-11-06): initials on every page of a 30-page
 * contract meant clicking each page, and the copy told people to. A placed
 * signature, initials, name or date can now be repeated on all pages, the
 * last page, or pages typed in the shared page-range syntax, at the same
 * spot on each page.
 *
 * Read back from the exported file: every target page draws the copy.
 */
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from "pdf-lib";
import { exportEditedPdf } from "@/lib/pdf/editor-export";
import { PageRangeError } from "@/lib/pdf/ranges";
import { quickTextObject } from "./quick-fields";
import { DEFAULT_TEXT_STYLE, type EditorObject } from "./model";
import {
  REPEAT_TARGETS,
  REPEAT_TARGET_LABEL,
  canRepeat,
  repeatCopies,
  repeatPages,
} from "./repeat-on-pages";

const frames = [
  { width: 600, height: 800 },
  { width: 600, height: 800 },
  // A smaller page: a copy at the same spot is kept inside it.
  { width: 300, height: 400 },
  { width: 600, height: 800 },
];

const PNG_1x1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

function signature(page = 0): EditorObject {
  return {
    id: "sig",
    kind: "signature",
    page,
    x: 400,
    y: 700,
    width: 120,
    height: 40,
    format: "png",
    bytes: PNG_1x1,
  };
}

describe("repeatPages: which pages a copy goes to", () => {
  it("offers all pages, the last page and custom pages, each labelled", () => {
    expect([...REPEAT_TARGETS]).toEqual(["all", "last", "custom"]);
    for (const t of REPEAT_TARGETS)
      expect(REPEAT_TARGET_LABEL[t].length).toBeGreaterThan(0);
  });

  it("all pages: every page but the one it is on", () => {
    expect(repeatPages("all", "", 4, 1)).toEqual([0, 2, 3]);
  });

  it("last page: the last, and nothing when it is already there", () => {
    expect(repeatPages("last", "", 4, 0)).toEqual([3]);
    expect(repeatPages("last", "", 4, 3)).toEqual([]);
  });

  it("custom pages: the shared range syntax, 1-based, its own page skipped", () => {
    expect(repeatPages("custom", "2-4", 4, 1)).toEqual([2, 3]);
    expect(repeatPages("custom", "1, 3-", 4, 0)).toEqual([2, 3]);
    expect(() => repeatPages("custom", "9", 4, 0)).toThrow(PageRangeError);
    expect(() => repeatPages("custom", "", 4, 0)).toThrow(PageRangeError);
  });
});

describe("repeatCopies", () => {
  it("places a fresh copy at the same spot on each page, kept on the page", () => {
    const copies = repeatCopies([signature()], [1, 2, 3], frames);
    expect(copies.map((c) => c.page)).toEqual([1, 2, 3]);
    expect(new Set(copies.map((c) => c.id)).size).toBe(3);
    expect(copies.some((c) => c.id === "sig")).toBe(false);
    const at = copies.map((c) => [
      (c as { x: number }).x,
      (c as { y: number }).y,
    ]);
    expect(at[0]).toEqual([400, 700]);
    expect(at[2]).toEqual([400, 700]);
    // 300 x 400 page: pulled in so the 120 x 40 box fits.
    expect(at[1]).toEqual([180, 360]);
  });

  it("repeats signatures, initials, names and dates, not fields or text edits", () => {
    expect(canRepeat([signature()])).toBe(true);
    expect(
      canRepeat([
        quickTextObject(
          "q",
          0,
          { x: 10, y: 10 },
          "AL",
          DEFAULT_TEXT_STYLE,
          (t) => t.length * 8,
          frames[0]!,
        ),
      ]),
    ).toBe(true);
    expect(canRepeat([])).toBe(false);
    expect(canRepeat([{ ...signature(), kind: "field" } as never])).toBe(false);
    // Objects on two pages have no single spot to repeat.
    expect(canRepeat([signature(0), { ...signature(1), id: "b" }])).toBe(false);
  });
});

async function xobjectDrawsPerPage(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const xo = page.node
      .Resources()
      ?.lookupMaybe(PDFName.of("XObject"), PDFDict)
      ?.keys()
      .map((k) => k.asString());
    const contents = page.node.get(PDFName.of("Contents"));
    const refs =
      contents instanceof PDFArray
        ? contents.asArray()
        : contents
          ? [contents as PDFRef]
          : [];
    const text = refs
      .map((r) =>
        new TextDecoder("latin1").decode(
          decodePDFRawStream(
            doc.context.lookup(r as PDFRef) as PDFRawStream,
          ).decode(),
        ),
      )
      .join("\n");
    return (xo ?? []).filter((n) => text.includes(`${n} Do`)).length;
  });
}

describe("the exported file", () => {
  it("draws the signature on every page it was repeated on", async () => {
    const src = await PDFDocument.create();
    for (const f of frames) src.addPage([f.width, f.height]);
    const bytes = await src.save();
    const original = signature(0);
    const copies = repeatCopies(
      [original],
      repeatPages("all", "", frames.length, 0),
      frames,
    );
    const out = await exportEditedPdf(bytes, [original, ...copies]);
    expect(await xobjectDrawsPerPage(out.bytes)).toEqual([1, 1, 1, 1]);
    // Control: without the copies only the first page draws it.
    const alone = await exportEditedPdf(bytes, [original]);
    expect(await xobjectDrawsPerPage(alone.bytes)).toEqual([1, 0, 0, 0]);
  });
});

describe("what Sign PDF says about repeating", () => {
  it("the tool page and the guide name Repeat on and each of its choices", async () => {
    const { default: content } = await import("@/lib/tools/content/sign-pdf");
    const { guides } = await import("@/lib/guides/catalog");
    const guide = guides.find((g) => g.slug === "how-to-sign-a-pdf")!;
    const named = new Intl.ListFormat("en", { type: "disjunction" }).format(
      REPEAT_TARGETS.map((t) => REPEAT_TARGET_LABEL[t]),
    );
    const initials = content.useCases.find(
      (u) => u.title === "Initials on every page",
    )!.body;
    expect(initials).toContain(`pick ${named}`);
    expect(initials).toContain("Repeat on");
    expect(guide.steps.join(" ")).toContain(`Repeat on: ${named}`);
    // The Place step names the choices from the same labels (review,
    // 2026-11-08: it was a typed paraphrase).
    const place = content.steps.find((s) => s.body.includes("Repeat on"))!;
    expect(place.body).toContain(`Repeat on (${named})`);
    // Inverted from the shipped copy: "click on each page that needs them".
    expect(initials).not.toMatch(/click on each page/);
  });
});
