/**
 * `translateSelectionSentence` (audit #29 slice 6): "You chose" names the
 * pages the person CHOSE, never the window's clipped `pagesSent`, and what
 * the window read is a separate clause (review 2026-11-17). Before that fix
 * a truncated job of pages 2 to 9 said "You chose pages 2-6": the person's
 * own choice, misreported to them in README.txt and translation.md.
 *
 * Non-ASCII built from code points (house rule).
 */
import { describe, expect, it } from "vitest";
import type { PageSpan } from "@/lib/pdf/page-spans";
import { translateSelectionSentence } from "./translate-pages";

const EN = String.fromCharCode(0x2013);
const TAIL = "No other page was sent to the AI model.";

const window = (
  pagesSent: PageSpan[] | undefined,
  truncated: boolean,
  totalPages = 40,
) => ({ totalPages, truncated, ...(pagesSent ? { pagesSent } : {}) });

describe("translateSelectionSentence", () => {
  it("an untruncated selection names the choice", () => {
    expect(translateSelectionSentence(window([[2, 9]], false), [[2, 9]])).toBe(
      `You chose pages 2${EN}9 of 40. ${TAIL}`,
    );
  });

  it("a truncated selection names the CHOSEN pages, then where the window stopped", () => {
    // `pagesSent` is clipped at page 6 (the last page that started before
    // the cut); the person chose 2 to 9, and is told so.
    expect(translateSelectionSentence(window([[2, 6]], true), [[2, 9]])).toBe(
      `You chose pages 2${EN}9 of 40; this translation reached page 6. ${TAIL}`,
    );
  });

  it("a truncated window over non-consecutive spans clips at the last span read", () => {
    expect(
      translateSelectionSentence(
        window(
          [
            [2, 2],
            [5, 7],
          ],
          true,
        ),
        [
          [2, 2],
          [5, 8],
          [11, 11],
        ],
      ),
    ).toBe(
      `You chose pages 2, 5${EN}8 and 11 of 40; this translation reached page 7. ${TAIL}`,
    );
  });

  it("a cut inside the LAST chosen page adds no reach clause (the truncation notice says mid-page)", () => {
    expect(translateSelectionSentence(window([[2, 9]], true), [[2, 9]])).toBe(
      `You chose pages 2${EN}9 of 40. ${TAIL}`,
    );
  });

  it("an echo the choice does not confirm says nothing, never 'No other page was sent'", () => {
    // A filter that did nothing echoes the whole document.
    expect(translateSelectionSentence(window([[1, 40]], false), [[2, 9]])).toBe(
      "",
    );
    expect(translateSelectionSentence(window([[3, 9]], false), [[2, 9]])).toBe(
      "",
    );
  });

  it("no recorded choice (a resumed panel): an untruncated window is the choice", () => {
    expect(translateSelectionSentence(window([[2, 9]], false))).toBe(
      `You chose pages 2${EN}9 of 40. ${TAIL}`,
    );
  });

  it("no recorded choice and a truncated window: only what was read, never 'You chose'", () => {
    expect(translateSelectionSentence(window([[2, 6]], true), null)).toBe(
      `This translation read pages 2${EN}6 of 40. ${TAIL}`,
    );
  });

  it("a whole-document job says nothing", () => {
    expect(translateSelectionSentence(window(undefined, false))).toBe("");
    expect(translateSelectionSentence(window(undefined, true), [[2, 9]])).toBe(
      "",
    );
  });
});
