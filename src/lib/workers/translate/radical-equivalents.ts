/**
 * Kangxi Radicals → the unified ideograph that shares the radical's glyph in
 * the face that drew it, and the ToUnicode rewrite that uses it.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * Noto Sans CJK draws 文 (U+6587) and ⽂ (KANGXI RADICAL SCRIPT, U+2F42) with
 * ONE glyph. Skia's Type 3 ToUnicode names the radical for that glyph, so the
 * glyph Chromium drew for 文 is mapped to U+2F42. Poppler (and so the per-job
 * conservation read-back) honours the `/ActualText` Skia writes beside it and
 * reads 文; pdf.js 6.2.108 ignores ActualText, and its `getTextContent` — the
 * text its text layer is built from — reads ⽂. Measured in the live worker
 * image: zh at delivery size read 8610/17220 Han correctly in pdf.js before
 * this rewrite and 17220/17220 after; 214 Kangxi-equivalent ideographs ×140
 * read 420/30000 (zh) and 280/30000 (ja) before. (Firefox's copy and find
 * layers normalise on top of pdf.js's text and were NOT measured.)
 *
 * ── THE TARGET IS A MEASURED GLYPH IDENTITY, PER FACE (review 2026-11-16) ──
 *
 * The first version rewrote every radical to its Unicode equivalent (UCD
 * EquivalentUnifiedIdeograph, which NFKC agrees with) in every face. That is
 * a MECHANISM; the property the rewrite needs is "the face that drew this
 * glyph sends the new code point to the SAME glyph". Measured in the image
 * (`radical-glyph-facts.json`, 30 faces), the two differ:
 *
 *   - U+2F3E ⼾ shares its glyph with 户 U+6237 in every SC face and with 戸
 *     U+6238 in every JP face — not with its equivalent 戶 U+6236. The UCD
 *     table made pdf.js read 用户 and 江戸 as 用戶 and 江戶: a different real
 *     character. Derived from the facts, SC rewrites to 户 and JP to 戸.
 *   - 0 to 11 radicals per face share their glyph with NO unified ideograph
 *     (Sans KR 9, Serif KR 11, Sans HK 0). Those are not rewritten.
 *   - No radical shares its glyph with two unified ideographs in any face.
 *
 * {@link radicalRewritesFor} derives the table for one face from those facts;
 * a face the facts do not name gets NO rewrite (pdf.js then reads radicals,
 * as before this slice, and the start-up probe's (e) `viewer_text` fails
 * visibly). The UCD table below is kept as an independent second bound: the
 * tests require every derived target to equal it except the listed
 * exceptions, so a generator bug cannot pass as a font fact.
 *
 * ── A RADICAL THE JOB'S TEXT CONTAINS IS NEVER REWRITTEN ────────────────────
 *
 * Skia writes ActualText only where the character drawn differs from the
 * glyph's ToUnicode entry. A LITERAL ⽂ matches the entry U+2F42, so it gets
 * no ActualText — and a rewritten entry would make poppler read 文 too, fail
 * the per-job conservation check, and lose the PDF (measured 2026-11-16: en
 * "Radical only: ⽂ here." delivered on main and failed `not_conserved` on
 * the first version). So `printAndCheck` passes the radicals in the typeset
 * text as exclusions: such an entry keeps its radical, and that job reads as
 * on main (pdf.js reads ⽂ both for ⽂ and for a 文 drawn with the same
 * glyph). Every job whose text holds no radical gets the rewrite.
 *
 * ── WHY NOT THE CJK RADICALS SUPPLEMENT (measured 2026-11-16) ───────────────
 *
 * The first version also mapped U+2E80–U+2EF3 by the same UCD file. In the
 * live image, Noto Sans CJK SC draws 彐 (U+5F50) with the glyph Skia maps to
 * U+2E95 (CJK RADICAL SNOUT TWO), whose UCD equivalent is U+2B739 𫜹 — so
 * pdf.js read 彐 as 𫜹, a DIFFERENT real ideograph, where before it read the
 * radical ⺕. The ideographs whose glyph a supplement radical shares still
 * read as that radical in pdf.js, exactly as before this rewrite. Measured
 * with the Kangxi-only UCD table, the 214 Kangxi-equivalent ideographs ×140
 * read 28740/30000 (zh; 9 distinct: 尢 幺 彐 角 長 食 骨 鬼 龜, read as ⺐ ⺓ ⺕
 * ⻆ ⻑ ⻝ ⻣ ⻤ ⻱) and 29580/30000 (ja; 尢 幺 長); 3000 distinct Han ×10 read
 * 29830/30000 (zh).
 *
 * ── THE UCD TABLE (the second bound) ────────────────────────────────────────
 *
 * Generated from Unicode's EquivalentUnifiedIdeograph.txt (UCD 18.0.0, dated
 * 2026-02-03), rows U+2F00–U+2FD5 only, by
 *
 *   pnpm exec tsx scripts/generate-radical-equivalents.ts <EquivalentUnifiedIdeograph-18.0.0.txt>
 *
 * Vendored, never fetched. `radical-equivalents.test.ts` holds it to its own
 * independent bound: all 214 Kangxi radicals present, each agreeing with
 * `String.fromCodePoint(k).normalize("NFKC")`, and nothing else.
 *
 * ── THE FACTS ───────────────────────────────────────────────────────────────
 *
 * `radical-glyph-facts.json`, written in the worker image by
 * `scripts/measure-cjk-radical-glyphs.ts` (its header has the command), and
 * re-measured against the image by `worker-translate-pdf-proof.ts`, which
 * fails when the image's faces no longer give the vendored facts.
 */
import FACTS_JSON from "./radical-glyph-facts.json";

export const KANGXI_FIRST = 0x2f00;
export const KANGXI_LAST = 0x2fd5;

/**
 * Measured glyph sharing: face PostScript name → radical (hex) → the OTHER
 * code points (hex, space-separated, ascending) the face's cmap sends to that
 * radical's glyph. A radical the face does not map is absent.
 */
export interface RadicalGlyphFacts {
  readonly faces: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * The vendored file's shape: faces with identical facts share one table
 * (30 faces, 10 distinct tables, measured 2026-11-16).
 */
export interface CompactRadicalGlyphFacts {
  readonly source: string;
  readonly tables: readonly Readonly<Record<string, string>>[];
  readonly faces: Readonly<Record<string, number>>;
}

export function expandFacts(
  compact: CompactRadicalGlyphFacts,
): RadicalGlyphFacts {
  const faces: Record<string, Readonly<Record<string, string>>> = {};
  for (const [name, index] of Object.entries(compact.faces)) {
    const table = compact.tables[index];
    if (!table) throw new Error(`radical glyph facts: ${name} names no table`);
    faces[name] = table;
  }
  return { faces };
}

export const RADICAL_GLYPH_FACTS: RadicalGlyphFacts = expandFacts(FACTS_JSON);

/** URO, Extension A, and Extensions B onward — not compatibility ideographs. */
export function isUnifiedIdeograph(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x323af && !(cp >= 0x2f800 && cp <= 0x2fa1f))
  );
}

export type RewriteTable = ReadonlyMap<number, number>;

/**
 * For one face (PostScript name, subset tag stripped): radical → the ONE
 * unified ideograph that shares its glyph there. A radical whose glyph no
 * unified ideograph shares, or more than one, is left out; a face the facts
 * do not name gives an empty table. `keep` removes radicals the job's own
 * text contains.
 */
export function radicalRewritesFor(
  face: string,
  keep: ReadonlySet<number> = new Set(),
  facts: RadicalGlyphFacts = RADICAL_GLYPH_FACTS,
): RewriteTable {
  const out = new Map<number, number>();
  const table = facts.faces[face];
  if (!table) return out;
  for (const [r, sharers] of Object.entries(table)) {
    const radical = parseInt(r, 16);
    if (keep.has(radical)) continue;
    const unified = sharers
      .split(" ")
      .filter(Boolean)
      .map((h) => parseInt(h, 16))
      .filter(isUnifiedIdeograph);
    if (unified.length === 1) out.set(radical, unified[0]!);
  }
  return out;
}

/** The Kangxi radicals a text literally contains. */
export function kangxiRadicalsIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= KANGXI_FIRST && cp <= KANGXI_LAST) out.add(cp);
  }
  return out;
}

/**
 * The UCD equivalents (the second bound, test-only at runtime): every
 * Kangxi radical → its EquivalentUnifiedIdeograph.txt target.
 */
// prettier-ignore
const PAIRS: readonly number[] = [
  // BEGIN GENERATED (scripts/generate-radical-equivalents.ts)
  // EquivalentUnifiedIdeograph-18.0.0.txt, 2026-02-03: 214 rows
  0x2F00, 0x4E00,
  0x2F01, 0x4E28,
  0x2F02, 0x4E36,
  0x2F03, 0x4E3F,
  0x2F04, 0x4E59,
  0x2F05, 0x4E85,
  0x2F06, 0x4E8C,
  0x2F07, 0x4EA0,
  0x2F08, 0x4EBA,
  0x2F09, 0x513F,
  0x2F0A, 0x5165,
  0x2F0B, 0x516B,
  0x2F0C, 0x5182,
  0x2F0D, 0x5196,
  0x2F0E, 0x51AB,
  0x2F0F, 0x51E0,
  0x2F10, 0x51F5,
  0x2F11, 0x5200,
  0x2F12, 0x529B,
  0x2F13, 0x52F9,
  0x2F14, 0x5315,
  0x2F15, 0x531A,
  0x2F16, 0x5338,
  0x2F17, 0x5341,
  0x2F18, 0x535C,
  0x2F19, 0x5369,
  0x2F1A, 0x5382,
  0x2F1B, 0x53B6,
  0x2F1C, 0x53C8,
  0x2F1D, 0x53E3,
  0x2F1E, 0x56D7,
  0x2F1F, 0x571F,
  0x2F20, 0x58EB,
  0x2F21, 0x5902,
  0x2F22, 0x590A,
  0x2F23, 0x5915,
  0x2F24, 0x5927,
  0x2F25, 0x5973,
  0x2F26, 0x5B50,
  0x2F27, 0x5B80,
  0x2F28, 0x5BF8,
  0x2F29, 0x5C0F,
  0x2F2A, 0x5C22,
  0x2F2B, 0x5C38,
  0x2F2C, 0x5C6E,
  0x2F2D, 0x5C71,
  0x2F2E, 0x5DDB,
  0x2F2F, 0x5DE5,
  0x2F30, 0x5DF1,
  0x2F31, 0x5DFE,
  0x2F32, 0x5E72,
  0x2F33, 0x5E7A,
  0x2F34, 0x5E7F,
  0x2F35, 0x5EF4,
  0x2F36, 0x5EFE,
  0x2F37, 0x5F0B,
  0x2F38, 0x5F13,
  0x2F39, 0x5F50,
  0x2F3A, 0x5F61,
  0x2F3B, 0x5F73,
  0x2F3C, 0x5FC3,
  0x2F3D, 0x6208,
  0x2F3E, 0x6236,
  0x2F3F, 0x624B,
  0x2F40, 0x652F,
  0x2F41, 0x6534,
  0x2F42, 0x6587,
  0x2F43, 0x6597,
  0x2F44, 0x65A4,
  0x2F45, 0x65B9,
  0x2F46, 0x65E0,
  0x2F47, 0x65E5,
  0x2F48, 0x66F0,
  0x2F49, 0x6708,
  0x2F4A, 0x6728,
  0x2F4B, 0x6B20,
  0x2F4C, 0x6B62,
  0x2F4D, 0x6B79,
  0x2F4E, 0x6BB3,
  0x2F4F, 0x6BCB,
  0x2F50, 0x6BD4,
  0x2F51, 0x6BDB,
  0x2F52, 0x6C0F,
  0x2F53, 0x6C14,
  0x2F54, 0x6C34,
  0x2F55, 0x706B,
  0x2F56, 0x722A,
  0x2F57, 0x7236,
  0x2F58, 0x723B,
  0x2F59, 0x723F,
  0x2F5A, 0x7247,
  0x2F5B, 0x7259,
  0x2F5C, 0x725B,
  0x2F5D, 0x72AC,
  0x2F5E, 0x7384,
  0x2F5F, 0x7389,
  0x2F60, 0x74DC,
  0x2F61, 0x74E6,
  0x2F62, 0x7518,
  0x2F63, 0x751F,
  0x2F64, 0x7528,
  0x2F65, 0x7530,
  0x2F66, 0x758B,
  0x2F67, 0x7592,
  0x2F68, 0x7676,
  0x2F69, 0x767D,
  0x2F6A, 0x76AE,
  0x2F6B, 0x76BF,
  0x2F6C, 0x76EE,
  0x2F6D, 0x77DB,
  0x2F6E, 0x77E2,
  0x2F6F, 0x77F3,
  0x2F70, 0x793A,
  0x2F71, 0x79B8,
  0x2F72, 0x79BE,
  0x2F73, 0x7A74,
  0x2F74, 0x7ACB,
  0x2F75, 0x7AF9,
  0x2F76, 0x7C73,
  0x2F77, 0x7CF8,
  0x2F78, 0x7F36,
  0x2F79, 0x7F51,
  0x2F7A, 0x7F8A,
  0x2F7B, 0x7FBD,
  0x2F7C, 0x8001,
  0x2F7D, 0x800C,
  0x2F7E, 0x8012,
  0x2F7F, 0x8033,
  0x2F80, 0x807F,
  0x2F81, 0x8089,
  0x2F82, 0x81E3,
  0x2F83, 0x81EA,
  0x2F84, 0x81F3,
  0x2F85, 0x81FC,
  0x2F86, 0x820C,
  0x2F87, 0x821B,
  0x2F88, 0x821F,
  0x2F89, 0x826E,
  0x2F8A, 0x8272,
  0x2F8B, 0x8278,
  0x2F8C, 0x864D,
  0x2F8D, 0x866B,
  0x2F8E, 0x8840,
  0x2F8F, 0x884C,
  0x2F90, 0x8863,
  0x2F91, 0x897E,
  0x2F92, 0x898B,
  0x2F93, 0x89D2,
  0x2F94, 0x8A00,
  0x2F95, 0x8C37,
  0x2F96, 0x8C46,
  0x2F97, 0x8C55,
  0x2F98, 0x8C78,
  0x2F99, 0x8C9D,
  0x2F9A, 0x8D64,
  0x2F9B, 0x8D70,
  0x2F9C, 0x8DB3,
  0x2F9D, 0x8EAB,
  0x2F9E, 0x8ECA,
  0x2F9F, 0x8F9B,
  0x2FA0, 0x8FB0,
  0x2FA1, 0x8FB5,
  0x2FA2, 0x9091,
  0x2FA3, 0x9149,
  0x2FA4, 0x91C6,
  0x2FA5, 0x91CC,
  0x2FA6, 0x91D1,
  0x2FA7, 0x9577,
  0x2FA8, 0x9580,
  0x2FA9, 0x961C,
  0x2FAA, 0x96B6,
  0x2FAB, 0x96B9,
  0x2FAC, 0x96E8,
  0x2FAD, 0x9751,
  0x2FAE, 0x975E,
  0x2FAF, 0x9762,
  0x2FB0, 0x9769,
  0x2FB1, 0x97CB,
  0x2FB2, 0x97ED,
  0x2FB3, 0x97F3,
  0x2FB4, 0x9801,
  0x2FB5, 0x98A8,
  0x2FB6, 0x98DB,
  0x2FB7, 0x98DF,
  0x2FB8, 0x9996,
  0x2FB9, 0x9999,
  0x2FBA, 0x99AC,
  0x2FBB, 0x9AA8,
  0x2FBC, 0x9AD8,
  0x2FBD, 0x9ADF,
  0x2FBE, 0x9B25,
  0x2FBF, 0x9B2F,
  0x2FC0, 0x9B32,
  0x2FC1, 0x9B3C,
  0x2FC2, 0x9B5A,
  0x2FC3, 0x9CE5,
  0x2FC4, 0x9E75,
  0x2FC5, 0x9E7F,
  0x2FC6, 0x9EA5,
  0x2FC7, 0x9EBB,
  0x2FC8, 0x9EC3,
  0x2FC9, 0x9ECD,
  0x2FCA, 0x9ED1,
  0x2FCB, 0x9EF9,
  0x2FCC, 0x9EFD,
  0x2FCD, 0x9F0E,
  0x2FCE, 0x9F13,
  0x2FCF, 0x9F20,
  0x2FD0, 0x9F3B,
  0x2FD1, 0x9F4A,
  0x2FD2, 0x9F52,
  0x2FD3, 0x9F8D,
  0x2FD4, 0x9F9C,
  0x2FD5, 0x9FA0,
  // END GENERATED
];

/** Radical code point → its equivalent unified ideograph. */
export const RADICAL_EQUIVALENTS: ReadonlyMap<number, number> = (() => {
  const map = new Map<number, number>();
  for (let i = 0; i + 1 < PAIRS.length; i += 2)
    map.set(PAIRS[i]!, PAIRS[i + 1]!);
  return map;
})();

const hexOf = (n: number, width: number, upper: boolean) => {
  const s = n.toString(16).padStart(width, "0");
  return upper ? s.toUpperCase() : s;
};

/** UTF-16BE hex → code points, or null when it is not whole code units. */
function decodeUtf16Hex(hex: string): number[] | null {
  if (hex.length % 4 !== 0 || hex.length === 0) return null;
  const units: number[] = [];
  for (let i = 0; i < hex.length; i += 4)
    units.push(parseInt(hex.slice(i, i + 4), 16));
  const out: number[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    const next = units[i + 1];
    if (
      u >= 0xd800 &&
      u <= 0xdbff &&
      next !== undefined &&
      next >= 0xdc00 &&
      next <= 0xdfff
    ) {
      out.push(0x10000 + ((u - 0xd800) << 10) + (next - 0xdc00));
      i++;
      continue;
    }
    out.push(u);
  }
  return out;
}

function encodeUtf16Hex(cps: readonly number[], upper: boolean): string {
  let s = "";
  for (const cp of cps) {
    if (cp >= 0x10000) {
      const v = cp - 0x10000;
      s +=
        hexOf(0xd800 + (v >> 10), 4, upper) +
        hexOf(0xdc00 + (v & 0x3ff), 4, upper);
    } else s += hexOf(cp, 4, upper);
  }
  return s;
}

const isUpper = (hex: string) => !/[a-f]/.test(hex);

/** A destination with every radical replaced, or null when it holds none. */
function rewriteDestination(hex: string, table: RewriteTable): string | null {
  const cps = decodeUtf16Hex(hex);
  if (!cps || !cps.some((cp) => table.has(cp))) return null;
  return encodeUtf16Hex(
    cps.map((cp) => table.get(cp) ?? cp),
    isUpper(hex),
  );
}

/** The CMap operators allow at most 100 entries per block. */
const ENTRY_LIMIT = 100;

function emitRangeBlocks(entries: readonly string[]): string {
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i += ENTRY_LIMIT) {
    const chunk = entries.slice(i, i + ENTRY_LIMIT);
    blocks.push(
      `${chunk.length} beginbfrange\n${chunk.join("\n")}\nendbfrange`,
    );
  }
  return blocks.join("\n");
}

/** One bfrange entry as one or more entries, or null when nothing changes. */
function rewriteRange(
  lo: string,
  hi: string,
  dst: string,
  table: RewriteTable,
): string[] | null {
  if (dst.startsWith("[")) {
    let changed = false;
    const next = dst.replace(/<([0-9A-Fa-f]+)>/g, (whole, hex: string) => {
      const r = rewriteDestination(hex, table);
      if (r === null) return whole;
      changed = true;
      return `<${r}>`;
    });
    return changed ? [`<${lo}> <${hi}> ${next}`] : null;
  }
  const hex = dst.slice(1, -1);
  // An incrementing destination steps its LAST code unit. Only a single BMP
  // unit can step onto a radical; a surrogate pair or a ligature never can.
  if (hex.length !== 4) return null;
  const start = parseInt(hex, 16);
  const a = parseInt(lo, 16);
  const b = parseInt(hi, 16);
  if (!(b >= a)) return null;
  let any = false;
  for (let i = 0; i <= b - a; i++) if (table.has(start + i)) any = true;
  if (!any) return null;
  const upper = isUpper(hex) && isUpper(lo) && isUpper(hi);
  const src = (n: number) => hexOf(n, lo.length, upper);
  const out: string[] = [];
  let runFrom: number | null = null;
  const flush = (end: number) => {
    if (runFrom === null) return;
    out.push(
      `<${src(runFrom)}> <${src(end)}> <${hexOf(start + (runFrom - a), 4, upper)}>`,
    );
    runFrom = null;
  };
  for (let code = a; code <= b; code++) {
    const unified = table.get(start + (code - a));
    if (unified === undefined) {
      runFrom ??= code;
      continue;
    }
    flush(code - 1);
    out.push(
      `<${src(code)}> <${src(code)}> <${encodeUtf16Hex([unified], upper)}>`,
    );
  }
  flush(b);
  return out;
}

/**
 * A ToUnicode CMap with every DESTINATION (a bfchar destination, a bfrange
 * start, or a bfrange array element) that is a key of `table` replaced by its
 * value — `table` is {@link radicalRewritesFor} the face that drew the font,
 * less the radicals the job's own text contains. A bfrange whose run crosses
 * a key is split around it. Every block that holds no key is left
 * byte-identical, and so is a CMap that holds none.
 */
export function normaliseRadicalToUnicode(
  cmap: string,
  table: RewriteTable,
): string {
  if (table.size === 0) return cmap;
  return cmap.replace(
    /(\d+)\s+beginbf(char|range)([\s\S]*?)endbf\2/g,
    (whole: string, _n: string, kind: string, body: string) => {
      if (kind === "char") {
        let changed = false;
        const next = body.replace(
          /<([0-9A-Fa-f]+)>(\s*)<([0-9A-Fa-f]+)>/g,
          (entry: string, src: string, gap: string, dst: string) => {
            const r = rewriteDestination(dst, table);
            if (r === null) return entry;
            changed = true;
            return `<${src}>${gap}<${r}>`;
          },
        );
        return changed ? whole.replace(body, next) : whole;
      }
      const entries: string[] = [];
      let changed = false;
      for (const m of body.matchAll(
        /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g,
      )) {
        const r = rewriteRange(m[1]!, m[2]!, m[3]!, table);
        if (r === null) entries.push(m[0]);
        else {
          changed = true;
          entries.push(...r);
        }
      }
      return changed ? emitRangeBlocks(entries) : whole;
    },
  );
}
