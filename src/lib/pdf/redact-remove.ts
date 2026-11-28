import { PdfEngineError, pdfLoadError } from "./engine";
import { loadPdfLib } from "./pdf-lib";
import { loadPdf, stampProducer } from "./stamp";
import { viewerFrame } from "./page-frame";
import { browserJpegDecoder } from "./editor/jpeg-pixels";
import {
  applyContentEdits,
  pruneUnreachable,
  type ContentEditOptions,
  type RedactRequest,
} from "./editor/content-edit";
import { rectAnchor, viewerRectToContent } from "./editor/geometry";
import type { RedactionFill, RedactionRect } from "./redact-defaults";
import { REDACT_METHODS } from "./redact-output";
import { validateRedactions } from "./redact";
import {
  PLAIN_TEXT_ATTACHMENT_EXTENSIONS,
  PLAIN_TEXT_ATTACHMENT_TYPES,
  plainTextAttachmentList,
} from "./redact-attachment-formats";
import {
  readRedactText,
  searchPattern,
  type FoundText,
  type SearchOptions,
} from "./redact-find";
import type { PdfTextReader } from "./text";
import { loadPdfjs } from "./pdfjs";
import type {
  PDFDict as PdfDict,
  PDFDocument,
  PDFObject,
  PDFRawStream as PDFRawStreamT,
} from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";

/**
 * Redact PDF's "Remove text under boxes" method: the engine Edit PDF's Redact
 * applies (`editor/content-edit.ts`) — the glyphs under each box are taken
 * out of the page's content stream, the pixels of any picture under it are
 * overwritten in a copy of that picture, the annotations under it are
 * removed, objects nothing refers to any more are dropped, and then the box
 * is filled. Everything else stays as it was: text, links, bookmarks and
 * document properties outside the boxes — except that a match chosen from
 * Find text or Detect personal data is also taken out of the places a reader
 * sees it off the page ({@link scrubOffPage}): the document properties and
 * XMP, bookmark titles, and the comments that carry it (those are removed).
 *
 * What that engine cannot do safely it refuses (vertical text, an inline
 * image or nested content under a box, a form field under a box, an image
 * format it cannot rewrite), and the refusal reaches the user — the "Flatten
 * every page" method handles all of those, by rebuilding each page as an
 * image (`redact.ts`).
 *
 * The result is checked before it is returned: every match the user chose
 * from Find text or Detect personal data is searched for again in the
 * OUTPUT's text, and in every string and XMP packet of the OUTPUT's objects
 * ({@link offPageHit}) — a form field's value, a link, an attachment's name —
 * and if any is still there the redaction fails rather than handing back a
 * file that still contains it.
 */

export interface RemovalBox extends RedactionRect {
  /**
   * Placed from a text match. Its box is the matched glyphs' own cells, so
   * it is pulled in a hair at each side and a tenth top and bottom: a glyph
   * on the next line or in the next word that merely touches the box is not
   * removed with it (removal takes every glyph a box OVERLAPS).
   */
  fromText?: boolean;
}

export interface RemovalOptions {
  rects: readonly RemovalBox[];
  fill?: RedactionFill;
  /**
   * The matches the boxes came from: each must be absent from the output.
   * `match` is how each was found, and off the page it is matched the same
   * way (a case-insensitive Find also takes "JANE" out of the Title; a
   * whole-word one leaves "Janeway" alone).
   */
  verify?: readonly Pick<FoundText, "page" | "text" | "match">[];
  /** The pdf.js build the verification reads with (tests pass the legacy one). */
  loadReader?: PdfTextReader;
}

export interface RemovalResult {
  bytes: Uint8Array;
  pageCount: number;
  redactionCount: number;
  /**
   * Matches searched for again in the output — its page text and every
   * string and XMP packet in its objects — and not found.
   */
  verified: number;
}

const INSET_X = 0.1;
const INSET_Y = 0.1;

const FLATTEN_LABEL = REDACT_METHODS.find((m) => m.id === "flatten")!.label;

/** Occurrences of `text` in a page's text, matched as Find text matches. */
function countOn(pageText: string, text: string): number {
  const pattern = searchPattern(text, { matchCase: true, wholeWord: false });
  if (!pattern) return 0;
  return [...pageText.matchAll(pattern)].length;
}

/** What a chosen match is replaced with in a string it is taken out of. */
export const SCRUBBED_TEXT = "[redacted]";

/** A chosen text, and how it was matched on the page. */
interface Chosen {
  text: string;
  match: SearchOptions;
}

/**
 * The patterns a chosen text is looked for with off the page: `plain` for a
 * PDF string, `xml` for the raw text of an XMP packet, where "&" may be
 * written "&amp;" and "'" "&apos;" or "&#39;".
 */
function offPagePatterns(chosen: readonly Chosen[]): {
  text: string;
  plain: RegExp;
  xml: RegExp;
}[] {
  return chosen.flatMap(({ text, match }) => {
    const plain = searchPattern(text, match);
    const xml = searchPattern(text, match, { xml: true });
    return plain && xml ? [{ text, plain, xml }] : [];
  });
}

function decodePacket(lib: PdfLibModule, stream: PDFRawStreamT): string {
  try {
    return new TextDecoder().decode(lib.decodePDFRawStream(stream).decode());
  } catch {
    // A packet whose filter cannot be decoded is read as stored.
    return new TextDecoder().decode(stream.contents);
  }
}

/**
 * Keys whose strings are not text a person wrote (dates, file IDs, unique
 * annotation names): a chosen "2024" must not rewrite a CreationDate or fail
 * the check on one.
 */
const NOT_TEXT = new Set(["CreationDate", "ModDate", "M", "ID", "NM"]);

function stringText(
  lib: PdfLibModule,
  o: PDFObject | undefined,
): string | null {
  return o instanceof lib.PDFString || o instanceof lib.PDFHexString
    ? o.decodeText()
    : null;
}

function anyMatch(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => {
    p.lastIndex = 0;
    return p.test(value);
  });
}

/**
 * Take every chosen string out of what a reader sees off the page: the
 * document properties (Info) and XMP have it replaced with
 * {@link SCRUBBED_TEXT}, so do bookmark titles, and a comment that carries it
 * (in its text, author or subject) is removed with its pop-up — a comment's
 * appearance can draw the text, so rewriting its /Contents alone would not
 * take it out. Form fields are left to the check ({@link offPageHit}): their
 * value is drawn by an appearance this cannot rewrite.
 */
function scrubOffPage(
  lib: PdfLibModule,
  doc: PDFDocument,
  chosen: readonly Chosen[],
): void {
  const { PDFDict, PDFArray, PDFName, PDFHexString, PDFRawStream } = lib;
  const found = offPagePatterns(chosen);
  if (found.length === 0) return;
  const patterns = found.map((f) => f.plain);
  const xmlPatterns = found.map((f) => f.xml);
  const scrubWith = (value: string, ps: readonly RegExp[]) =>
    ps.reduce((v, p) => v.replace(p, SCRUBBED_TEXT), value);
  const scrub = (value: string) => scrubWith(value, patterns);
  const scrubEntry = (dict: PdfDict, key: string) => {
    const name = PDFName.of(key);
    const value = stringText(lib, dict.lookup(name));
    if (value !== null && anyMatch(value, patterns)) {
      dict.set(name, PDFHexString.fromText(scrub(value)));
    }
  };
  const ctx = doc.context;

  const info = ctx.lookup(ctx.trailerInfo.Info);
  if (info instanceof PDFDict) {
    for (const [key] of info.entries()) {
      if (!NOT_TEXT.has(key.decodeText())) scrubEntry(info, key.decodeText());
    }
  }

  const xmpName = PDFName.of("Metadata");
  const xmp = doc.catalog.lookup(xmpName);
  if (xmp instanceof PDFRawStream) {
    // A packet that cannot be decoded is read as stored, and left to the
    // check if that is not text.
    const packet = decodePacket(lib, xmp);
    if (anyMatch(packet, xmlPatterns)) {
      doc.catalog.set(
        xmpName,
        ctx.register(
          ctx.stream(scrubWith(packet, xmlPatterns), {
            Type: "Metadata",
            Subtype: "XML",
          }),
        ),
      );
    }
  }

  const seen = new Set<PDFObject>();
  const walk = (node: PDFObject | undefined) => {
    for (
      let item = node;
      item instanceof PDFDict && !seen.has(item);
      item = item.lookup(PDFName.of("Next"))
    ) {
      seen.add(item);
      scrubEntry(item, "Title");
      walk(item.lookup(PDFName.of("First")));
    }
  };
  const outlines = doc.catalog.lookup(PDFName.of("Outlines"));
  if (outlines instanceof PDFDict) walk(outlines.lookup(PDFName.of("First")));

  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    const entries = annots.asArray();
    const dicts = entries.map((a) => ctx.lookup(a));
    const dropped = new Set<PDFObject>();
    dicts.forEach((d, i) => {
      if (!(d instanceof PDFDict)) return;
      if (d.get(PDFName.of("Subtype")) === PDFName.of("Widget")) return;
      const carries = ["Contents", "T", "Subj", "RC"].some((k) => {
        const v = stringText(lib, d.lookup(PDFName.of(k)));
        return v !== null && anyMatch(v, patterns);
      });
      if (!carries) return;
      dropped.add(entries[i]!);
      dropped.add(d);
      const popup = d.get(PDFName.of("Popup"));
      if (popup) dropped.add(popup);
    });
    if (dropped.size === 0) continue;
    const kept = entries.filter((a, i) => {
      const d = dicts[i];
      if (dropped.has(a) || (d && dropped.has(d))) return false;
      const parent = d instanceof PDFDict ? d.get(PDFName.of("Parent")) : null;
      return !(parent && dropped.has(parent));
    });
    page.node.set(PDFName.of("Annots"), ctx.obj(kept));
  }
}

/**
 * An attached file's bytes as the texts a chosen match could be written in,
 * or `null` when they cannot be read as text — and so cannot be checked. A
 * UTF-16 file is told by its byte-order mark; any other file is text when it
 * has no NUL and next to no other control bytes, and is then read both as
 * UTF-8 and as Latin-1 (windows-1252), so a name in either is seen.
 */
export function attachmentTexts(bytes: Uint8Array): string[] | null {
  const bom16 =
    bytes.length >= 2 &&
    ((bytes[0] === 0xfe && bytes[1] === 0xff) ||
      (bytes[0] === 0xff && bytes[1] === 0xfe));
  if (bom16)
    return [
      new TextDecoder(bytes[0] === 0xfe ? "utf-16be" : "utf-16le").decode(
        bytes,
      ),
    ];
  let control = 0;
  for (const b of bytes) {
    if (b === 0) return null;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) control++;
  }
  if (control > bytes.length / 100) return null;
  return [
    new TextDecoder().decode(bytes),
    new TextDecoder("latin1").decode(bytes),
  ];
}

/**
 * The attachment formats whose raw text IS their content, so a plain search
 * of the bytes is a search of what a reader sees: by file extension, and by
 * the stream's recorded /Subtype when it has one. Any other format can spell
 * a name another way (an HTML or XML entity, a JSON escape, a base64 e-mail
 * body, an RTF control word), so a plain search can miss it, and such an
 * attachment is treated as one that cannot be checked (review 2026-11-28,
 * finding 1: letter.html, data.json and message.eml were each saved with the
 * name inside; redact-attachments.test.ts).
 */
const PLAIN_TEXT_EXTENSIONS = new Set<string>(PLAIN_TEXT_ATTACHMENT_EXTENSIONS);
const PLAIN_TEXT_TYPES = new Set<string>(PLAIN_TEXT_ATTACHMENT_TYPES);

function plainTextAttachment(name: string, subtype: string | null): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  if (!PLAIN_TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase()))
    return false;
  return subtype === null || PLAIN_TEXT_TYPES.has(subtype.toLowerCase());
}

/**
 * Every file attached to the document: each embedded-file stream an /EF
 * dictionary names (under its file's /UF or /F name), then any stream that
 * calls itself /Type /EmbeddedFile and no /EF named (it has no name, so it
 * cannot be checked). Its bytes are decoded through the stream's filters;
 * one that is not a plain-text format ({@link plainTextAttachment}), cannot
 * be decoded, or cannot be read as text has `texts: null`.
 */
function attachedFiles(
  lib: PdfLibModule,
  doc: PDFDocument,
): { name: string; texts: string[] | null }[] {
  const { PDFArray, PDFDict, PDFName, PDFRawStream } = lib;
  const ctx = doc.context;
  const files: { name: string; texts: string[] | null }[] = [];
  const seen = new Set<PDFRawStreamT>();
  const read = (stream: PDFRawStreamT, name: string): string[] | null => {
    const subtype = stream.dict.get(PDFName.of("Subtype"));
    const type = subtype instanceof PDFName ? subtype.decodeText() : null;
    if (!plainTextAttachment(name, type)) return null;
    try {
      return attachmentTexts(lib.decodePDFRawStream(stream).decode());
    } catch {
      return null;
    }
  };
  const objects = ctx.enumerateIndirectObjects().map(([, o]) => o);
  // Every dictionary in the file, not only the top-level ones: a filespec
  // may be written inline — in a FileAttachment annotation's /FS, or in the
  // EmbeddedFiles name tree — over a stream with no /Type (the key is
  // optional), and neither pass below saw that shape (verify 2026-11-28,
  // redact-attachments.test.ts "inline filespec"). References are not
  // followed: what they point at is an indirect object, walked on its own.
  const dicts: PdfDict[] = [];
  const stack: PDFObject[] = [...objects];
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRawStream) stack.push(o.dict);
    else if (o instanceof PDFDict) {
      dicts.push(o);
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) stack.push(...o.asArray());
  }
  for (const obj of dicts) {
    const ef = obj.lookup(PDFName.of("EF"));
    if (!(ef instanceof PDFDict)) continue;
    const name =
      stringText(lib, obj.lookup(PDFName.of("UF"))) ??
      stringText(lib, obj.lookup(PDFName.of("F"))) ??
      "unnamed";
    for (const [, ref] of ef.entries()) {
      const stream = ctx.lookup(ref);
      if (!(stream instanceof PDFRawStream) || seen.has(stream)) continue;
      seen.add(stream);
      files.push({ name, texts: read(stream, name) });
    }
  }
  for (const obj of objects) {
    if (
      obj instanceof PDFRawStream &&
      !seen.has(obj) &&
      obj.dict.get(PDFName.of("Type")) === PDFName.of("EmbeddedFile")
    ) {
      seen.add(obj);
      files.push({ name: "unnamed", texts: read(obj, "unnamed") });
    }
  }
  return files;
}

/**
 * Where a chosen string is still in a saved file outside its page text: every
 * string in every object (a form field's value, a link, an attachment's name,
 * and what {@link scrubOffPage} rewrote), every XMP packet, and the CONTENTS
 * of every attached file ({@link attachedFiles}; added 2026-11-22, audit
 * redact-pdf#1 — until then an attachment's bytes were skipped, so a name in
 * an attached notes.txt was saved while the result said it was not in the
 * file). An attached file that cannot be read as text cannot be checked, and
 * is reported as such. Page content streams are not read here — the page
 * text check covers them, through the reader a person would use. Read from
 * the OUTPUT bytes, not from the document that wrote them. Returns the
 * sentence that says why the file was not saved, or `null`.
 */
async function offPageHit(
  lib: PdfLibModule,
  bytes: Uint8Array,
  chosen: readonly Chosen[],
): Promise<string | null> {
  const { PDFDict, PDFArray, PDFName, PDFRawStream } = lib;
  // Not `loadPdf`: its default `updateMetadata` would write pdf-lib's own
  // Producer and Creator over the output's before they are read.
  let out: PDFDocument;
  try {
    out = await lib.PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    throw await pdfLoadError(err, bytes);
  }
  const where = (key: string | null): string => {
    switch (key) {
      case "V":
      case "DV":
      case "T":
      case "TU":
        return "a form field";
      case "URI":
        return "a link";
      case "F":
      case "UF":
      case "Desc":
        return "an attached file";
      case "XMP":
        return "the document's XMP metadata";
      default:
        return "the file's hidden data";
    }
  };
  const roots: [PDFObject, string | null][] = [];
  for (const [, obj] of out.context.enumerateIndirectObjects()) {
    roots.push([obj, null]);
  }
  const info = out.context.trailerInfo.Info;
  if (info) roots.push([info, null]);
  const notSaved = `so the file was not saved. Choose “${FLATTEN_LABEL}” instead`;
  const files = attachedFiles(lib, out);
  for (const { text, plain: pattern, xml } of offPagePatterns(chosen)) {
    for (const file of files) {
      if (file.texts === null)
        return `The attached file “${file.name}” could not be checked for “${text}” (only plain ${plainTextAttachmentList("and")} files can be), ${notSaved}, which leaves attached files out.`;
      if (file.texts.some((t) => anyMatch(t, [pattern])))
        return `“${text}” is still in the attached file “${file.name}”, ${notSaved}, which leaves attached files out.`;
    }
    const stack = [...roots];
    while (stack.length) {
      const [o, key] = stack.pop()!;
      if (key !== null && NOT_TEXT.has(key)) continue;
      const value = stringText(lib, o);
      if (value !== null) {
        if (anyMatch(value, [pattern]))
          return `“${text}” is still in the file outside the page text (in ${where(key)}), ${notSaved}.`;
      } else if (o instanceof PDFDict) {
        for (const [k, v] of o.entries()) stack.push([v, k.decodeText()]);
      } else if (o instanceof PDFArray) {
        for (const v of o.asArray()) stack.push([v, key]);
      } else if (o instanceof PDFRawStream) {
        stack.push([o.dict, null]);
        if (o.dict.get(PDFName.of("Type")) !== PDFName.of("Metadata")) continue;
        const packet = decodePacket(lib, o);
        if (anyMatch(packet, [xml]))
          return `“${text}” is still in the file outside the page text (in ${where("XMP")}), ${notSaved}.`;
      }
    }
  }
  return null;
}

export async function redactPdfByRemoval(
  bytes: Uint8Array,
  options: RemovalOptions,
  editOptions: ContentEditOptions = { decodeJpeg: browserJpegDecoder() },
): Promise<RemovalResult> {
  const rects = options.rects;
  if (rects.length === 0) {
    throw new PdfEngineError(
      "Add at least one redaction area before redacting.",
    );
  }
  const lib = await loadPdfLib();
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const frames = pages.map((page) => viewerFrame(page));
  const issues = validateRedactions(
    [...rects],
    frames.map((f) => ({ width: f.width, height: f.height })),
  );
  if (issues.length > 0) throw new PdfEngineError(issues[0]!.message);

  const loadReader = options.loadReader ?? loadPdfjs;
  const verify = options.verify ?? [];
  // How often each chosen string is on its page BEFORE, so a second copy the
  // user left unticked is not mistaken for a failed removal.
  const before =
    verify.length > 0 ? await readRedactText(bytes, loadReader) : null;

  const fill = options.fill ?? "black";
  // Viewer frame: top-left origin, y down — the frame Edit PDF's boxes use.
  const boxes = rects.map((r) => {
    const frame = frames[r.page - 1]!;
    const dx = r.fromText ? Math.min(INSET_X, r.width / 4) : 0;
    const dy = r.fromText ? r.height * INSET_Y : 0;
    return {
      page: r.page - 1,
      x: r.x + dx,
      y: frame.height - (r.y + r.height) + dy,
      width: r.width - 2 * dx,
      height: r.height - 2 * dy,
    };
  });

  try {
    for (let i = 0; i < pages.length; i++) {
      const redact: RedactRequest[] = boxes
        .filter((b) => b.page === i)
        .map((b, k) => ({
          id: `redact-${i}-${k}`,
          box: viewerRectToContent(b, frames[i]!),
          fill,
        }));
      if (redact.length === 0) continue;
      await applyContentEdits(lib, doc, pages[i]!, i, [], redact, editOptions);
    }
  } catch (err) {
    if (err instanceof PdfEngineError) {
      throw new PdfEngineError(
        err.message.replace(
          /Use Redact PDF, which flattens the page\.?/,
          `Choose “${FLATTEN_LABEL}” instead.`,
        ),
      );
    }
    throw err;
  }
  const chosenTexts = [
    ...new Map(
      verify.map((v) => [
        `${v.text}\u0000${v.match.matchCase}\u0000${v.match.wholeWord}`,
        { text: v.text, match: v.match },
      ]),
    ).values(),
  ];
  scrubOffPage(lib, doc, chosenTexts);
  pruneUnreachable(lib, doc);

  // The boxes, drawn over the rewritten pages.
  const color = fill === "white" ? lib.rgb(1, 1, 1) : lib.rgb(0, 0, 0);
  for (const b of boxes) {
    const frame = frames[b.page]!;
    const at = rectAnchor(b, frame);
    pages[b.page]!.drawRectangle({
      x: at.x,
      y: at.y,
      width: b.width,
      height: b.height,
      rotate: lib.degrees(frame.rotation),
      color,
    });
  }
  stampProducer(doc);
  const out = await doc.save({ updateFieldAppearances: false });

  let verified = 0;
  if (before) {
    const after = await readRedactText(out, loadReader);
    const chosen = new Map<string, number>();
    for (const v of verify) {
      const k = `${v.page}\u0000${v.text}`;
      chosen.set(k, (chosen.get(k) ?? 0) + 1);
    }
    for (const [k, n] of chosen) {
      const [pageText, text] = k.split("\u0000") as [string, string];
      const page = Number(pageText);
      const had = countOn(before.pages[page - 1]?.text ?? "", text);
      const has = countOn(after.pages[page - 1]?.text ?? "", text);
      if (has > Math.max(0, had - n)) {
        throw new PdfEngineError(
          `“${text}” is still in the text of page ${page} after redaction, so the file was not saved. Choose “${FLATTEN_LABEL}” instead.`,
        );
      }
      verified += n;
    }
    const hidden = await offPageHit(lib, out, chosenTexts);
    if (hidden) throw new PdfEngineError(hidden);
  }

  return {
    bytes: out,
    pageCount: pages.length,
    redactionCount: rects.length,
    verified,
  };
}
