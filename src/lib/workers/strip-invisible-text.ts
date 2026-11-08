/**
 * “Redo existing OCR”'s pre-pass: take invisible text-showing operators
 * (text render mode 3) out of a PDF's pages BEFORE OCRmyPDF `--redo-ocr`
 * reads it, so an earlier OCR layer is replaced in the shapes OCRmyPDF
 * itself misses too — not every hidden text: the list of what it leaves is
 * below, and the copy (`REDO_OCR_SCOPE`) says other hidden text may be kept.
 *
 * WHY THIS EXISTS. OCRmyPDF 14.0.1 (the live worker image) strips hidden
 * text under `--redo-ocr` only when `3 Tr` appears INSIDE a `BT … ET` of the
 * page's own content stream (`strip_invisible_text` in its `_graft.py`). It
 * kept two shapes, measured in the image on 2026-11-08 (#290): the mode set
 * BEFORE `BT`, and a Form XObject drawn with `Do` — the way OCRmyPDF grafts
 * every layer it adds, so redoing a PDF our own OCR PDF made searchable left
 * the old words beside the new ones. `ENGINE_ALONE_OUTCOMES` in
 * `./ocr-redo-proof` keeps that measurement, and the in-image proof checks
 * both it and what this pass makes of it.
 *
 * What it does, page by page, over the decoded content streams:
 *  - tracks the text render mode as graphics state does: `Tr` sets it, `q`
 *    saves it, `Q` restores it, and `BT` does NOT reset it (the PDF spec;
 *    OCRmyPDF's reset at `BT` is exactly why it misses the mode-before-text
 *    shape);
 *  - removes `Tj` and `TJ` drawn in mode 3, and turns `'` and `"` drawn in
 *    mode 3 into the line move (and spacing) they also make, so the text
 *    after them is positioned as before;
 *  - follows `Do` into Form XObjects with the mode in force at the `Do`
 *    (a form inherits the caller's graphics state): a form that paints
 *    nothing but invisible text has its `Do` removed; a form that also
 *    paints something (an image, a path, visible text) is copied with only
 *    its invisible text taken out, the copy added to the resources under a
 *    new name and the `Do` pointed at it. A form is never edited in place,
 *    since another page may draw it.
 *
 * What it never does: touch an operator that paints (paths, shadings,
 * images, inline images, visible text in modes 0–2 and 4–6), touch mode 7
 * (invisible, but it adds to the clipping path), or rasterise anything.
 *
 * Where it leaves invisible text alone, each a conservative choice that
 * returns the PDF as OCRmyPDF alone would have treated it:
 *  - an invisible `Tj`/`TJ` whose advance a LATER visible show in the same
 *    `BT` relies on (no `Td`/`TD`/`Tm`/`T*` between them): removing it
 *    would move the visible text, and this pass has no font metrics;
 *  - a content stream it cannot decode with certainty (a filter pdf-lib
 *    does not read, or any `DecodeParms`): that page or form is kept as is;
 *  - a document pdf-lib cannot load (damaged or encrypted — the runner
 *    refuses an encrypted one through OCRmyPDF's own exit code, unchanged),
 *    or one carrying a digital signature (OCRmyPDF refuses those too, and
 *    rewriting the file must not be what changes that);
 *  - text outside the page content: annotation appearances, Type 3 glyphs,
 *    patterns. Forms nested deeper than {@link MAX_FORM_DEPTH}, or in a
 *    cycle, are treated as painting and kept;
 *  - a content stream it may be misreading ({@link ContentStrip.abandoned}):
 *    a `Tr` whose last operand is not a number (the mode after it is
 *    unknown), an operator outside `BX … EX` that no PDF defines (the
 *    tokenizer may have lost its place, for instance on an `EI` inside an
 *    inline image's data), or an unfiltered inline image whose data ends
 *    before its own width, height and depth say it does. The whole stream
 *    is kept, since reading on could take visible text for invisible
 *    (review 2026-11-08);
 *  - a document pdf-lib loads but cannot walk (a /Pages or /XObject that is
 *    not a dictionary, say): it comes back as it went in, `unrewritable`,
 *    for OCRmyPDF to repair or refuse exactly as before.
 *
 * When nothing is removed the input bytes are returned AS IS (the same
 * array), so a PDF with no invisible text reaches OCRmyPDF byte-identical.
 */
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFArray,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFObject,
} from "pdf-lib";
import {
  asciiBytes,
  isName,
  isNum,
  num,
  parseContent,
  spliceOps,
  type ContentOp,
  type OpReplacement,
  type PdfValue,
} from "@/lib/pdf/editor/content-stream";

/** Text render mode 3: neither fill nor stroke nor clip — invisible text. */
export const INVISIBLE_TEXT_MODE = 3;
/** How deep `Do` is followed into forms drawn by forms. */
export const MAX_FORM_DEPTH = 12;

const SHOW = new Set(["Tj", "TJ", "'", '"']);
/** Operators that set the text position from the LINE start, not the pen. */
const POSITION = new Set(["Td", "TD", "Tm", "T*"]);
/** Operators that put marks on the page (visible text and `Do` aside). */
const PAINT = new Set([
  "S",
  "s",
  "f",
  "F",
  "f*",
  "B",
  "B*",
  "b",
  "b*",
  "sh",
  "BI",
]);
const SPACE = asciiBytes(" ");

/**
 * Every operator ISO 32000-1 (Annex A) defines, but `ID` and `EI`, which
 * the tokenizer consumes inside `BI`. Any other operator outside `BX … EX`
 * means the stream is not being read as a viewer reads it.
 */
const KNOWN_OPERATORS = new Set([
  ...["b", "B", "b*", "B*", "BDC", "BI", "BMC", "BT", "BX", "c", "cm"],
  ...["CS", "cs", "d", "d0", "d1", "Do", "DP", "EMC", "ET", "EX", "f"],
  ...["F", "f*", "G", "g", "gs", "h", "i", "j", "J", "K", "k", "l", "m"],
  ...["M", "MP", "n", "q", "Q", "re", "RG", "rg", "ri", "s", "S", "SC"],
  ...["sc", "SCN", "scn", "sh", "T*", "Tc", "Td", "TD", "Tf", "TJ", "Tj"],
  ...["TL", "Tm", "Tr", "Ts", "Tw", "Tz", "v", "w", "W", "W*", "y", "'"],
  '"',
]);

/** Why a content stream was left exactly as it was. */
export type AbandonReason = "render mode" | "unknown operator" | "inline image";

/** The mode a `Tr` sets: its LAST operand, as viewers read it; null if not a number. */
function renderModeOf(op: ContentOp): number | null {
  const last = op.args[op.args.length - 1];
  return isNum(last) ? last : null;
}

/** Colour components of an inline image's colour space, or null when unknown here. */
function components(cs: PdfValue | undefined): number | null {
  const name = Array.isArray(cs) ? cs[0] : cs;
  if (!isName(name)) return null;
  if (Array.isArray(cs)) return ["I", "Indexed"].includes(name.v) ? 1 : null;
  if (["G", "DeviceGray", "I", "Indexed"].includes(name.v)) return 1;
  if (["RGB", "DeviceRGB"].includes(name.v)) return 3;
  if (["CMYK", "DeviceCMYK"].includes(name.v)) return 4;
  return null;
}

/**
 * The bytes an UNFILTERED inline image's data must hold, from its own
 * dictionary; null when it is filtered or its size cannot be worked out.
 */
function inlineImageBytes(dict: Map<string, PdfValue>): number | null {
  const get = (short: string, long: string) =>
    dict.get(short) ?? dict.get(long);
  const filter = get("F", "Filter");
  if (filter != null && !(Array.isArray(filter) && filter.length === 0))
    return null;
  const w = get("W", "Width");
  const h = get("H", "Height");
  if (!isNum(w) || !isNum(h)) return null;
  let bits: number;
  if (get("IM", "ImageMask") === true) bits = 1;
  else {
    const bpc = get("BPC", "BitsPerComponent");
    const n = components(get("CS", "ColorSpace"));
    if (!isNum(bpc) || n === null) return null;
    bits = bpc * n;
  }
  return h * Math.ceil((w * bits) / 8);
}

/** Whether, and why, a stream must be left as it is because it may be misread. */
function abandonReason(ops: readonly ContentOp[]): AbandonReason | undefined {
  let compat = 0;
  for (const op of ops) {
    if (op.op === "BX") compat += 1;
    else if (op.op === "EX") compat = Math.max(0, compat - 1);
    else if (op.op === "Tr") {
      if (renderModeOf(op) === null) return "render mode";
    } else if (op.op === "BI") {
      const want = op.inline ? inlineImageBytes(op.inline) : null;
      if (want !== null && op.data && op.data.end - op.data.start < want)
        return "inline image";
    } else if (compat === 0 && !KNOWN_OPERATORS.has(op.op))
      return "unknown operator";
  }
  return undefined;
}

/** What a `Do` of a named XObject becomes. */
export type DoOutcome =
  | { kind: "keep"; paints: boolean }
  | { kind: "drop"; removed: number }
  | { kind: "rename"; name: string; removed: number };

/** Resolves the XObject named by a `Do`, given the mode in force there. */
export type DoResolver = (name: string, mode: number) => DoOutcome;

export interface ContentStrip {
  /** The rewritten stream; the input array itself when nothing changed. */
  bytes: Uint8Array;
  changed: boolean;
  /** Invisible text-showing operators removed (forms' included). */
  removed: number;
  /** Invisible text-showing operators kept because visible text relied on their advance. */
  keptForPosition: number;
  /** Whether what is left puts any mark on the page. */
  paints: boolean;
  /** Set when the stream was left as it was because it may be misread. */
  abandoned?: AbandonReason;
}

const KEEP_PAINTS: DoOutcome = { kind: "keep", paints: true };

/**
 * Remove the invisible text from one content stream. Pure: the XObjects it
 * draws are answered by `resolve` (a stream with no `Do` needs none).
 */
export function stripContentStream(
  bytes: Uint8Array,
  initialMode = 0,
  resolve: DoResolver = () => KEEP_PAINTS,
): ContentStrip {
  const ops = parseContent(bytes);
  const abandoned = abandonReason(ops);
  if (abandoned)
    return {
      bytes,
      changed: false,
      removed: 0,
      keptForPosition: 0,
      paints: true,
      abandoned,
    };
  const replace = new Map<number, Uint8Array>();
  /** Show operators removed since the pen was last placed from the line start. */
  let pending: number[] = [];
  let mode = initialMode;
  const saved: number[] = [];
  let inText = false;
  let paints = false;
  let fromForms = 0;
  let keptForPosition = 0;

  ops.forEach((op, i) => {
    switch (op.op) {
      case "q":
        saved.push(mode);
        return;
      case "Q":
        if (saved.length > 0) mode = saved.pop()!;
        return;
      case "Tr":
        mode = renderModeOf(op)!; // abandonReason refused a non-number
        return;
      case "BT":
      case "ET":
        inText = op.op === "BT";
        pending = [];
        return;
      case "Do": {
        const name = op.args[0];
        if (!isName(name)) {
          paints = true;
          return;
        }
        const outcome = resolve(name.v, mode);
        if (outcome.kind === "keep") {
          if (outcome.paints) paints = true;
        } else if (outcome.kind === "drop") {
          replace.set(i, SPACE);
          fromForms += outcome.removed;
        } else {
          replace.set(i, asciiBytes(` /${outcome.name} Do `));
          fromForms += outcome.removed;
          paints = true;
        }
        return;
      }
    }
    if (POSITION.has(op.op)) {
      pending = [];
      return;
    }
    if (SHOW.has(op.op)) {
      if (mode !== INVISIBLE_TEXT_MODE) {
        // Visible (or clip-only) text. A Tj/TJ is drawn where the pen was
        // left, so the invisible shows just before it must stay.
        if ((op.op === "Tj" || op.op === "TJ") && pending.length > 0) {
          for (const j of pending) replace.delete(j);
          keptForPosition += pending.length;
        }
        pending = [];
        if (mode !== 7) paints = true;
        return;
      }
      if (!inText) return; // malformed: a show outside BT is left as found
      if (op.op === "Tj" || op.op === "TJ") {
        replace.set(i, SPACE);
        pending.push(i);
      } else if (op.op === "'") {
        replace.set(i, asciiBytes(" T* "));
        pending = [i];
      } else {
        const [aw, ac] = op.args;
        if (!isNum(aw) || !isNum(ac)) return;
        replace.set(i, asciiBytes(` ${num(aw)} Tw ${num(ac)} Tc T* `));
        pending = [i];
      }
      return;
    }
    if (PAINT.has(op.op)) paints = true;
  });

  const removed =
    [...replace.keys()].filter((i) => SHOW.has(ops[i]!.op)).length + fromForms;
  if (replace.size === 0)
    return { bytes, changed: false, removed: 0, keptForPosition, paints };
  const replacements: OpReplacement[] = [...replace].map(([index, b]) => ({
    index,
    bytes: b,
  }));
  return {
    bytes: spliceOps(bytes, ops, replacements),
    changed: true,
    removed,
    keptForPosition,
    paints,
  };
}

/** A stream's decoded bytes, or null when they cannot be read with certainty. */
function decodedStream(stream: PDFRawStream): Uint8Array | null {
  if (stream.dict.has(PDFName.of("DecodeParms"))) return null;
  try {
    return decodePDFRawStream(stream).decode();
  } catch {
    return null;
  }
}

/** The page's content as one stream, or null when any part cannot be read. */
function pageContent(doc: PDFDocument, contents: PDFObject | undefined) {
  const parts: PDFObject[] =
    contents instanceof PDFArray
      ? contents.asArray()
      : contents === undefined
        ? []
        : [contents];
  const decoded: Uint8Array[] = [];
  for (const part of parts) {
    const stream = part instanceof PDFRef ? doc.context.lookup(part) : part;
    if (!(stream instanceof PDFRawStream)) return null;
    const bytes = decodedStream(stream);
    if (!bytes) return null;
    decoded.push(bytes);
  }
  const total = decoded.reduce((n, b) => n + b.length + 1, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const b of decoded) {
    out.set(b, at);
    out[at + b.length] = 10;
    at += b.length + 1;
  }
  return out;
}

/** Does the document carry a digital signature (a /Sig dictionary)? */
function isSigned(doc: PDFDocument): boolean {
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of("Type")) === PDFName.of("Sig")) return true;
    if (obj.has(PDFName.of("ByteRange"))) return true;
  }
  return false;
}

const SKIP_ON_COPY = new Set(
  ["Length", "Filter", "DecodeParms", "DL"].map((k) => PDFName.of(k)),
);

export interface InvisibleTextStrip {
  /** The PDF to hand OCRmyPDF; the input array itself when nothing changed. */
  bytes: Uint8Array;
  pagesChanged: number;
  /** Invisible text-showing operators removed, across pages and forms. */
  removed: number;
  /** Invisible text-showing operators kept because visible text relied on their advance. */
  keptForPosition: number;
  /**
   * Why the document was passed through untouched, when it was: pdf-lib
   * could not load it, it is signed, or it loaded but could not be walked.
   */
  untouched?: "unreadable" | "signed" | "unrewritable";
}

/**
 * Remove the invisible text from every page of `pdf`. Never throws: a
 * document it cannot or must not rewrite comes back as it went in, with
 * {@link InvisibleTextStrip.untouched} saying why. (Until review 2026-11-08
 * only the load was guarded; `strip-invisible-text.test.ts` now passes
 * loadable-but-malformed files through, and the runner test sends one on
 * to OCRmyPDF.)
 */
export async function stripInvisibleText(
  pdf: Uint8Array,
): Promise<InvisibleTextStrip> {
  const none = (
    untouched?: InvisibleTextStrip["untouched"],
  ): InvisibleTextStrip => ({
    bytes: pdf,
    pagesChanged: 0,
    removed: 0,
    keptForPosition: 0,
    ...(untouched ? { untouched } : {}),
  });
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch {
    return none("unreadable");
  }
  try {
    return await rewrite(doc, none);
  } catch {
    return none("unrewritable");
  }
}

async function rewrite(
  doc: PDFDocument,
  none: (untouched?: InvisibleTextStrip["untouched"]) => InvisibleTextStrip,
): Promise<InvisibleTextStrip> {
  if (isSigned(doc)) return none("signed");

  const formCache = new Map<string, ContentStrip | null>();
  const copies = new Map<string, PDFRef>();
  const namesIn = new WeakMap<PDFDict, Map<string, string>>();
  let counter = 0;
  const ids = new WeakMap<PDFDict, number>();
  let nextId = 0;
  const idOf = (dict: PDFDict | undefined) => {
    if (!dict) return "none";
    if (!ids.has(dict)) ids.set(dict, nextId++);
    return `r${ids.get(dict)}`;
  };

  const resolverFor =
    (resources: PDFDict | undefined, depth: number, path: Set<string>) =>
    (name: string, mode: number): DoOutcome => {
      const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
      const ref = xobjects?.get(PDFName.of(name));
      if (!xobjects || !(ref instanceof PDFRef)) return KEEP_PAINTS;
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) return KEEP_PAINTS;
      if (stream.dict.get(PDFName.of("Subtype")) !== PDFName.of("Form"))
        return KEEP_PAINTS; // an image: it paints
      const tag = ref.toString();
      const inherited = mode === INVISIBLE_TEXT_MODE ? 3 : 0;
      const ownResources = stream.dict.lookupMaybe(
        PDFName.of("Resources"),
        PDFDict,
      );
      // A form without resources of its own resolves its names in its
      // caller's (a PDF 1.1 leftover), so its result depends on the caller.
      const key = `${tag}|${inherited}|${ownResources ? "own" : idOf(resources)}`;
      if (path.has(tag) || depth >= MAX_FORM_DEPTH) return KEEP_PAINTS;
      let strip = formCache.get(key);
      if (strip === undefined) {
        const bytes = decodedStream(stream);
        const own = ownResources ?? resources;
        path.add(tag);
        strip = bytes
          ? stripContentStream(
              bytes,
              inherited,
              resolverFor(own, depth + 1, path),
            )
          : null;
        path.delete(tag);
        formCache.set(key, strip);
      }
      if (!strip || !strip.changed)
        return { kind: "keep", paints: strip?.paints ?? true };
      if (strip.removed > 0 && !strip.paints)
        return { kind: "drop", removed: strip.removed };
      let copy = copies.get(key);
      if (!copy) {
        const clone = doc.context.flateStream(strip.bytes);
        for (const [k, v] of stream.dict.entries())
          if (!SKIP_ON_COPY.has(k)) clone.dict.set(k, v);
        copy = doc.context.register(clone);
        copies.set(key, copy);
      }
      let names = namesIn.get(xobjects);
      if (!names) namesIn.set(xobjects, (names = new Map()));
      let newName = names.get(key);
      if (!newName) {
        do newName = `PdfxyzRedo${++counter}`;
        while (xobjects.has(PDFName.of(newName)));
        xobjects.set(PDFName.of(newName), copy);
        names.set(key, newName);
      }
      return { kind: "rename", name: newName, removed: strip.removed };
    };

  let pagesChanged = 0;
  let removed = 0;
  let keptForPosition = 0;
  for (const page of doc.getPages()) {
    const content = pageContent(doc, page.node.get(PDFName.of("Contents")));
    if (!content) continue;
    const strip = stripContentStream(
      content,
      0,
      resolverFor(page.node.Resources(), 0, new Set()),
    );
    keptForPosition += strip.keptForPosition;
    if (!strip.changed) continue;
    page.node.set(
      PDFName.of("Contents"),
      doc.context.register(doc.context.flateStream(strip.bytes)),
    );
    pagesChanged += 1;
    removed += strip.removed;
  }
  if (pagesChanged === 0) return { ...none(), keptForPosition };
  const bytes = await doc.save({
    useObjectStreams: false,
    updateFieldAppearances: false,
  });
  return { bytes, pagesChanged, removed, keptForPosition };
}
