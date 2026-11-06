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
import { readRedactText, searchPattern, type FoundText } from "./redact-find";
import type { PdfTextReader } from "./text";
import { loadPdfjs } from "./pdfjs";
import type { PDFDict as PdfDict, PDFDocument, PDFObject } from "pdf-lib";
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
  /** The matches the boxes came from: each must be absent from the output. */
  verify?: readonly Pick<FoundText, "page" | "text">[];
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
  texts: readonly string[],
): void {
  const { PDFDict, PDFArray, PDFName, PDFHexString, PDFRawStream } = lib;
  const patterns = texts
    .map((t) => searchPattern(t, { matchCase: true, wholeWord: false }))
    .filter((p): p is RegExp => p !== null);
  if (patterns.length === 0) return;
  const scrub = (value: string) =>
    patterns.reduce((v, p) => v.replace(p, SCRUBBED_TEXT), value);
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
    const packet = new TextDecoder().decode(
      lib.decodePDFRawStream(xmp).decode(),
    );
    if (anyMatch(packet, patterns)) {
      doc.catalog.set(
        xmpName,
        ctx.register(
          ctx.stream(scrub(packet), { Type: "Metadata", Subtype: "XML" }),
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
 * Where a chosen string is still in a saved file outside its page text: every
 * string in every object (a form field's value, a link, an attachment's name,
 * and what {@link scrubOffPage} rewrote) and every XMP packet. Page content
 * streams are not read here — the page text check covers them, through the
 * reader a person would use. Read from the OUTPUT bytes, not from the
 * document that wrote them.
 */
async function offPageHit(
  lib: PdfLibModule,
  bytes: Uint8Array,
  texts: readonly string[],
): Promise<{ text: string; where: string } | null> {
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
  for (const text of texts) {
    const pattern = searchPattern(text, { matchCase: true, wholeWord: false });
    if (!pattern) continue;
    const stack = [...roots];
    while (stack.length) {
      const [o, key] = stack.pop()!;
      if (key !== null && NOT_TEXT.has(key)) continue;
      const value = stringText(lib, o);
      if (value !== null) {
        if (anyMatch(value, [pattern])) return { text, where: where(key) };
      } else if (o instanceof PDFDict) {
        for (const [k, v] of o.entries()) stack.push([v, k.decodeText()]);
      } else if (o instanceof PDFArray) {
        for (const v of o.asArray()) stack.push([v, key]);
      } else if (o instanceof PDFRawStream) {
        stack.push([o.dict, null]);
        if (o.dict.get(PDFName.of("Type")) !== PDFName.of("Metadata")) continue;
        let packet: string;
        try {
          packet = new TextDecoder().decode(lib.decodePDFRawStream(o).decode());
        } catch {
          // A packet whose filter cannot be decoded is read as stored.
          packet = new TextDecoder().decode(o.contents);
        }
        if (anyMatch(packet, [pattern])) return { text, where: where("XMP") };
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
  const chosenTexts = [...new Set(verify.map((v) => v.text))];
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
    if (hidden) {
      throw new PdfEngineError(
        `“${hidden.text}” is still in the file outside the page text (in ${hidden.where}), so the file was not saved. Choose “${FLATTEN_LABEL}” instead.`,
      );
    }
  }

  return {
    bytes: out,
    pageCount: pages.length,
    redactionCount: rects.length,
    verified,
  };
}
