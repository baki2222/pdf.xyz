import { PdfEngineError } from "./engine";
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

/**
 * Redact PDF's "Remove text under boxes" method: the engine Edit PDF's Redact
 * applies (`editor/content-edit.ts`) — the glyphs under each box are taken
 * out of the page's content stream, the pixels of any picture under it are
 * overwritten in a copy of that picture, the annotations under it are
 * removed, objects nothing refers to any more are dropped, and then the box
 * is filled. Everything else stays as it was: text, links, bookmarks and
 * document properties outside the boxes.
 *
 * What that engine cannot do safely it refuses (vertical text, an inline
 * image or nested content under a box, a form field under a box, an image
 * format it cannot rewrite), and the refusal reaches the user — the "Flatten
 * every page" method handles all of those, by rebuilding each page as an
 * image (`redact.ts`).
 *
 * The result is checked before it is returned: every match the user chose
 * from Find text or Detect personal data is searched for again in the
 * OUTPUT's text, and if any is still there the redaction fails rather than
 * handing back a file that still contains it.
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
  /** Matches searched for again in the output and not found. */
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
  }

  return {
    bytes: out,
    pageCount: pages.length,
    redactionCount: rects.length,
    verified,
  };
}
