/**
 * The most pages Text to PDF lays out for one text (hostile matrix CI-11,
 * 2026-11-08), as a LEAF so the engine and the tool copy read one number.
 *
 * Only the 2 MB byte cap applied before, and a page costs far less than a
 * page of text: a form feed is ONE byte a page, a blank line one byte a line.
 * "x" + form feed, repeated to the cap, is 1,048,576 pages, laid out and
 * drawn on the main thread at 1 to 1.4 ms a page (measured to 16,000
 * pages), so the tab would freeze for an extrapolated quarter of an hour or
 * more, or run out of memory first. The layout now stops at the first
 * page over this ceiling, before anything is drawn.
 *
 * Why 5,000. The cap is 2 MB. Measured through the real layout (Courier,
 * US Letter): 2 MB of ordinary prose is 672 pages (7.4 times under the
 * ceiling); 2 MB of a log of short 20-byte lines is 2,497 pages (2.0 times
 * under). Only text made mostly of line breaks or page breaks reaches 5,000
 * pages, and the ceiling itself converted in 8.3 s on the development
 * machine (a child process, start-up included; 2026-11-08), where the
 * uncapped flood was extrapolated to over 15 minutes.
 * conversion-in-l09.test.ts converts the ceiling inside a bound and holds
 * both page counts above to the real layout.
 */
export const MAX_TEXT_PAGES = 5_000;

/** The refusal, said before anything is drawn. */
export const TOO_MANY_TEXT_PAGES = `This text would make more than ${MAX_TEXT_PAGES.toLocaleString("en-US")} pages, the most one PDF can have here. Split it into smaller files first.`;
