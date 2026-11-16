// @vitest-environment node
// @native-canvas
/**
 * PROPERTY over GENERATED documents (competitor audit #29, slice 6): for
 * every document and every canonical selection, CHARGE == SENT. Same chain as
 * `translate-page-range.chain.test.ts` (`@/tests/translate-page-range-chain`),
 * pdfjs on both sides.
 *
 * A seeded generator (the seed is printed in every failure message) builds
 * pdf-lib documents of 1-12 pages with random blank pages (a blank page 1 in
 * some, a blank page inside a chosen span in some), page texts of random
 * length below the per-pass ceiling, and a random canonical selection (single
 * pages, several spans, and the whole document, which sends no `pages`). For
 * each one:
 *   - the text between the provider's delimiters, markers removed, is the
 *     chosen pages' text in page order, and holds no unchosen page's token;
 *   - the charge is `ceil(selection characterCount × 4)`;
 *   - `cap.pages` is the worker's selected text-page count;
 *   - nothing is withheld, and `selectionConfirmed` is true;
 *   - every "Page N" / "Pages …" label in translation.md, the README and the
 *     typeset PDF text names only chosen pages.
 *
 * HEALTH: the corpus holds each named shape (counted, at least one each:
 * `[] ⊆ X` is vacuous) and its size is between 40 and 200. POSITIVE CONTROL:
 * a deliberately mis-declared run (the whole document's characters declared
 * with a selection) FAILS the charge predicate.
 *
 * LIMIT: pdfjs on both sides proves the pairing, not production. The worker
 * extracts with poppler, whose character counts can differ from pdfjs's by an
 * unbounded factor while the PAGES agree (memory "two extractors, one
 * ceiling"), so "nothing withheld for an honest selection" is a
 * same-extractor claim; the ×4 headroom absorbs the difference in production
 * and a real job's decoded ZIP is the only production check.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { selectExtraction } from "@/lib/pdf/page-selection";
import { formatSpans, pageSpans, type PageSpan } from "@/lib/pdf/page-spans";
import { pageTextChunks } from "@/lib/pdf/text";
import {
  runChain,
  withoutMarkers,
  type ChainRun,
} from "@/tests/translate-page-range-chain";

const SEED = 0x5eed2911;
const DOCUMENTS = 48;
const EN_DASH = String.fromCharCode(0x2013);

/** mulberry32: small, seedable, good enough to spread shapes. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "river",
  "market",
  "lantern",
  "orchard",
  "harbour",
  "meadow",
  "station",
  "library",
  "bakery",
  "garden",
];

interface Case {
  readonly index: number;
  /** Per page, its text or "" for a blank page. */
  readonly pages: readonly string[];
  /** What is typed into the Pages field ("" = the whole document). */
  readonly typed: string;
  /** The chosen page numbers, or null for the whole document. */
  readonly chosen: ReadonlySet<number> | null;
}

const tokenOf = (doc: number, page: number) => `TK${doc}Q${page}Z`;

function generate(seed: number, count: number): Case[] {
  const rand = prng(seed);
  const int = (lo: number, hi: number) =>
    lo + Math.floor(rand() * (hi - lo + 1));
  const cases: Case[] = [];
  for (let index = 0; index < count; index += 1) {
    const n = int(1, 12);
    const pages: string[] = [];
    for (let p = 1; p <= n; p += 1) {
      const blank = rand() < (p === 1 ? 0.3 : 0.2);
      if (blank) {
        pages.push("");
        continue;
      }
      const words = Array.from({ length: int(3, 40) }, () => WORDS[int(0, 9)]);
      pages.push(`${tokenOf(index, p)} ${words.join(" ")}.`);
    }
    // At least one text page, or there is nothing to translate.
    if (!pages.some(Boolean)) pages[n - 1] = `${tokenOf(index, n)} end.`;
    const textPages = pages.flatMap((t, i) => (t ? [i + 1] : []));
    const shape = index % 4;
    let chosenList: number[] | null;
    if (shape === 0) chosenList = null;
    else if (shape === 1)
      chosenList = [textPages[int(0, textPages.length - 1)]!];
    else {
      chosenList = [];
      for (let p = 1; p <= n; p += 1) if (rand() < 0.5) chosenList.push(p);
      // A selection must hold a text page (else the panel refuses it).
      if (!chosenList.some((p) => pages[p - 1])) chosenList.push(textPages[0]!);
      chosenList = [...new Set(chosenList)].sort((a, b) => a - b);
    }
    // A selection naming EVERY page is the whole document (D2): typed as
    // chosen, sent with no `pages`, so it is expected as the whole document.
    if (chosenList && chosenList.length === n) {
      cases.push({
        index,
        pages,
        typed: n === 1 ? "1" : `1-${n}`,
        chosen: null,
      });
      continue;
    }
    const spans = chosenList ? pageSpans(chosenList) : null;
    // Typed as a person would: "2, 4-6", spans in order, ASCII hyphen.
    const typed = spans
      ? spans.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ")
      : "";
    cases.push({
      index,
      pages,
      typed,
      chosen: chosenList ? new Set(chosenList) : null,
    });
  }
  return cases;
}

async function pdfOf(c: Case): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of c.pages) {
    const page = doc.addPage([612, 792]);
    if (!text) continue;
    // Wrapped at ~90 characters so no line runs off the page.
    const lines = text.match(/.{1,90}(\s|$)/g) ?? [text];
    lines.forEach((line, i) =>
      page.drawText(line.trim(), { x: 30, y: 750 - i * 14, size: 9, font }),
    );
  }
  return doc.save();
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The page numbers a "Page N" / "Pages a–b, c" label names. */
function labelledPages(text: string): number[] {
  const out: number[] = [];
  const re = new RegExp(
    `\\bPages? (\\d+(?:${EN_DASH}\\d+)?(?:, \\d+(?:${EN_DASH}\\d+)?)*)`,
    "g",
  );
  for (const m of text.matchAll(re))
    for (const part of m[1]!.split(", ")) {
      const [a, b] = part.split(EN_DASH).map(Number);
      for (let p = a!; p <= (b ?? a)!; p += 1) out.push(p);
    }
  return out;
}

/** The property's predicates, each returning a failure sentence or null. */
function failures(c: Case, run: ChainRun): string[] {
  const out: string[] = [];
  const say = (ok: boolean, what: string) => {
    if (!ok) out.push(what);
  };
  const spans: PageSpan[] | null = c.chosen
    ? pageSpans([...c.chosen].sort((a, b) => a - b))
    : null;
  const selected = spans
    ? selectExtraction(run.extracted, spans)
    : run.extracted;
  say(
    JSON.stringify(run.pages) === JSON.stringify(spans),
    `the panel's spans ${JSON.stringify(run.pages)} are not ${JSON.stringify(spans)}`,
  );
  say(
    run.charge === Math.ceil(selected.characterCount * 4),
    `charge ${run.charge} is not ceil(${selected.characterCount} x 4)`,
  );
  say(
    run.cap.pages === pageTextChunks(selected.pages).length,
    `cap.pages ${run.cap.pages} is not the selection's text pages`,
  );
  say(run.stage === "delivered", `stage ${run.stage}`);
  say(run.stored?.delivery === undefined, "something was withheld");
  const sent = withoutMarkers(run.segments.join("\n"), c.pages.length);
  say(
    squash(sent) === squash(selected.text),
    "the sent text is not the chosen pages' text in page order",
  );
  c.pages.forEach((text, i) => {
    const p = i + 1;
    if (!text || !c.chosen || c.chosen.has(p)) return;
    say(!sent.includes(tokenOf(c.index, p)), `unchosen page ${p} was sent`);
  });
  if (c.chosen) {
    say(run.confirmed === true, "selectionConfirmed is not true");
    const named = labelledPages(run.labelText).filter((p) => !c.chosen!.has(p));
    say(named.length === 0, `labels name unchosen pages ${named.join(",")}`);
  }
  return out;
}

describe("Translate chosen pages: charge == sent over generated documents", () => {
  const cases = generate(SEED, DOCUMENTS);

  it("health: the corpus is plausibly sized and holds every named shape", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    expect(cases.length).toBeLessThanOrEqual(200);
    const shapes = {
      wholeDocument: cases.filter((c) => c.chosen === null).length,
      everyPageTyped: cases.filter((c) => c.chosen === null && c.typed !== "")
        .length,
      singlePage: cases.filter((c) => c.chosen?.size === 1).length,
      multiSpan: cases.filter((c) => c.typed.includes(",")).length,
      blankFirstPage: cases.filter((c) => c.pages[0] === "").length,
      blankInsideChosenSpan: cases.filter((c) => {
        if (!c.chosen) return false;
        const spans = pageSpans([...c.chosen].sort((a, b) => a - b));
        return spans.some(([a, b]) => {
          for (let p = a; p <= b; p += 1)
            if (c.pages[p - 1] === "") return true;
          return false;
        });
      }).length,
      blankChosenPage: cases.filter(
        (c) => c.chosen && [...c.chosen].some((p) => c.pages[p - 1] === ""),
      ).length,
    };
    for (const [shape, n] of Object.entries(shapes))
      expect(
        n,
        `seed ${SEED}: no case of shape ${shape}`,
      ).toBeGreaterThanOrEqual(1);
  });

  it("every generated document holds the property", async () => {
    const broken: string[] = [];
    for (const c of cases) {
      const run = await runChain(await pdfOf(c), c.typed);
      const f = failures(c, run);
      if (f.length > 0)
        broken.push(
          `seed ${SEED} case ${c.index} (pages ${c.pages.length}, typed "${c.typed}"${c.chosen ? `, spans ${formatSpans(pageSpans([...c.chosen].sort((a, b) => a - b)))}` : ""}): ${f.join("; ")}`,
        );
    }
    expect(broken, `seed ${SEED}`).toEqual([]);
  }, 180_000);

  it("POSITIVE CONTROL: the whole document's characters declared with a selection fails the charge", async () => {
    const c = cases.find(
      (x) =>
        x.chosen !== null &&
        x.pages.filter(Boolean).length > [...x.chosen].length &&
        x.pages.some((t, i) => t && !x.chosen!.has(i + 1)),
    )!;
    expect(c, `seed ${SEED}: no case with an unchosen text page`).toBeDefined();
    const run = await runChain(await pdfOf(c), c.typed, {
      declare: ({ extracted }) => extracted.characterCount,
    });
    const f = failures(c, run);
    expect(f.some((line) => line.startsWith("charge "))).toBe(true);
  }, 30_000);
});
