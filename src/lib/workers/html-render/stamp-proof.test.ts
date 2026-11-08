// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFString, type PDFRef } from "pdf-lib";
import { stampText } from "./stamp";
import { outlineTitles, stampProofVerdict } from "./stamp-proof";

const URL_ = "https://pdf.xyz/guides/how-to-merge-pdf-files";
const H1 = "How to merge PDF files";
const AT = new Date("2026-11-08T14:03:27Z");
const WINDOW = {
  from: new Date("2026-11-08T14:02:10Z"),
  to: new Date("2026-11-08T14:05:00Z"),
};
const want = { url: URL_, visible: H1, window: WINDOW };

/** A PDF with `pages` pages and, if given, a two-level outline of `titles`. */
async function pdfWithOutline(
  pages: number,
  titles: string[] = [],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  if (titles.length > 0) {
    const { context } = doc;
    const root = context.obj({ Type: "Outlines" });
    const outlines = context.register(root);
    const refs: PDFRef[] = titles.map(() => context.nextRef());
    titles.forEach((title, i) => {
      context.assign(
        refs[i]!,
        context.obj({
          Title: PDFString.of(title),
          Parent: i === 0 ? outlines : refs[0]!,
          // The first item is the h1; the rest are its children.
          ...(i === 0 && refs.length > 1
            ? { First: refs[1]!, Last: refs.at(-1)! }
            : {}),
          ...(i > 0 && i < refs.length - 1 ? { Next: refs[i + 1]! } : {}),
        }),
      );
    });
    root.set(PDFName.of("First"), refs[0]!);
    doc.catalog.set(PDFName.of("Outlines"), outlines);
  }
  return doc.save();
}

/** Page texts as Chromium prints a stamped guide: the body, then the footer line. */
function stampedTexts(pages: number, at = AT, url = URL_): string[] {
  return Array.from(
    { length: pages },
    (_, i) =>
      `${i === 0 ? `${H1} ` : ""}body text of page ${i + 1} ${stampText(url, at)}`,
  );
}

describe("stampProofVerdict", () => {
  it("POSITIVE CONTROL: every page stamped by the worker's own stampText, the h1 bookmarked", async () => {
    const v = await stampProofVerdict(
      await pdfWithOutline(3, [H1, "Step one", "FAQ"]),
      stampedTexts(3),
      want,
    );
    expect(v.detail).toMatch(/every page stamped/);
    expect(v.ok).toBe(true);
  });

  it("reads a footer the extractor split at the ligature and spaces", async () => {
    const texts = stampedTexts(2).map((t) =>
      t.replace(/fi/g, "ﬁ").replace("Captured from", "Captured  from"),
    );
    const v = await stampProofVerdict(
      await pdfWithOutline(2, [H1]),
      texts,
      want,
    );
    expect(v.ok).toBe(true);
  });

  it("NEGATIVE CONTROL (the defect): an older worker ignores stamp — no footer, no bookmarks", async () => {
    const texts = ["How to merge PDF files body", "more body"];
    const v = await stampProofVerdict(await pdfWithOutline(2), texts, want);
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/carry no "Captured from/);
    expect(v.detail).toMatch(/0 bookmark/);
  });

  it("NEGATIVE: stamped on the first page only", async () => {
    const texts = stampedTexts(3);
    texts[1] = "body text of page 2";
    const v = await stampProofVerdict(
      await pdfWithOutline(3, [H1]),
      texts,
      want,
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/page\(s\) 2 carry no/);
  });

  it("NEGATIVE: another address, or a time outside the run", async () => {
    const pdf = await pdfWithOutline(1, [H1]);
    expect(
      (
        await stampProofVerdict(
          pdf,
          stampedTexts(1, AT, "https://pdf.xyz/guides/other"),
          want,
        )
      ).ok,
    ).toBe(false);
    const stale = await stampProofVerdict(
      pdf,
      stampedTexts(1, new Date("2026-11-07T14:03:00Z")),
      want,
    );
    expect(stale.ok).toBe(false);
    expect(stale.detail).toMatch(/outside the run/);
  });

  it("the stamp's minute may precede the window's start within that minute", async () => {
    const v = await stampProofVerdict(
      await pdfWithOutline(1, [H1]),
      stampedTexts(1, new Date("2026-11-08T14:02:00Z")),
      want,
    );
    expect(v.ok).toBe(true);
  });

  it("NEGATIVE: stamped, but the bookmarks are not the page's headings", async () => {
    const v = await stampProofVerdict(
      await pdfWithOutline(1, ["Something else"]),
      stampedTexts(1),
      want,
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/no bookmark is the page's heading/);
  });

  it("HEALTH: no pages, the page's own text missing, and a non-PDF all fail", async () => {
    const pdf = await pdfWithOutline(1, [H1]);
    expect((await stampProofVerdict(pdf, [], want)).ok).toBe(false);
    const blank = await stampProofVerdict(
      pdf,
      [stampText(URL_, AT)], // a footer on an otherwise blank render
      want,
    );
    expect(blank.ok).toBe(false);
    expect(blank.detail).toMatch(/page's own text/);
    expect(
      (
        await stampProofVerdict(
          new TextEncoder().encode("no"),
          stampedTexts(1),
          want,
        )
      ).ok,
    ).toBe(false);
  });

  it("outlineTitles walks children and siblings", async () => {
    expect(
      await outlineTitles(await pdfWithOutline(1, [H1, "A", "B"])),
    ).toEqual(expect.arrayContaining([H1, "A", "B"]));
  });
});
