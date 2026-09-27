/**
 * Proving that non-Latin text actually RENDERED, rather than that the call did
 * not throw.
 *
 * This project has shipped two silent blanks already — pdfjs `wasmUrl` (every
 * JPEG2000/JBIG2 image decoded to nothing) and `cMapUrl` (every non-embedded
 * CJK page completely blank). Both passed every test in the suite, because
 * every test asked "did it succeed" and none asked "is there ink". Non-Latin
 * rendering is exactly where this product's silent failures live, so a test
 * that draws Chinese and asserts no exception is not evidence of anything.
 *
 * THE CHAIN THIS FILE FOLLOWS, END TO END:
 *
 *   the characters the caller asked for
 *     -> the glyph ids actually written into the page's content stream
 *     -> the outlines those ids resolve to inside the EMBEDDED font subset
 *
 * Each hop is read back out of the saved bytes, not from the objects that
 * produced them. A page that came out blank breaks the chain in a way an
 * assertion can see: no `Tj`, or `.notdef`, or a glyph with no drawing commands.
 *
 * WHY THIS IS NEEDED AND NOT PARANOIA. `@pdf-lib/fontkit@1.1.1` — the subsetter
 * pdf-lib's own documentation points at — passes "it did not throw" for every
 * one of these strings and produces a file in which most glyphs render as
 * nothing. Measured in Chromium: "机密文件测试" came out as "件". The chain below
 * is what caught it — {@link proveGlyphs} reports non-empty `unreadableIds` and
 * `emptyOutlineIds` for that file and empty ones for what upstream fontkit
 * writes.
 *
 * WHAT IT IS NOT. It reads structure, not pixels. It cannot see a glyph that is
 * present and wrong-shaped, or one positioned off the page.
 * `e2e/unicode-fonts.spec.ts` rasterises in a real browser and counts ink for
 * that half.
 */
import { inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";
import {
  FONT_PACKS,
  type FontPack,
  type FontPackId,
  type MonospaceClaim,
} from "@/lib/pdf/font-packs";
import { openNotoFont, readNotoTtf } from "@/lib/pdf/noto-source";
import { setFontByteSource, resetFontCache } from "@/lib/pdf/unicode-font";

/**
 * Point the font loader at the same TTFs `scripts/copy-noto-fonts.ts` copies
 * into `public/`, so a test embeds the file a browser would have downloaded.
 *
 * The bound, stated because it is easy to forget: this proves the EMBEDDING.
 * It does not prove the asset is served — `e2e/unicode-fonts.spec.ts` fetches
 * the real URL off the real server for that.
 */
export function useNodeFontSource(): () => void {
  const previous = setFontByteSource(async (pack: FontPack) =>
    readNotoTtf(pack),
  );
  resetFontCache();
  return () => {
    setFontByteSource(previous);
    resetFontCache();
  };
}

/** Inflate a FlateDecode stream, or return it as-is when it is not compressed. */
function inflateMaybe(raw: Uint8Array): Uint8Array {
  try {
    return new Uint8Array(inflateSync(Buffer.from(raw)));
  } catch {
    return raw;
  }
}

function rawBytes(stream: PDFRawStream): Uint8Array {
  return (stream as unknown as { contents: Uint8Array }).contents;
}

/** Every page content stream in the document, decompressed and concatenated. */
function contentStreamText(doc: PDFDocument): string {
  const chunks: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.get(PDFName.of("Contents"));
    if (!contents) continue;
    const resolved = doc.context.lookup(contents);
    const streams: PDFRawStream[] = [];
    if (resolved instanceof PDFArray) {
      for (let i = 0; i < resolved.size(); i++) {
        const entry = doc.context.lookup(resolved.get(i));
        if (entry instanceof PDFRawStream) streams.push(entry);
      }
    } else if (resolved instanceof PDFRawStream) {
      streams.push(resolved);
    }
    for (const stream of streams) {
      chunks.push(
        Buffer.from(inflateMaybe(rawBytes(stream))).toString("latin1"),
      );
    }
  }
  return chunks.join("\n");
}

/**
 * The glyph ids the page actually shows.
 *
 * pdf-lib writes one `<hex> Tj` per `drawText`, and a CID font's hex string is
 * four hex digits per glyph. `TJ` arrays are read too — nothing here emits them
 * today, and a reader that silently returned nothing for them would report a
 * blank page as "no glyphs, therefore nothing to check".
 */
export function drawnGlyphIds(content: string): number[] {
  const ids: number[] = [];
  const push = (hex: string) => {
    for (let i = 0; i + 4 <= hex.length; i += 4) {
      ids.push(parseInt(hex.slice(i, i + 4), 16));
    }
  };
  for (const match of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g))
    push(match[1]!);
  for (const match of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    for (const inner of match[1]!.matchAll(/<([0-9A-Fa-f]+)>/g))
      push(inner[1]!);
  }
  return ids;
}

/** Every embedded TrueType font programme in the document. */
export function embeddedFontFiles(doc: PDFDocument): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    const ref = object.get(PDFName.of("FontFile2"));
    if (!(ref instanceof PDFRef)) continue;
    const stream = doc.context.lookup(ref);
    if (stream instanceof PDFRawStream) {
      out.push(inflateMaybe(rawBytes(stream)));
    }
  }
  return out;
}

/**
 * The `/ToUnicode` CMap, as glyph id -> the characters it stands for.
 *
 * Two jobs. It is what makes the output searchable and copy-pasteable, so its
 * absence is a defect in its own right. And it is how this file tells a blank
 * glyph that SHOULD be blank (a space) from one that should not — without it,
 * the proof would either reject every string containing a space or wave through
 * whichever blanks happened to appear.
 */
export function toUnicodeMap(doc: PDFDocument): Map<number, string> {
  const map = new Map<number, string>();
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    const ref = object.get(PDFName.of("ToUnicode"));
    if (!(ref instanceof PDFRef)) continue;
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    readToUnicodeStream(stream, map);
  }
  return map;
}

function readToUnicodeStream(
  stream: PDFRawStream,
  map: Map<number, string>,
): void {
  const text = Buffer.from(inflateMaybe(rawBytes(stream))).toString("latin1");
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1]!.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
    )) {
      map.set(parseInt(pair[1]!, 16), utf16beToString(pair[2]!));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const row of block[1]!.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
    )) {
      const lo = parseInt(row[1]!, 16);
      const hi = parseInt(row[2]!, 16);
      const start = parseInt(row[3]!, 16);
      for (let id = lo; id <= hi; id++) {
        map.set(id, String.fromCodePoint(start + (id - lo)));
      }
    }
  }
}

/** One embedded (Type0) face, as a reader of the saved file receives it. */
export interface EmbeddedFace {
  readonly baseFont: string;
  /** The characters this face draws, per `/ToUnicode`. */
  readonly characters: string;
  /**
   * Advance width, in the EMBEDDED subset's own units, of every glyph the face
   * maps to a character. One distinct value means the face is monospaced for
   * everything it draws in this file; that is the property a column of `tree`
   * output depends on, and it is read from the bytes, not from a font's name.
   */
  readonly advanceWidths: ReadonlySet<number>;
  /**
   * Characters whose glyph in the subset has no drawing commands although the
   * character is not whitespace — blanks where a letter should be. The same
   * question {@link proveGlyphs} asks, per face.
   */
  readonly blankCharacters: readonly string[];
}

/**
 * Every embedded Unicode face in a saved PDF, each with the characters it
 * draws and the widths of their glyphs.
 *
 * Per face, where {@link proveGlyphs} insists on exactly one: a document that
 * sets code in a monospace face and prose in a proportional one legitimately
 * carries two, and the question is which face drew which characters.
 */
export async function embeddedFaces(
  bytes: Uint8Array,
): Promise<EmbeddedFace[]> {
  const doc = await PDFDocument.load(bytes);
  const out: EmbeddedFace[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (object.get(PDFName.of("Subtype"))?.toString() !== "/Type0") continue;
    const unicode = new Map<number, string>();
    const toUnicode = doc.context.lookup(object.get(PDFName.of("ToUnicode")));
    if (toUnicode instanceof PDFRawStream) {
      readToUnicodeStream(toUnicode, unicode);
    }
    const descendants = doc.context.lookup(
      object.get(PDFName.of("DescendantFonts")),
    );
    if (!(descendants instanceof PDFArray)) continue;
    const cidFont = doc.context.lookup(descendants.get(0));
    if (!(cidFont instanceof PDFDict)) continue;
    const descriptor = doc.context.lookup(
      cidFont.get(PDFName.of("FontDescriptor")),
    );
    if (!(descriptor instanceof PDFDict)) continue;
    const file = doc.context.lookup(descriptor.get(PDFName.of("FontFile2")));
    if (!(file instanceof PDFRawStream)) continue;
    const subset = await openNotoFont(inflateMaybe(rawBytes(file)));
    const advanceWidths = new Set<number>();
    const blankCharacters: string[] = [];
    for (const [id, text] of unicode) {
      const glyph = subset.getGlyph(id);
      advanceWidths.add(glyph.advanceWidth);
      if (glyph.path.commands.length === 0 && text.trim() !== "") {
        blankCharacters.push(text);
      }
    }
    out.push({
      baseFont: String(object.get(PDFName.of("BaseFont"))),
      characters: [...unicode.values()].join(""),
      advanceWidths,
      blankCharacters,
    });
  }
  return out;
}

function utf16beToString(hex: string): string {
  let out = "";
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  }
  return out;
}

export interface GlyphProof {
  /** Glyph ids referenced by the page content, in order. */
  readonly glyphIds: number[];
  /** How many embedded TrueType programmes the file carries. */
  readonly embeddedFonts: number;
  /** Referenced ids that are `.notdef` — always blank on the page. */
  readonly notdefIds: number[];
  /** Referenced ids the embedded font could not resolve at all. */
  readonly unreadableIds: number[];
  /**
   * Referenced ids with no drawing commands whose `/ToUnicode` text is NOT
   * whitespace — i.e. blanks that should have been letters. A space is
   * legitimately empty and is not counted here.
   */
  readonly emptyOutlineIds: number[];
  /** Referenced ids absent from `/ToUnicode`: drawn but not copy-pasteable. */
  readonly untranslatableIds: number[];
  /** Total drawing commands across every referenced glyph — the "ink" proxy. */
  readonly outlineCommands: number;
  /** The text `/ToUnicode` says the page shows, in drawing order. */
  readonly extractedText: string;
}

/**
 * Follow the chain on a saved PDF and report every way it could be blank.
 *
 * Deliberately returns counts rather than a boolean: a caller asserting
 * `emptyOutlineIds` is empty says something a reader can check, while a helper
 * that answered `true` would hide which hop failed — and the hop is the whole
 * diagnosis.
 */
export async function proveGlyphs(bytes: Uint8Array): Promise<GlyphProof> {
  const doc = await PDFDocument.load(bytes);
  const glyphIds = drawnGlyphIds(contentStreamText(doc));
  const files = embeddedFontFiles(doc);
  const unicode = toUnicodeMap(doc);
  const extractedText = glyphIds.map((id) => unicode.get(id) ?? "").join("");
  if (files.length !== 1) {
    return {
      glyphIds,
      embeddedFonts: files.length,
      notdefIds: [],
      unreadableIds: [],
      emptyOutlineIds: [],
      untranslatableIds: [],
      outlineCommands: 0,
      extractedText,
    };
  }
  const subset = await openNotoFont(files[0]!);
  const notdefIds: number[] = [];
  const unreadableIds: number[] = [];
  const emptyOutlineIds: number[] = [];
  const untranslatableIds: number[] = [];
  let outlineCommands = 0;
  for (const id of glyphIds) {
    const text = unicode.get(id);
    if (text === undefined) untranslatableIds.push(id);
    if (id === 0) {
      notdefIds.push(id);
      continue;
    }
    let commands: number;
    try {
      commands = subset.getGlyph(id).path.commands.length;
    } catch {
      unreadableIds.push(id);
      continue;
    }
    // A space is legitimately empty. Anything else that draws nothing is a
    // character the reader will not see.
    const isBlankByDesign = text !== undefined && text.trim() === "";
    if (commands === 0 && !isBlankByDesign) emptyOutlineIds.push(id);
    outlineCommands += commands;
  }
  return {
    glyphIds,
    embeddedFonts: files.length,
    notdefIds,
    unreadableIds,
    emptyOutlineIds,
    untranslatableIds,
    outlineCommands,
    extractedText,
  };
}

/** The pack a test wants, by id. */
export function packById(id: FontPackId): FontPack {
  const pack = FONT_PACKS.find((entry) => entry.id === id);
  if (!pack) throw new Error(`no font pack ${id}`);
  return pack;
}

/**
 * Every character a {@link MonospaceClaim} promises, expanded from a
 * definition that exists without our font: a Windows code page through the
 * WHATWG decoder, a whole Unicode block, or the literal characters printed.
 *
 * Graphic characters only — letters, digits, punctuation, symbols, spaces.
 * Controls and format characters are not text a reader sees; the one format
 * character
 * this drops from the code pages is U+00AD SOFT HYPHEN, which Geist Mono does
 * not carry (see `font-packs.test.ts`, which pins that exclusion by name).
 * U+FFFD is dropped too: it is what the decoder returns for a byte the code
 * page leaves undefined, not a member of it.
 */
export function monospaceClaimMembers(claim: MonospaceClaim): string[] {
  const graphic = /[\p{L}\p{N}\p{P}\p{S}\p{Zs}]/u;
  const REPLACEMENT = String.fromCharCode(0xfffd);
  const out = new Set<string>();
  const { members } = claim;
  if ("codePages" in members) {
    for (const label of members.codePages) {
      const decoded = new TextDecoder(label).decode(
        Uint8Array.from({ length: 256 }, (_, i) => i),
      );
      for (const ch of decoded) if (ch !== REPLACEMENT) out.add(ch);
    }
  } else if ("block" in members) {
    const [lo, hi] = members.block;
    for (let cp = lo; cp <= hi; cp++) out.add(String.fromCodePoint(cp));
  } else {
    for (const ch of members.characters) out.add(ch);
  }
  return [...out].filter((ch) => graphic.test(ch));
}
