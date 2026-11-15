/**
 * Measure the glyph-sharing facts the ToUnicode rewrite is derived from
 * (`radical-glyph-facts.json`, read by `radical-equivalents.ts`): for every
 * CJK face fontconfig offers, and every Kangxi radical that face maps, the
 * OTHER code points its cmap sends to the same glyph.
 *
 * Run only by scripts (`measure-cjk-radical-glyphs.ts`, and the image proof
 * `worker-translate-pdf-proof.ts`), never by the render path: it opens every
 * CJK font file. The file set comes from the caller — the scripts derive it
 * from fontconfig (`scripts/cjk-font-files.ts`), so this module starts no
 * child process. A file fontkit cannot open throws; nothing is skipped.
 */
import { readFileSync } from "node:fs";
import type { FontkitCollection, FontkitFont } from "fontkit";
import {
  KANGXI_FIRST,
  KANGXI_LAST,
  type CompactRadicalGlyphFacts,
  type RadicalGlyphFacts,
} from "./radical-equivalents";

const hex = (n: number) => n.toString(16);

/** One face's facts: radical → the other code points on its glyph. */
export function faceFacts(font: FontkitFont): Record<string, string> {
  const byGlyph = new Map<number, number[]>();
  for (const cp of font.characterSet) {
    const id = font.glyphForCodePoint(cp).id;
    if (id === 0) continue;
    const list = byGlyph.get(id);
    if (list) list.push(cp);
    else byGlyph.set(id, [cp]);
  }
  const out: Record<string, string> = {};
  for (let r = KANGXI_FIRST; r <= KANGXI_LAST; r++) {
    if (!font.hasGlyphForCodePoint(r)) continue;
    const id = font.glyphForCodePoint(r).id;
    if (id === 0) continue;
    const sharers = (byGlyph.get(id) ?? [])
      .filter((cp) => cp !== r)
      .sort((a, b) => a - b);
    out[hex(r)] = sharers.map(hex).join(" ");
  }
  return out;
}

/** The facts for every face in `files` that maps a Kangxi radical. */
export async function measureRadicalGlyphFacts(
  files: readonly string[],
): Promise<RadicalGlyphFacts> {
  const fontkit = await import("fontkit");
  if (files.length === 0) throw new Error("no CJK font file to measure");
  const faces: Record<string, Record<string, string>> = {};
  for (const file of files) {
    const opened = fontkit.create(new Uint8Array(readFileSync(file))) as
      FontkitFont | FontkitCollection;
    const fonts = "fonts" in opened ? opened.fonts : [opened];
    for (const font of fonts) {
      const facts = faceFacts(font);
      if (Object.keys(facts).length > 0) faces[font.postscriptName] = facts;
    }
  }
  const sorted: Record<string, Record<string, string>> = {};
  for (const name of Object.keys(faces).sort()) sorted[name] = faces[name]!;
  return { faces: sorted };
}

/** The vendored shape: faces with identical facts share one table. */
export function compactFacts(
  facts: RadicalGlyphFacts,
  source: string,
): CompactRadicalGlyphFacts {
  const tables: Readonly<Record<string, string>>[] = [];
  const index = new Map<string, number>();
  const faces: Record<string, number> = {};
  for (const [name, table] of Object.entries(facts.faces)) {
    const key = JSON.stringify(table);
    let i = index.get(key);
    if (i === undefined) {
      i = tables.length;
      tables.push(table);
      index.set(key, i);
    }
    faces[name] = i;
  }
  return { source, tables, faces };
}

/** Every difference between vendored and measured facts, as lines. */
export function diffRadicalGlyphFacts(
  vendored: unknown,
  measured: RadicalGlyphFacts,
): string[] {
  const v = (vendored as Partial<RadicalGlyphFacts> | null)?.faces;
  if (!v || typeof v !== "object") return ["the vendored file has no faces"];
  const out: string[] = [];
  const names = new Set([...Object.keys(v), ...Object.keys(measured.faces)]);
  for (const name of [...names].sort()) {
    const a = v[name];
    const b = measured.faces[name];
    if (!a || !b) {
      out.push(`${name}: ${a ? "vendored only" : "measured only"}`);
      continue;
    }
    const radicals = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const r of [...radicals].sort())
      if (a[r] !== b[r])
        out.push(
          `${name} ${r}: vendored [${a[r] ?? "absent"}] measured [${b[r] ?? "absent"}]`,
        );
  }
  return out;
}
