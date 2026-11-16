/**
 * The PDFs Translate's start-up capability probes run on, generated in memory
 * (no file ships for them). ONE drawing module for both probes, so the
 * text-drawing call-site count (`src/deploy/text-drawing-call-sites.test.ts`)
 * does not grow with each probe: `./reading-order-capability` re-exports its
 * old names from here.
 *
 *  - {@link readingOrderProbePdf}: one Letter page with a title and two
 *    columns on the same baselines (`translateReadingOrder`, slice 3).
 *  - {@link pageMapProbePdf}: three Letter pages, one short paragraph each,
 *    each paragraph carrying tokens no other page carries
 *    (`translatePageMap`, slice 4). All three fit in ONE chunk, so the job is
 *    the commonest marked case: a multi-page document with no part clause.
 */
import { PDFDocument } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";

/** The two columns a reader must find one after the other. */
export interface ProbeColumns {
  readonly left: readonly string[];
  readonly right: readonly string[];
}

/** The reading-order probe page's title, printed above both columns. */
export const READING_ORDER_PROBE_TITLE = "Reading Order Probe";

/**
 * The reading-order probe page's columns: each ONE sentence over three
 * printed lines, with tokens no other line carries (A101 and Oslo on the
 * left, B202 and Lima on the right), drawn on the same baselines so `-layout`
 * puts each left line beside its right-hand neighbour. No hyphens: flow keeps
 * a line-end hyphen, and the predicate compares lines joined by a space.
 */
export const READING_ORDER_PROBE_COLUMNS: ProbeColumns = {
  left: [
    "Harbour note A101 says the morning",
    "ferry from the northern quay sails",
    "at nine every weekday towards Oslo.",
  ],
  right: [
    "Market note B202 says the river",
    "stalls beside the old station open",
    "at noon each Sunday for guests from Lima.",
  ],
};

/** The reading-order probe's PDF: one Letter page. */
export async function readingOrderProbePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const { left, right } = READING_ORDER_PROBE_COLUMNS;
  const font = await embedDrawingFont(doc, [
    READING_ORDER_PROBE_TITLE,
    ...left,
    ...right,
  ]);
  const page = doc.addPage([612, 792]);
  page.drawText(READING_ORDER_PROBE_TITLE, { x: 50, y: 740, size: 18, font });
  left.forEach((line, i) =>
    page.drawText(line, { x: 50, y: 690 - i * 14, size: 11, font }),
  );
  right.forEach((line, i) =>
    page.drawText(line, { x: 320, y: 690 - i * 14, size: 11, font }),
  );
  return doc.save();
}

/** One page of the page-map probe: its paragraph and the tokens only it holds. */
export interface PageMapProbePage {
  readonly text: string;
  readonly tokens: readonly string[];
}

/**
 * The page-map probe's three pages. Each paragraph is one printed line (no
 * wrap, so no reader can split a token), ASCII only, and none holds "pdfxyz"
 * (the collision rule would send the chunk unmarked) or a line a heading
 * predicate could mistake for "Page N". Every token occurs on exactly one
 * page, so "P2's tokens sit under Page 2" is decidable from the text alone.
 */
export const PAGE_MAP_PROBE_PAGES: readonly PageMapProbePage[] = [
  {
    text: "Alder grove note P1-Alder says the river ferry leaves at seven.",
    tokens: ["P1-Alder", "ferry"],
  },
  {
    text: "Birch lane note P2-Birch says the covered market opens at nine.",
    tokens: ["P2-Birch", "market"],
  },
  {
    text: "Cedar hill note P3-Cedar says the public library closes at five.",
    tokens: ["P3-Cedar", "library"],
  },
];

/** The page-map probe's PDF: three Letter pages, one paragraph each. */
export async function pageMapProbePdf(
  pages: readonly PageMapProbePage[] = PAGE_MAP_PROBE_PAGES,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(
    doc,
    pages.map((p) => p.text),
  );
  for (const { text } of pages)
    doc.addPage([612, 792]).drawText(text, { x: 50, y: 700, size: 11, font });
  return doc.save();
}
