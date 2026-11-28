// @vitest-environment node
// @native-canvas
/**
 * Find and Detect past {@link MAX_FOUND} (audit redact-pdf#4).
 *
 * Both stop listing at MAX_FOUND (500) and, since 1e7a3230, say so. But
 * nothing reached the matches after it: pressing Detect again listed the
 * same first 500, so a records export with 1,200 addresses could only ever
 * have its first 500 redacted. Each search now hands back where it stopped
 * (`next`), and a search started `from` there lists the next ones, so every
 * match is reachable in steps of MAX_FOUND.
 *
 * The witness is a count: 1,200 distinct addresses in the fixture, 1,200
 * distinct matches across the steps, none twice, in page order.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  MAX_FOUND,
  detectPersonalData,
  findTextMatches,
  readRedactText,
  type FoundText,
  type RedactTextIndex,
} from "./redact-find";
import type { PdfTextReader } from "./text";

const legacy: PdfTextReader = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Awaited<
    ReturnType<PdfTextReader>
  >;

const PER_PAGE = 40;

/** `count` distinct addresses, PER_PAGE to a page. */
async function emailsPdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let start = 0; start < count; start += PER_PAGE) {
    const page = doc.addPage([595, 842]);
    for (let i = start; i < Math.min(count, start + PER_PAGE); i++)
      page.drawText(`person${i}@mail.test`, {
        x: 56,
        y: 800 - (i - start) * 19,
        size: 11,
        font,
      });
  }
  return doc.save();
}

type Search = (
  index: RedactTextIndex,
  from?: { page: number; offset: number },
) => {
  matches: FoundText[];
  capped: boolean;
  next?: { page: number; offset: number };
};

/** Every step of a search, each started where the last stopped. */
function allSteps(index: RedactTextIndex, search: Search) {
  const steps: FoundText[][] = [];
  let from: { page: number; offset: number } | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const step = search(index, from);
    steps.push(step.matches);
    expect(step.capped).toBe(step.next !== undefined);
    if (!step.next) return steps;
    from = step.next;
  }
  throw new Error("the search never finished");
}

const detect: Search = (index, from) =>
  detectPersonalData(index, ["email"], from);
const find: Search = (index, from) =>
  findTextMatches(
    index,
    "@mail.test",
    { matchCase: false, wholeWord: false },
    from,
  );

describe.each([
  ["Detect", detect],
  ["Find", find],
] as const)("%s past the cap", (_name, search) => {
  it("reaches every one of 1,200 addresses in steps of the cap, none twice, in page order", async () => {
    const index = await readRedactText(await emailsPdf(1200), legacy);
    expect(index.pageCount).toBe(30);
    const steps = allSteps(index, search);
    expect(steps.map((s) => s.length)).toEqual([MAX_FOUND, MAX_FOUND, 200]);
    const all = steps.flat();
    expect(new Set(all.map((m) => m.key)).size).toBe(1200);
    // Page order, across the steps.
    const pages = all.map((m) => m.page);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
    expect(all[0]!.page).toBe(1);
    expect(all[all.length - 1]!.page).toBe(30);
    if (search === detect)
      expect(new Set(all.map((m) => m.text)).size).toBe(1200);
  });

  it("control: below the cap there is one step and nothing after it", async () => {
    const index = await readRedactText(await emailsPdf(300), legacy);
    const first = search(index);
    expect(first.matches).toHaveLength(300);
    expect(first.capped).toBe(false);
    expect(first.next).toBeUndefined();
  });

  it("the first step is what the search listed before (500, capped)", async () => {
    const index = await readRedactText(await emailsPdf(600), legacy);
    const first = search(index);
    expect(first.matches).toHaveLength(MAX_FOUND);
    expect(first.capped).toBe(true);
    // Stopped on page 13 (40 a page: 500 is 12 full pages and 20 more).
    expect(first.next!.page).toBe(13);
    expect(first.matches[first.matches.length - 1]!.page).toBe(13);
  });
});
