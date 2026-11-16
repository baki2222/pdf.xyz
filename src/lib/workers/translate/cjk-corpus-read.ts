/**
 * The common-character corpus (`cjk-common-corpus.ts`) through the REAL
 * renderer, read back by both readers a user's copy goes through: pdftotext
 * (poppler honours Skia's ActualText) and pdf.js `getTextContent` (it does
 * not). Run only by `scripts/worker-translate-pdf-proof.ts` inside the worker
 * image — never by the render path.
 *
 * Gates (2026-11-16, the 门 → ⻔ defect seen in production):
 *   - pdftotext must read the corpus EXACTLY, position by position;
 *   - pdf.js must read no character as a DIFFERENT real character. A radical
 *     left as a radical is reported, and allowed only where the measured
 *     facts say the face that drew it has no unified sharer, or several, for
 *     that radical. A radical the facts do not measure, or one whose single
 *     sharer should have been rewritten, fails.
 *   - Output that cannot be aligned with the corpus fails: an unaligned read
 *     cannot certify anything.
 */
import type { TranslatePdfDeps } from "./engine";
import type { PdfProbeReaders } from "./pdf-readers";
import { pdfFontFaces } from "./pdf-render";
import type { CommonCorpus } from "./cjk-common-corpus";
import { corpusBody } from "./cjk-common-corpus";
import {
  isUnifiedIdeograph,
  RADICAL_GLYPH_FACTS,
  type RadicalGlyphFacts,
} from "./radical-equivalents";

/** The CJK Radicals Supplement and Kangxi Radicals BLOCKS (not the facts). */
const inRadicalBlocks = (cp: number) => cp >= 0x2e80 && cp <= 0x2fdf;

export type MisreadKind =
  | "radical, no sharer"
  | "radical, several sharers"
  | "radical, not measured"
  | "radical, should have been rewritten"
  | "different character";

export interface Misread {
  readonly expected: string;
  readonly read: string;
  readonly kind: MisreadKind;
}

export interface CorpusReadResult {
  readonly language: string;
  readonly name: string;
  readonly total: number;
  readonly delivered: boolean;
  readonly reason?: string;
  readonly faces: readonly string[];
  readonly poppler: { correct: number; aligned: boolean; misses: string[] };
  readonly viewer: {
    correct: number;
    aligned: boolean;
    misreads: Misread[];
  } | null;
  /** Empty = the corpus passes both gates. */
  readonly failures: readonly string[];
}

const u = (ch: string) =>
  `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

/** Whitespace removed, and the document's own furniture characters. */
function significant(text: string, corpus: ReadonlySet<string>): string[] {
  return [...text].filter(
    (ch) =>
      !/\s/.test(ch) &&
      (corpus.has(ch) || ch.codePointAt(0)! > 0x2e7f) &&
      // The furniture (title, note) is Latin and punctuation; the em dash in
      // the note is the one non-ASCII character it holds.
      ch !== "—",
  );
}

/** How a radical read in place of `expected` is judged, by the facts. */
export function classifyRadical(
  radical: number,
  faces: readonly string[],
  facts: RadicalGlyphFacts,
): MisreadKind {
  const named = faces.filter((f) => facts.faces[f]);
  if (named.length === 0) return "radical, not measured";
  const counts: number[] = [];
  for (const face of named) {
    const entry = facts.faces[face]![radical.toString(16)];
    if (entry === undefined) return "radical, not measured";
    counts.push(
      entry
        .split(" ")
        .filter(Boolean)
        .map((h) => parseInt(h, 16))
        .filter(isUnifiedIdeograph).length,
    );
  }
  if (counts.some((n) => n === 1)) return "radical, should have been rewritten";
  return counts.every((n) => n === 0)
    ? "radical, no sharer"
    : "radical, several sharers";
}

export function judgeCorpusRead(
  corpus: CommonCorpus,
  popplerText: string,
  viewerText: string | null,
  faces: readonly string[],
  facts: RadicalGlyphFacts = RADICAL_GLYPH_FACTS,
): Omit<CorpusReadResult, "delivered" | "reason"> {
  const set = new Set(corpus.chars);
  const expected = corpus.chars;
  const failures: string[] = [];

  const p = significant(popplerText, set);
  const pAligned = p.length === expected.length;
  const pMisses: string[] = [];
  let pCorrect = 0;
  for (let i = 0; i < expected.length; i++)
    if (p[i] === expected[i]) pCorrect += 1;
    else pMisses.push(expected[i]!);
  if (!pAligned)
    failures.push(
      `pdftotext read ${p.length} characters for ${expected.length}: not aligned`,
    );
  else if (pCorrect !== expected.length)
    failures.push(`pdftotext misread ${expected.length - pCorrect}`);

  let viewer: CorpusReadResult["viewer"] = null;
  if (viewerText === null) failures.push("pdf.js did not read the PDF");
  else {
    const v = significant(viewerText, set);
    const aligned = v.length === expected.length;
    const misreads: Misread[] = [];
    let correct = 0;
    for (let i = 0; i < Math.min(v.length, expected.length); i++) {
      const e = expected[i]!;
      const g = v[i]!;
      if (g === e) {
        correct += 1;
        continue;
      }
      const cp = g.codePointAt(0)!;
      misreads.push({
        expected: e,
        read: g,
        kind: inRadicalBlocks(cp)
          ? classifyRadical(cp, faces, facts)
          : "different character",
      });
    }
    viewer = { correct, aligned, misreads };
    if (!aligned)
      failures.push(
        `pdf.js read ${v.length} characters for ${expected.length}: not aligned`,
      );
    const bad = misreads.filter(
      (m) =>
        m.kind !== "radical, no sharer" &&
        m.kind !== "radical, several sharers",
    );
    if (bad.length > 0)
      failures.push(
        `pdf.js misread ${bad.length}: ${bad.map((m) => `${m.expected} ${u(m.expected)} as ${m.read} ${u(m.read)} (${m.kind})`).join(", ")}`,
      );
  }
  return {
    language: corpus.language,
    name: corpus.name,
    total: expected.length,
    faces,
    poppler: { correct: pCorrect, aligned: pAligned, misses: pMisses },
    viewer,
    failures,
  };
}

/** One corpus through `render`, read by both readers and judged. */
export async function readCommonCorpus(
  render: TranslatePdfDeps["render"],
  readers: PdfProbeReaders,
  corpus: CommonCorpus,
  facts: RadicalGlyphFacts = RADICAL_GLYPH_FACTS,
): Promise<CorpusReadResult> {
  const result = await render({
    input: {
      parts: [
        {
          kind: "body",
          pages: [],
          text: corpusBody(corpus.chars),
          chosen: null,
        },
      ],
      target: corpus.language,
      sourceName: "corpus.pdf",
    },
  });
  if (!result.ok)
    return {
      language: corpus.language,
      name: corpus.name,
      total: corpus.chars.length,
      delivered: false,
      reason: result.reason,
      faces: [],
      poppler: { correct: 0, aligned: false, misses: [] },
      viewer: null,
      failures: [`not delivered (${result.reason})`],
    };
  const faces = await pdfFontFaces(result.bytes);
  const popplerText = await readers.text(result.bytes);
  const viewerText = readers.viewerText
    ? await readers.viewerText(result.bytes)
    : null;
  return {
    ...judgeCorpusRead(corpus, popplerText, viewerText, faces, facts),
    delivered: true,
  };
}

/** The result as printable lines: counts, then every misread as a member. */
export function corpusReadLines(r: CorpusReadResult): string[] {
  const head = `  ${r.language} ${r.name}: ${r.delivered ? "" : `NOT DELIVERED (${r.reason}) `}pdftotext ${r.poppler.correct}/${r.total}${r.poppler.aligned ? "" : " (unaligned)"}; pdf.js ${r.viewer ? `${r.viewer.correct}/${r.total}${r.viewer.aligned ? "" : " (unaligned)"}` : "not read"}; ${r.failures.length === 0 ? "PASS" : "FAIL"}`;
  const lines = [head];
  if (r.faces.length) lines.push(`    faces: ${r.faces.join(", ")}`);
  if (r.poppler.misses.length)
    lines.push(
      `    pdftotext missed: ${r.poppler.misses
        .slice(0, 40)
        .map((ch) => `${ch} ${u(ch)}`)
        .join(" ")}${r.poppler.misses.length > 40 ? " …" : ""}`,
    );
  const byKind = new Map<MisreadKind, Misread[]>();
  for (const m of r.viewer?.misreads ?? []) {
    const list = byKind.get(m.kind) ?? [];
    list.push(m);
    byKind.set(m.kind, list);
  }
  for (const [kind, list] of byKind)
    lines.push(
      `    pdf.js ${kind} (${list.length}): ${list.map((m) => `${m.expected}→${m.read} ${u(m.read)}`).join(" ")}`,
    );
  for (const f of r.failures) lines.push(`    failure: ${f}`);
  return lines;
}
