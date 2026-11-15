/**
 * The common characters of Chinese, Japanese and Korean, DERIVED from the
 * national character sets by decoding their byte ranges — never typed.
 *
 * Why (2026-11-16): #335's "zh, 3000 Han ×10" corpus was the first 3000
 * code points from U+4E00 (U+4E00–U+5BB7). 门 U+95E8 and most of the
 * C-SIMPLIFIED radical components (车 贝 见 马 鱼 鸟 …) lie outside it, so
 * the corpus could not see pdf.js reading 门 as ⻔ U+2ED4 — the defect a real
 * zh job then showed in production. The question was asked of the wrong set
 * (CLAUDE.md rule 4). These sets are the characters people actually write:
 *
 *   - zh: GB2312 level 1, rows 16–55 (bytes 0xB0A1–0xD7F9), 3,755 hanzi.
 *   - ja: JIS X 0208 level 1, rows 16–47 (EUC-JP 0xB0A1–0xCFD3), 2,965
 *     kanji; plus the kana of rows 4 and 5 (83 hiragana, 86 katakana).
 *   - ko: KS X 1001 Hangul, rows 16–40 (EUC-KR 0xB0A1–0xC8FE), 2,350.
 *
 * Each set is bounded by its exact published count, and a decoder that
 * yields U+FFFD, a second code point, a duplicate, or a code point outside
 * the script's block is FATAL (it throws): a corpus that quietly shrinks, or
 * fills with replacement characters, would certify everything. Pure: used by
 * `cjk-common-corpus.test.ts` and by `scripts/worker-translate-pdf-proof.ts`
 * inside the worker image, so the two read one corpus.
 */

export type CommonCorpusLanguage = "zh" | "ja" | "ko";

/** One decoded range: `label` decoder, lead bytes × trail bytes, in order. */
interface Rows {
  readonly label: string;
  readonly firstLead: number;
  readonly lastLead: number;
  /** The last lead row stops at this trail byte (an unassigned tail). */
  readonly lastTrailOfLastLead: number;
  readonly inBlock: (cp: number) => boolean;
}

const TRAIL_FIRST = 0xa1;
const TRAIL_LAST = 0xfe;

const isUro = (cp: number) => cp >= 0x4e00 && cp <= 0x9fff;

export class CorpusDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorpusDecodeError";
  }
}

function decodeRows(rows: Rows): string[] {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(rows.label, { fatal: true });
  } catch {
    throw new CorpusDecodeError(`no ${rows.label} decoder in this runtime`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (let lead = rows.firstLead; lead <= rows.lastLead; lead++) {
    const lastTrail =
      lead === rows.lastLead ? rows.lastTrailOfLastLead : TRAIL_LAST;
    for (let trail = TRAIL_FIRST; trail <= lastTrail; trail++) {
      let ch: string;
      try {
        ch = decoder.decode(new Uint8Array([lead, trail]));
      } catch {
        throw new CorpusDecodeError(
          `${rows.label} ${hex2(lead)}${hex2(trail)}: not decodable`,
        );
      }
      const cps = [...ch];
      const cp = ch.codePointAt(0);
      if (cps.length !== 1 || cp === undefined || cp === 0xfffd)
        throw new CorpusDecodeError(
          `${rows.label} ${hex2(lead)}${hex2(trail)}: decoded to ${JSON.stringify(ch)}`,
        );
      if (!rows.inBlock(cp))
        throw new CorpusDecodeError(
          `${rows.label} ${hex2(lead)}${hex2(trail)}: U+${cp.toString(16).toUpperCase()} is outside the expected block`,
        );
      if (seen.has(ch))
        throw new CorpusDecodeError(
          `${rows.label} ${hex2(lead)}${hex2(trail)}: duplicate ${ch}`,
        );
      seen.add(ch);
      out.push(ch);
    }
  }
  return out;
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");

function bounded(name: string, chars: string[], expected: number): string[] {
  if (chars.length !== expected)
    throw new CorpusDecodeError(
      `${name}: ${chars.length} characters, expected exactly ${expected}`,
    );
  return chars;
}

/** The published sizes — the corpus's own bound. */
export const CORPUS_COUNTS = {
  gb2312Level1: 3755,
  jisX0208Level1: 2965,
  hiragana: 83,
  katakana: 86,
  ksX1001Hangul: 2350,
} as const;

/** GB2312 level 1: rows 16–55, cells 1–94 (row 55 stops at cell 89). */
export function gb2312Level1(): string[] {
  return bounded(
    "GB2312 level 1",
    decodeRows({
      label: "gbk",
      firstLead: 0xb0,
      lastLead: 0xd7,
      lastTrailOfLastLead: 0xf9,
      inBlock: isUro,
    }),
    CORPUS_COUNTS.gb2312Level1,
  );
}

/** JIS X 0208 level 1: rows 16–47 (row 47 stops at cell 51). */
export function jisX0208Level1(): string[] {
  return bounded(
    "JIS X 0208 level 1",
    decodeRows({
      label: "euc-jp",
      firstLead: 0xb0,
      lastLead: 0xcf,
      lastTrailOfLastLead: 0xd3,
      inBlock: isUro,
    }),
    CORPUS_COUNTS.jisX0208Level1,
  );
}

/** JIS X 0208 rows 4 (hiragana, cells 1–83) and 5 (katakana, cells 1–86). */
export function jisKana(): string[] {
  const hiragana = bounded(
    "JIS X 0208 hiragana",
    decodeRows({
      label: "euc-jp",
      firstLead: 0xa4,
      lastLead: 0xa4,
      lastTrailOfLastLead: 0xf3,
      inBlock: (cp) => cp >= 0x3041 && cp <= 0x309f,
    }),
    CORPUS_COUNTS.hiragana,
  );
  const katakana = bounded(
    "JIS X 0208 katakana",
    decodeRows({
      label: "euc-jp",
      firstLead: 0xa5,
      lastLead: 0xa5,
      lastTrailOfLastLead: 0xf6,
      inBlock: (cp) => cp >= 0x30a0 && cp <= 0x30ff,
    }),
    CORPUS_COUNTS.katakana,
  );
  return [...hiragana, ...katakana];
}

/** KS X 1001 Hangul: rows 16–40, every cell. */
export function ksX1001Hangul(): string[] {
  return bounded(
    "KS X 1001 Hangul",
    decodeRows({
      label: "euc-kr",
      firstLead: 0xb0,
      lastLead: 0xc8,
      lastTrailOfLastLead: TRAIL_LAST,
      inBlock: (cp) => cp >= 0xac00 && cp <= 0xd7a3,
    }),
    CORPUS_COUNTS.ksX1001Hangul,
  );
}

export interface CommonCorpus {
  readonly language: CommonCorpusLanguage;
  readonly name: string;
  readonly chars: readonly string[];
}

/** The common-character corpus for one CJK target. */
export function commonCorpus(language: CommonCorpusLanguage): CommonCorpus {
  switch (language) {
    case "zh":
      return { language, name: "GB2312 level 1", chars: gb2312Level1() };
    case "ja":
      return {
        language,
        name: "JIS X 0208 level 1 + kana",
        chars: [...jisX0208Level1(), ...jisKana()],
      };
    case "ko":
      return { language, name: "KS X 1001 Hangul", chars: ksX1001Hangul() };
  }
}

/**
 * The corpus as a translation body: every character once, space-separated,
 * 30 to a paragraph — so each reader's output, with whitespace removed, can
 * be compared position by position.
 */
export function corpusBody(chars: readonly string[]): string {
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += 30)
    lines.push(chars.slice(i, i + 30).join(" "), "");
  return lines.join("\n").trimEnd();
}
