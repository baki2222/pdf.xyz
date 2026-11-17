// @vitest-environment node
/**
 * Page markers are SIZED in `planTranslateChunks` and BUDGETED in
 * `capPagesToDelivery` (the chunking.ts docblock, "EVERY SENT CHARACTER IS
 * WEIGHED"). The properties, each a test:
 *
 *  (i)   P1 at the ceiling: a chunk never weighs more than one call may
 *        carry, counting a separator per boundary, so a marked chunk's sent
 *        text fits the ceiling too.
 *  (ii)  P2: the delivered page SET, the withheld pages, the bound and every
 *        refusal input are identical to a reference copy of the planner and
 *        the cap walk as they were before markers (85812cd3). Chunk
 *        BOUNDARIES may move; what is delivered may not.
 *  (iii) The markers spend only the reservation's slack.
 *  (iv)  A one-page chunk is never marked and weighs exactly its text.
 *  (v)   Sizing is independent of marking: budget, `markers` and collision
 *        change which chunks are marked, never which pages a chunk holds.
 *
 * Plus the collision rule (D3), on the reader's normal form, and its
 * precedence over the budget.
 *
 * Non-ASCII characters are built from code points, never typed.
 */
import { describe, expect, it } from "vitest";
import { PAGE_JOIN } from "@/lib/pdf/text";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import type { DeliveryBound } from "@/lib/jobs/delivery-cap";
import {
  capPagesToDelivery,
  planTranslateChunks,
  type DeliveryLimit,
  type PlannedPage,
  type TranslatePlan,
} from "./chunking";
import {
  collidesWithMarker,
  markerFor,
  separatorFor,
  separatorOverhead,
} from "./page-markers";

const CEILING = TRANSLATE_MAX_INPUT_CHARS;
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

// ── THE REFERENCE: main's planner and cap walk, before markers ──────────────
//
// Copied from src/lib/workers/translate/chunking.ts at 85812cd3 (#340), the
// commit this change was cut from, docblocks removed and types narrowed to
// what (ii) compares. It is the history: the delivered set must never move
// away from it. Do not "fix" it to match the planner.

interface RefPlan {
  chunks: { pages: number[] }[];
  oversize: number[];
}

function refPlanTranslateChunks(
  pageChunks: readonly PlannedPage[],
  ceiling: number,
): RefPlan {
  const chunks: { pages: number[] }[] = [];
  const oversize: number[] = [];
  let pending: PlannedPage[] = [];
  let pendingChars = 0;
  const flush = (): void => {
    if (pending.length === 0) return;
    chunks.push({ pages: pending.map((p) => p.pageNumber) });
    pending = [];
    pendingChars = 0;
  };
  for (const page of pageChunks) {
    const size = page.text.length;
    if (size > ceiling) {
      flush();
      oversize.push(page.pageNumber);
      continue;
    }
    const joined =
      pending.length === 0 ? size : pendingChars + PAGE_JOIN.length + size;
    if (joined > ceiling) flush();
    pending.push(page);
    pendingChars =
      pending.length === 1 ? size : pendingChars + PAGE_JOIN.length + size;
  }
  flush();
  return { chunks, oversize };
}

function refCapPagesToDelivery(
  pageChunks: readonly PlannedPage[],
  ceiling: number,
  limit: DeliveryLimit,
): { plan: RefPlan; withheldPages: number[]; boundBy: DeliveryBound | null } {
  const maxPages = limit.pages ?? Number.POSITIVE_INFINITY;
  let characters = 0;
  let pages = 0;
  let boundBy: DeliveryBound | null = null;
  let cut = pageChunks.length;
  for (const [i, page] of pageChunks.entries()) {
    const size = page.text.length;
    if (size > ceiling) continue;
    if (characters + size > limit.characters) {
      boundBy = "characters";
      cut = i;
      break;
    }
    if (pages + 1 > maxPages) {
      boundBy = "pages";
      cut = i;
      break;
    }
    characters += size;
    pages += 1;
  }
  const delivered = pageChunks.slice(0, cut);
  return {
    plan: refPlanTranslateChunks(delivered, ceiling),
    withheldPages: pageChunks.slice(cut).map((page) => page.pageNumber),
    boundBy,
  };
}

// ── THE GENERATOR ───────────────────────────────────────────────────────────

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const LATIN = "the quick brown fox jumps over a lazy dog ";
// Hebrew letters U+05D0..U+05EA, spaced: an RTL page.
const HEBREW = Array.from({ length: 27 }, (_, i) =>
  i % 6 === 5 ? " " : cp(0x05d0 + i),
).join("");

function filler(size: number, alphabet: string): string {
  if (size === 0) return "";
  return alphabet.repeat(Math.ceil(size / alphabet.length)).slice(0, size);
}

interface Generated {
  readonly seed: number;
  readonly kind: "near" | "mixed" | "tiny";
  readonly pages: PlannedPage[];
  readonly limit: DeliveryLimit;
}

function generate(seed: number): Generated {
  const random = lcg(seed);
  const count = 1 + Math.floor(random() * 40);
  const roll = random();
  const kind: Generated["kind"] =
    roll < 0.4 ? "near" : roll < 0.85 ? "mixed" : "tiny";
  const alphabet = random() < 0.2 ? HEBREW : LATIN;

  // "near": pages that pack exactly k to a call under PAGE_JOIN, so the
  // separators push the k-th page out (the mechanism (i) is about).
  const k = 2 + Math.floor(random() * 5);
  const near = Math.floor((CEILING - (k - 1) * PAGE_JOIN.length) / k);

  const sizes = Array.from({ length: count }, () => {
    if (kind === "near") return near - Math.floor(random() * 25);
    if (kind === "tiny") return Math.floor(random() * 16);
    const r = random();
    if (r < 0.06) return 0;
    if (r < 0.2) return 1 + Math.floor(random() * 12);
    if (r < 0.26) return CEILING + 1 + Math.floor(random() * 3_000);
    return 200 + Math.floor(random() * 4_000);
  });

  let pageNumber = 0;
  const pages: PlannedPage[] = sizes.map((size) => {
    pageNumber += 1 + (random() < 0.15 ? Math.floor(random() * 4) : 0);
    const text = filler(size, alphabet);
    // A flow `send` sometimes, never longer than the page's text.
    const send =
      random() < 0.3 ? text.slice(0, Math.floor(text.length * random())) : null;
    return send === null ? { pageNumber, text } : { pageNumber, text, send };
  });

  let limit: DeliveryLimit;
  if (random() < 0.15) {
    limit = { characters: Number.POSITIVE_INFINITY };
  } else {
    const upTo = Math.floor(random() * (count + 1));
    const base = pages
      .slice(0, upTo)
      .filter((p) => p.text.length <= CEILING)
      .reduce((n, p) => n + p.text.length, 0);
    const r = random();
    const slack =
      r < 0.45
        ? Math.floor(random() * 60)
        : r < 0.7
          ? Math.floor(random() * 600)
          : Math.floor(base * 3 * random());
    limit = {
      characters: Math.max(1, base + slack),
      ...(random() < 0.4 ? { pages: 1 + Math.floor(random() * count) } : {}),
    };
  }
  return { seed, kind, pages, limit };
}

const DOCUMENTS = Array.from({ length: 600 }, (_, i) => generate(20261116 + i));

const pageSets = (plan: TranslatePlan): number[][] =>
  plan.chunks.map((c) => [...c.pages]);

const deliveredSize = (plan: TranslatePlan, pages: readonly PlannedPage[]) => {
  const byNumber = new Map(pages.map((p) => [p.pageNumber, p.text.length]));
  return plan.chunks
    .flatMap((c) => c.pages)
    .reduce((n, page) => n + byNumber.get(page)!, 0);
};

const overheadOf = (pages: readonly number[]): number =>
  pages.slice(1).reduce((n, page) => n + separatorOverhead(page), 0);

/** What a chunk sends once its markers are sent: separators when marked. */
function sentIfMarked(
  chunk: TranslatePlan["chunks"][number],
  pages: readonly PlannedPage[],
): string {
  const byNumber = new Map(pages.map((p) => [p.pageNumber, p]));
  return chunk.pages
    .map((n, i) => {
      const page = byNumber.get(n)!;
      const body = page.send ?? page.text;
      return i === 0 ? body : separatorFor(n) + body;
    })
    .join("");
}

// ── (i) ─────────────────────────────────────────────────────────────────────

describe("(i) P1 at the ceiling: separators are weighed", () => {
  it("a 6-page document that fits one call under PAGE_JOIN but not with separators is two chunks, each within the ceiling", () => {
    // 6 × 1,700 + 5 × 2 = 10,210 ≤ 10,258; 6 × 1,700 + 5 × 23 = 10,315 > it.
    const pages = Array.from({ length: 6 }, (_, i) => ({
      pageNumber: i + 1,
      text: filler(1_700, LATIN),
    }));
    const joinOnly = 6 * 1_700 + 5 * PAGE_JOIN.length;
    const withSeparators =
      6 * 1_700 +
      pages.slice(1).reduce((n, p) => n + separatorFor(p.pageNumber).length, 0);
    expect(joinOnly).toBeLessThanOrEqual(CEILING);
    expect(withSeparators).toBeGreaterThan(CEILING);

    const plan = planTranslateChunks(pages, CEILING);
    expect(plan.chunks, "separators must split the document").toHaveLength(2);
    expect(pageSets(plan)).toEqual([[1, 2, 3, 4, 5], [6]]);
    for (const chunk of plan.chunks) {
      expect(chunk.marked).toBe(chunk.pages.length > 1);
      expect(chunk.characters).toBeLessThanOrEqual(CEILING);
      expect(chunk.text.length).toBeLessThanOrEqual(chunk.characters);
      expect(
        sentIfMarked(chunk, pages).length,
        "a marked chunk's sent text must fit one call",
      ).toBeLessThanOrEqual(CEILING);
      expect(sentIfMarked(chunk, pages).length).toBe(chunk.characters);
    }
  });

  it("over the generated documents, text ≤ characters ≤ ceiling, and a marked chunk's separators fit too", () => {
    let marked = 0;
    for (const doc of DOCUMENTS) {
      const plan = planTranslateChunks(doc.pages, CEILING);
      for (const chunk of plan.chunks) {
        const where = `seed ${doc.seed} chunk ${chunk.index}`;
        expect(chunk.text.length, where).toBeLessThanOrEqual(chunk.characters);
        expect(chunk.characters, where).toBeLessThanOrEqual(CEILING);
        expect(
          sentIfMarked(chunk, doc.pages).length,
          where,
        ).toBeLessThanOrEqual(CEILING);
        if (chunk.marked) marked += 1;
      }
    }
    expect(marked, "health: marked chunks were planned").toBeGreaterThan(200);
  });
});

// ── (ii), (iii), (iv) ───────────────────────────────────────────────────────

describe("(ii) P2: the delivered page set is main's, for every input", () => {
  it(`over ${DOCUMENTS.length} generated documents, delivered set, withheld pages, bound and refusal inputs equal the 85812cd3 reference`, () => {
    let withheld = 0;
    let countDiffers = 0;
    let budgetFallback = 0;
    let tinyBudgetFallback = 0;
    let rtl = 0;
    for (const doc of DOCUMENTS) {
      const where = `seed ${doc.seed} (${doc.kind}, ${doc.pages.length} pages, limit ${JSON.stringify(doc.limit)})`;
      const got = capPagesToDelivery(doc.pages, CEILING, doc.limit);
      const ref = refCapPagesToDelivery(doc.pages, CEILING, doc.limit);

      expect(got.withheldPages, where).toEqual(ref.withheldPages);
      expect(got.boundBy, where).toBe(ref.boundBy);
      expect(
        got.plan.oversize.map((o) => o.pageNumber),
        where,
      ).toEqual(ref.plan.oversize);
      expect(
        got.plan.chunks.flatMap((c) => c.pages),
        where,
      ).toEqual(ref.plan.chunks.flatMap((c) => c.pages));
      // The refusal inputs: nothing deliverable, and every page oversize.
      expect(got.plan.chunks.length === 0, where).toBe(
        ref.plan.chunks.length === 0,
      );
      expect(got.plan.oversize.length, where).toBe(ref.plan.oversize.length);

      if (got.withheldPages.length > 0) withheld += 1;
      if (got.plan.chunks.length !== ref.plan.chunks.length) countDiffers += 1;
      if (got.plan.chunks.some((c) => c.markerFallback === "budget")) {
        budgetFallback += 1;
        if (doc.kind === "tiny") tinyBudgetFallback += 1;
      }
      if (doc.pages.some((p) => p.text.includes(cp(0x05d0)))) rtl += 1;
    }
    // HEALTH: each mechanism really ran, or the equality above is vacuous.
    expect(withheld, "capped plans that withheld pages").toBeGreaterThanOrEqual(
      20,
    );
    expect(
      countDiffers,
      "documents whose chunk COUNT differs from the reference",
    ).toBeGreaterThanOrEqual(20);
    expect(
      budgetFallback,
      "plans with a chunk unmarked for budget",
    ).toBeGreaterThanOrEqual(20);
    expect(
      tinyBudgetFallback,
      "near-empty documents falling back for budget",
    ).toBeGreaterThanOrEqual(1);
    expect(rtl, "RTL documents").toBeGreaterThanOrEqual(20);
  });
});

describe("(iii) the markers spend only the reservation's slack", () => {
  it("Σ overhead of marked chunks ≤ limit.characters − Σ delivered size, for every capped plan", () => {
    let capped = 0;
    let spentToTheBone = 0;
    for (const doc of DOCUMENTS) {
      if (!Number.isFinite(doc.limit.characters)) continue;
      capped += 1;
      const got = capPagesToDelivery(doc.pages, CEILING, doc.limit);
      const slack = doc.limit.characters - deliveredSize(got.plan, doc.pages);
      const spent = got.plan.chunks
        .filter((c) => c.marked)
        .reduce((n, c) => n + overheadOf(c.pages), 0);
      expect(
        spent,
        `seed ${doc.seed}: markers spent ${spent} of a slack of ${slack}`,
      ).toBeLessThanOrEqual(slack);
      if (
        got.plan.chunks.some((c) => c.markerFallback === "budget") &&
        spent > 0
      ) {
        spentToTheBone += 1;
      }
    }
    expect(capped).toBeGreaterThanOrEqual(400);
    // Health: the budget bound and the marking both happened in one plan.
    expect(spentToTheBone).toBeGreaterThanOrEqual(10);
  });

  it("an uncapped plan marks every multi-page chunk that has no collision", () => {
    for (const doc of DOCUMENTS.filter(
      (d) => !Number.isFinite(d.limit.characters),
    )) {
      const got = capPagesToDelivery(doc.pages, CEILING, doc.limit);
      for (const chunk of got.plan.chunks) {
        expect(chunk.marked, `seed ${doc.seed}`).toBe(chunk.pages.length > 1);
      }
    }
  });
});

describe("(iv) a one-page chunk", () => {
  it("is never marked and weighs exactly its text", () => {
    let single = 0;
    for (const doc of DOCUMENTS) {
      const got = capPagesToDelivery(doc.pages, CEILING, doc.limit);
      const byNumber = new Map(doc.pages.map((p) => [p.pageNumber, p]));
      for (const chunk of got.plan.chunks) {
        if (chunk.pages.length !== 1) continue;
        single += 1;
        expect(chunk.marked).toBe(false);
        expect(chunk.markerFallback).toBeNull();
        expect(chunk.characters).toBe(
          byNumber.get(chunk.pages[0]!)!.text.length,
        );
      }
    }
    expect(single).toBeGreaterThanOrEqual(100);
  });
});

// ── (v) ─────────────────────────────────────────────────────────────────────

describe("(v) sizing does not depend on marking", () => {
  it("page-sets are identical for budget 0 and Infinity, markers on and off, and a same-length collision", () => {
    let changedMarking = 0;
    for (const doc of DOCUMENTS) {
      const where = `seed ${doc.seed}`;
      const base = planTranslateChunks(doc.pages, CEILING);
      const zero = planTranslateChunks(doc.pages, CEILING, { markerBudget: 0 });
      const off = planTranslateChunks(doc.pages, CEILING, { markers: false });
      expect(pageSets(zero), `${where}: budget 0`).toEqual(pageSets(base));
      expect(pageSets(off), `${where}: markers off`).toEqual(pageSets(base));

      // One page's text replaced by a SAME-LENGTH text holding the brand.
      const victim = doc.pages.findIndex(
        (p) => p.text.length >= 6 && p.text.length <= CEILING,
      );
      if (victim >= 0) {
        const pages = doc.pages.map((p, i) => {
          if (i !== victim) return p;
          const text = "pdfxyz" + p.text.slice(6);
          return { pageNumber: p.pageNumber, text };
        });
        const collided = planTranslateChunks(pages, CEILING);
        expect(pageSets(collided), `${where}: collision`).toEqual(
          pageSets(base),
        );
        if (
          collided.chunks.some((c) => c.markerFallback === "collision") &&
          base.chunks.some((c) => c.marked)
        )
          changedMarking += 1;
      }
      if (zero.chunks.some((c) => c.markerFallback === "budget"))
        changedMarking += 1;
    }
    // Health: the variants really changed the marking, so equal page-sets
    // mean sizing ignored it, not that nothing happened.
    expect(changedMarking).toBeGreaterThanOrEqual(200);
  }, 30_000);
});

// ── the collision rule (D3) ─────────────────────────────────────────────────

const page = (pageNumber: number, text: string): PlannedPage => ({
  pageNumber,
  text,
});

describe("the collision rule", () => {
  it("a page quoting a marker verbatim (our own docs) is sent unmarked, and counted as a collision", () => {
    const plan = planTranslateChunks(
      [page(1, "Intro."), page(2, `The line ${markerFor(2)} marks a page.`)],
      CEILING,
    );
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0]!.marked).toBe(false);
    expect(plan.chunks[0]!.markerFallback).toBe("collision");
  });

  it("a page holding a full-width PDFXYZ is sent unmarked (the collision test reads NFKC)", () => {
    // U+FF30 U+FF24 U+FF26 U+FF38 U+FF39 U+FF3A.
    const fullWidth = cp(0xff30, 0xff24, 0xff26, 0xff38, 0xff39, 0xff3a);
    const plan = planTranslateChunks(
      [page(1, "Intro."), page(2, `Made with ${fullWidth} tools.`)],
      CEILING,
    );
    expect(
      plan.chunks[0]!.markerFallback,
      "a full-width PDFXYZ page was marked: the collision test is not reading NFKC",
    ).toBe("collision");
  });

  it("a page holding a brand broken by a space, a ZWSP or a soft hyphen, or followed by a combining mark, is sent unmarked (the reader strips each)", () => {
    for (const broken of [
      "PDF XYZ",
      `PDF${cp(0x200b)}XYZ`,
      `PD${cp(0x00ad)}FXYZ`,
      `pdfxyz${cp(0x0301)}`,
    ]) {
      const plan = planTranslateChunks(
        [page(1, "Intro."), page(2, `Made with ${broken} tools.`)],
        CEILING,
      );
      expect(plan.chunks[0]!.markerFallback, JSON.stringify(broken)).toBe(
        "collision",
      );
    }
    // Punctuation is not a gap: the product's own name is ordinary text.
    const plain = planTranslateChunks(
      [page(1, "Intro."), page(2, "Made with pdf.xyz tools.")],
      CEILING,
    );
    expect(plain.chunks[0]!.marked).toBe(true);
  });

  it("a brand split ACROSS a page boundary collides: judged on the chunk's pages joined", () => {
    // Neither page holds it alone; a model that runs the two paragraphs
    // together writes "PDF XYZ", which the reader would strip.
    const pages = [page(1, "Saved as a PDF"), page(2, "XYZ Corp agreed.")];
    expect(collidesWithMarker(pages[0]!.text)).toBe(false);
    expect(collidesWithMarker(pages[1]!.text)).toBe(false);
    const plan = planTranslateChunks(pages, CEILING);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0]!.markerFallback).toBe("collision");
  });

  it("the SENT text decides: a brand only in `text` but not in `send` does not collide", () => {
    const plan = planTranslateChunks(
      [
        page(1, "Intro."),
        { pageNumber: 2, text: "pdfxyz in layout only", send: "flow" },
      ],
      CEILING,
    );
    expect(plan.chunks[0]!.marked).toBe(true);
  });

  it("instructions that hold the brand (markers: false) unmark every multi-page chunk, and move no page", () => {
    const pages = Array.from({ length: 12 }, (_, i) =>
      page(i + 1, filler(2_000, LATIN)),
    );
    const on = planTranslateChunks(pages, CEILING);
    const off = planTranslateChunks(pages, CEILING, { markers: false });
    expect(pageSets(off)).toEqual(pageSets(on));
    expect(on.chunks.filter((c) => c.marked).length).toBeGreaterThan(1);
    for (const chunk of off.chunks) {
      expect(chunk.marked).toBe(false);
      expect(chunk.markerFallback).toBe(
        chunk.pages.length > 1 ? "collision" : null,
      );
    }
  });

  it("collision precedes budget and spends none of it: a later chunk that fits only the untouched budget is marked", () => {
    // Chunk 1 = pages 1-5 (one quotes the brand), chunk 2 = pages 6-10.
    const pages = Array.from({ length: 10 }, (_, i) =>
      page(
        i + 1,
        i === 2 ? "pdfxyz" + filler(1_994, LATIN) : filler(2_000, LATIN),
      ),
    );
    const plain = planTranslateChunks(pages, CEILING);
    expect(pageSets(plain)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
    ]);
    // Exactly chunk 2's overhead: had chunk 1 spent its own, none would remain.
    const budget = overheadOf([6, 7, 8, 9, 10]);
    expect(overheadOf([1, 2, 3, 4, 5])).toBeLessThanOrEqual(budget);
    const plan = planTranslateChunks(pages, CEILING, { markerBudget: budget });
    expect(plan.chunks.map((c) => c.markerFallback)).toEqual([
      "collision",
      null,
    ]);
    expect(plan.chunks[1]!.marked).toBe(true);
    // And one character less: chunk 2 now falls back for budget.
    const short = planTranslateChunks(pages, CEILING, {
      markerBudget: budget - 1,
    });
    expect(short.chunks.map((c) => c.markerFallback)).toEqual([
      "collision",
      "budget",
    ]);
  });

  it("the default budget is Infinity (the browser preflight's plan): every non-collision multi-page chunk is marked", () => {
    const pages = Array.from({ length: 30 }, (_, i) =>
      page(i + 1, filler(1_000 + ((i * 37) % 900), LATIN)),
    );
    const plan = planTranslateChunks(pages, CEILING);
    expect(plan.chunks.length).toBeGreaterThan(2);
    for (const chunk of plan.chunks) expect(chunk.marked).toBe(true);
    expect(pageSets(plan)).toEqual(
      pageSets(
        planTranslateChunks(pages, CEILING, {
          markerBudget: Number.POSITIVE_INFINITY,
        }),
      ),
    );
  });
});
