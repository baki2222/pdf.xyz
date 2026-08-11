// @vitest-environment node
/**
 * The page number in the disclosure has to be RIGHT.
 *
 * "Only pages 1–131 could be read" is a sentence a user acts on — they go and
 * check page 140 themselves. An off-by-one here is a new confident wrong claim
 * replacing the old one, which is worse than the number being absent. So the
 * boundaries get pinned: cut exactly on a page start, cut one character in,
 * cut inside page one, and no truncation at all.
 */
import { describe, expect, it } from "vitest";
import {
  describeWindow,
  modelTruncationNotice,
  pageStartsFor,
  userTruncationNotice,
} from "./truncation";

/**
 * Three pages of 10 characters each, joined by a 2-character separator — with
 * a GAP in the numbering. Page 4 is blank in the source and dropped before
 * joining, so the third chunk is page 5. Any code that assumed index + 1 would
 * name page 3 here, and the user would go to page 3 and find it fine.
 */
const CHUNKS = [
  { pageNumber: 1, text: "aaaaaaaaaa" },
  { pageNumber: 2, text: "bbbbbbbbbb" },
  { pageNumber: 5, text: "cccccccccc" },
];
const SEP = "\n\n";
const ASSEMBLED = CHUNKS.map((c) => c.text).join(SEP); // 34
const STARTS = pageStartsFor(CHUNKS, SEP); // offsets 0, 12, 24

describe("pageStartsFor", () => {
  it("gives each page's start in the assembled string", () => {
    expect(STARTS).toEqual([
      { pageNumber: 1, offset: 0, length: 10 },
      { pageNumber: 2, offset: 12, length: 10 },
      { pageNumber: 5, offset: 24, length: 10 },
    ]);
    expect(ASSEMBLED.length).toBe(34);
    expect(ASSEMBLED.slice(12, 22)).toBe("bbbbbbbbbb");
  });
});

describe("describeWindow", () => {
  it("reports nothing to disclose when the whole document fits", () => {
    const w = describeWindow(ASSEMBLED, STARTS, 3, 100);
    expect(w.truncated).toBe(false);
    expect(w.cutMidPage).toBe(false);
    expect(modelTruncationNotice(w)).toBe("");
    expect(userTruncationNotice(w)).toBe("");
  });

  it("names the last COMPLETE page when the cut falls inside page three", () => {
    // 30 chars: pages 1 and 2 whole, 6 characters into page 3.
    const w = describeWindow(ASSEMBLED, STARTS, 3, 30);
    expect(w.truncated).toBe(true);
    expect(w.lastCompletePage).toBe(2);
    expect(w.cutMidPage).toBe(true);
    expect(w.charactersSent).toBe(30);
    expect(w.charactersTotal).toBe(34);
  });

  it("names the REAL page number, not the chunk index", () => {
    // Cut 6 characters into the third chunk, which is page 5. The last
    // complete page is 2. An index-based implementation would say 2 here too
    // by luck; the assertion that matters is the total, which must be 5-aware.
    const w = describeWindow(ASSEMBLED, STARTS, 5, 30);
    expect(w.lastCompletePage).toBe(2);
    expect(w.totalPages).toBe(5);
    expect(userTruncationNotice(w)).toMatch(/pages 1–2 of 5/);
  });

  it("does not credit a page the cut only just reached", () => {
    // 13 chars: page 2 has started (offset 12) but only one character of it is
    // present. Claiming "pages 1-2" here would be the off-by-one that turns a
    // disclosure into a new false claim.
    const w = describeWindow(ASSEMBLED, STARTS, 3, 13);
    expect(w.lastCompletePage).toBe(1);
  });

  it("reports no page at all when the cut lands inside page one", () => {
    // Better to say "the first part of 3 pages" than to invent page 0.
    const w = describeWindow(ASSEMBLED, STARTS, 3, 5);
    expect(w.lastCompletePage).toBeNull();
    expect(userTruncationNotice(w)).toMatch(/first part of this 3-page/);
  });
});

describe("the model notice revokes the instruction that caused the defect", () => {
  it("tells the model not to deny, and names the bound", () => {
    const notice = modelTruncationNotice(
      describeWindow(ASSEMBLED, STARTS, 3, 30),
    );
    // The whole point: a model told only "answer from the document" still
    // denies, because as far as it can see the document lacks the answer.
    expect(notice).toMatch(/do NOT say the document does not contain it/);
    expect(notice).toMatch(/pages 1-2 of 3/);
    expect(notice).toMatch(/mid-page/);
  });
});

describe("the user notice is a sentence, not a character count", () => {
  it("names pages rather than characters", () => {
    const notice = userTruncationNotice(
      describeWindow(ASSEMBLED, STARTS, 3, 30),
    );
    expect(notice).toMatch(/pages 1–2 of 3/);
    expect(notice).not.toMatch(/\d{4,}/); // no raw character totals
  });
});

describe("the offset table is checked against the string it indexes", () => {
  it("names NO page when the table does not describe this string", () => {
    // The classic shift: the engine slices `extracted.text.trim()` while the
    // table was built from the per-page chunks. One leading space is enough to
    // put every offset one character out — and an off-by-one page number is a
    // new confident false claim, so the notice must fall back to naming none.
    const shifted = ` ${ASSEMBLED}`;
    const w = describeWindow(shifted, STARTS, 5, 30);
    expect(w.truncated).toBe(true);
    expect(w.lastCompletePage).toBeNull();
    expect(w.cutMidPage).toBe(false);
    expect(userTruncationNotice(w)).toMatch(/first part of this 5-page/);
  });

  it("still discloses the truncation when there are no page starts at all", () => {
    const w = describeWindow(ASSEMBLED, [], 5, 30);
    expect(w.truncated).toBe(true);
    expect(w.lastCompletePage).toBeNull();
    expect(userTruncationNotice(w)).toMatch(/first part of this 5-page/);
  });
});
