/**
 * The one place a font is chosen, fetched, embedded and CHECKED.
 *
 * Every tool that stamps text goes through {@link embedDrawingFont}. Latin text
 * takes the free path — a built-in standard face, nothing downloaded, byte-for-
 * byte the output the product shipped before. Anything else gets a real Noto
 * face, subset to the glyphs used, fetched from OUR origin.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THREE THINGS HERE WERE MEASURED, NOT ASSUMED. Each one was a silent blank.
 *
 * 1. `@pdf-lib/fontkit` — the package pdf-lib's own README recommends — has a
 *    BROKEN TTF SUBSETTER. It does not throw. It writes a font whose `loca`
 *    table points at nonsense for most glyphs, and the page renders those
 *    characters as nothing at all. Measured by rasterising the output in
 *    Chromium and counting ink:
 *
 *      "Привет Ελληνικά ĄĆŁŻ"   3,109 ink px    (renders as "При")
 *      "机密文件测试"             1,748 ink px    (renders as "件")
 *
 *    Against upstream `fontkit@2`, the same text, the same face, the same
 *    scale:
 *
 *      "Привет Ελληνικά ĄĆŁŻ"  15,518 ink px
 *      "机密文件测试"            11,337 ink px  — identical to embedding the
 *                                                 whole 10 MB font unsubset
 *
 *    So we use upstream fontkit and {@link fontkitForPdfLib} adapts its
 *    `Subset.encode()` to the `encodeStream()` shape pdf-lib 1.17 calls. The
 *    equality with the unsubset embed is the control: subsetting is supposed to
 *    change the file size and nothing else.
 *
 * 2. `@pdf-lib/fontkit` ALSO crashes outright on every Indic script with
 *    `regeneratorRuntime is not defined` — its Indic shaper was compiled with
 *    regenerator and the runtime is not bundled. Bengali, the language this
 *    product's owner writes in, could not reach the subsetter at all. Upstream
 *    fontkit has no such gap.
 *
 * 3. A cmap hit does not mean a drawn glyph. Coverage says the face has an
 *    entry for a code point; shaping can still land on `.notdef`, and `.notdef`
 *    draws as blank or as a hollow box. So after the bytes arrive we SHAPE the
 *    real text and refuse if any glyph is `.notdef` — the second, independent
 *    bound on the first. Without it, one stale row in a coverage table becomes
 *    a blank word in someone's contract.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WHAT THIS MODULE WILL NOT DO
 * It will not substitute. Until 2026-08-10 every character WinAnsi could not
 * represent was silently replaced with `?` and the export reported success — a
 * user annotating a contract in Chinese was told "Markups applied" and handed a
 * PDF of question marks. That is fixed and stays fixed: where a glyph cannot be
 * drawn, the operation throws a {@link PdfEngineError} naming the characters
 * and saying which scripts we do and do not draw. A refusal costs the export; a
 * substitution costs the document and lies about it.
 */
import type { PDFDocument, PDFField, PDFFont } from "pdf-lib";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";
import { PdfEngineError } from "./engine";
import { allWinAnsi, nonWinAnsiCharacters } from "./winansi";
import {
  SUPPORTED_SCRIPTS,
  fontPackUrl,
  unsupportedScriptFor,
  type FontPack,
  type FontPackId,
} from "./font-packs";
import {
  candidatePacks,
  loadCoverage,
  packLabelsInText,
  uncoveredCodePoints,
} from "./font-coverage";

/**
 * The built-in faces our tools ask for. When a string needs a Unicode face they
 * all collapse to the single Regular Noto weight we ship, which is a visible
 * change (a Chinese watermark is not bold) and never a lossy one. Shipping bold
 * and italic cuts of five faces would roughly double 23 MB of static assets to
 * make a watermark heavier; if that trade is ever worth making, this type is
 * where it lands.
 */
export type StandardFace =
  "sans" | "sans-bold" | "sans-oblique" | "mono" | "serif-italic";

/**
 * Where a pack's bytes come from. The default fetches from our own origin —
 * a CDN would put the rendering of a user's document on somebody else's host,
 * which contradicts the promise every tool page makes.
 *
 * Overridable because the unit tests run in Node with no server: they point it
 * at the same TTFs the copy step ships, so what a test embeds is the file a
 * browser would have downloaded. The bound: that seam proves the EMBEDDING, not
 * that the asset is served. `e2e/unicode-fonts.spec.ts` fetches the real URL
 * off the real server for that half.
 */
export type FontByteSource = (pack: FontPack) => Promise<Uint8Array>;

const fetchFromOrigin: FontByteSource = async (pack) => {
  const response = await fetch(fontPackUrl(pack));
  if (!response.ok) {
    throw new PdfEngineError(
      `The ${pack.label} font could not be loaded (${response.status}). ` +
        "Check your connection and try again.",
    );
  }
  return new Uint8Array(await response.arrayBuffer());
};

let byteSource: FontByteSource = fetchFromOrigin;

/** Replace the byte source (tests and Node callers). Returns the previous one. */
export function setFontByteSource(source: FontByteSource): FontByteSource {
  const previous = byteSource;
  byteSource = source;
  return previous;
}

/** The source a browser uses, so a guard can assert nothing swapped it for good. */
export function defaultFontByteSource(): FontByteSource {
  return fetchFromOrigin;
}

const packBytes = new Map<string, Promise<Uint8Array>>();

function loadPackBytes(pack: FontPack): Promise<Uint8Array> {
  const key = `${pack.id}@${pack.version}`;
  let pending = packBytes.get(key);
  if (!pending) {
    pending = byteSource(pack).catch((error: unknown) => {
      packBytes.delete(key);
      throw error;
    });
    packBytes.set(key, pending);
  }
  return pending;
}

/** Forget every cached face — tests swap the byte source between cases. */
export function resetFontCache(): void {
  packBytes.clear();
  fontkitPromise = null;
}

type FontkitFace = import("fontkit").FontkitFont;

interface PdfLibFontkit {
  create(bytes: Uint8Array): unknown;
}

let fontkitPromise: Promise<{
  forPdfLib: PdfLibFontkit;
  open(bytes: Uint8Array): FontkitFace;
}> | null = null;

/**
 * Upstream fontkit, wrapped so pdf-lib 1.17 can drive it.
 *
 * pdf-lib calls `subset.encodeStream()` and listens for `data`/`end`/`error`;
 * fontkit 2 replaced that with a synchronous `encode()`. The adapter is nine
 * lines and the alternative — `@pdf-lib/fontkit`, which still has
 * `encodeStream` — writes fonts whose glyphs do not render (see the header).
 * Choosing the maintained subsetter and adapting the call shape is the cheaper
 * of the two.
 */
function loadFontkit() {
  fontkitPromise ??= import("fontkit")
    .then((mod) => {
      // Both spellings, because the bundler picks the entry point: the ESM
      // browser build exposes named exports and the CJS interop hands back a
      // `default`. Guessing one and casting would have failed in exactly one of
      // the two environments, which is the half nobody tests.
      const create = mod.create ?? mod.default?.create;
      if (typeof create !== "function") {
        throw new Error("fontkit exposed no create()");
      }
      const open = (bytes: Uint8Array): FontkitFace => create(bytes);
      return { forPdfLib: adaptForPdfLib(create), open };
    })
    .catch((error: unknown) => {
      fontkitPromise = null;
      throw error;
    });
  return fontkitPromise;
}

function adaptForPdfLib(create: (bytes: Uint8Array) => unknown): PdfLibFontkit {
  return {
    create(bytes: Uint8Array) {
      const font = create(bytes) as Record<string | symbol, unknown>;
      return new Proxy(font, {
        get(target, prop, receiver) {
          if (prop !== "createSubset") {
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return () => {
            const subset = (
              target.createSubset as () => Record<string | symbol, unknown>
            ).call(target);
            return new Proxy(subset, {
              get(sTarget, sProp) {
                if (sProp === "encodeStream")
                  return () => encodeStream(sTarget);
                const value = Reflect.get(sTarget, sProp);
                return typeof value === "function"
                  ? value.bind(sTarget)
                  : value;
              },
            });
          };
        },
      });
    },
  };
}

/** fontkit 2's `encode()` presented as the event emitter pdf-lib expects. */
function encodeStream(subset: Record<string | symbol, unknown>) {
  const handlers: Record<string, ((value?: unknown) => void) | undefined> = {};
  const api = {
    on(event: string, handler: (value?: unknown) => void) {
      handlers[event] = handler;
      return api;
    },
  };
  queueMicrotask(() => {
    try {
      handlers.data?.((subset.encode as () => Uint8Array).call(subset));
      handlers.end?.();
    } catch (error) {
      handlers.error?.(error);
    }
  });
  return api;
}

/** Format a character list for a message: at most eight, then a count. */
function showCharacters(characters: readonly string[]): string {
  const shown = characters.slice(0, 8).join(" ");
  const more =
    characters.length > 8 ? ` (and ${characters.length - 8} more)` : "";
  return `${shown}${more}`;
}

const NEVER_SUBSTITUTE =
  "Rather than replace them with “?” and hand you a damaged file, this stops so nothing is lost.";

function scriptsWeDraw(): string {
  return SUPPORTED_SCRIPTS.join(", ");
}

/**
 * Refusal for characters no shipped face has at all — naming the script and the
 * reason where we can. "Unsupported characters" would be a claim that goes
 * stale the day a font is added; "Arabic reads right to left and pdf.xyz lays
 * every line out left to right" describes the capability, so it stays true
 * until the capability changes.
 */
function refuseUncovered(codePoints: readonly number[]): never {
  const characters = codePoints.map((cp) => String.fromCodePoint(cp));
  const reasons = new Map<string, string>();
  for (const cp of codePoints) {
    const script = unsupportedScriptFor(cp);
    if (script) reasons.set(script.name, script.reason);
  }
  const named =
    reasons.size > 0
      ? ` ${[...reasons]
          .map(([name, reason]) => `${name} is not supported because ${reason}`)
          .join("; ")}.`
      : "";
  throw new PdfEngineError(
    `pdf.xyz can draw ${scriptsWeDraw()}. These characters are in a script it ` +
      `cannot draw yet: ${showCharacters(characters)}.${named} ${NEVER_SUBSTITUTE}`,
  );
}

/** Refusal for text every character of which we can draw — but not all at once. */
function refuseMixedScripts(labels: readonly string[]): never {
  throw new PdfEngineError(
    `This text mixes ${labels.join(" and ")}. pdf.xyz draws each line with a ` +
      "single embedded font, so it can render either of those scripts but not " +
      `both in one piece of text. Split them into separate runs. ${NEVER_SUBSTITUTE}`,
  );
}

/** Refusal for a face that had the code point but shapes it to `.notdef`. */
function refuseNotdef(pack: FontPack, characters: readonly string[]): never {
  throw new PdfEngineError(
    `The ${pack.label} font has no drawable shape for these characters: ` +
      `${showCharacters(characters)}. They would come out blank. ${NEVER_SUBSTITUTE}`,
  );
}

const STANDARD_FACE_NAMES: Record<StandardFace, string> = {
  sans: "Helvetica",
  "sans-bold": "HelveticaBold",
  "sans-oblique": "HelveticaOblique",
  mono: "Courier",
  "serif-italic": "TimesRomanItalic",
};

/**
 * The characters a face shapes to `.notdef` — blank or hollow box, never the
 * user's letter.
 *
 * `layout()` is what pdf-lib itself calls per `drawText`, so this asks the same
 * question the encoder will ask, one step earlier, while refusing is still
 * free. Glyphs carry the code points they came from, so the message can name
 * the characters rather than the glyph ids.
 */
function notdefCharacters(
  face: FontkitFace,
  texts: readonly string[],
): string[] {
  const bad = new Set<string>();
  for (const text of texts) {
    if (text.length === 0) continue;
    for (const glyph of face.layout(text).glyphs) {
      if (glyph.id !== 0) continue;
      for (const cp of glyph.codePoints ?? []) {
        bad.add(String.fromCodePoint(cp));
      }
    }
  }
  return [...bad];
}

/**
 * Embed the face that can draw all of `texts`, and prove it can before
 * returning.
 *
 * EVERY string the caller will draw must be passed here, not just the first.
 * Page numbers substitute `{n}` per page and headers substitute `{date}`, so
 * the string that breaks is usually not the template — and a font chosen from
 * a sample is a font chosen from the wrong set.
 */
export async function embedDrawingFont(
  doc: PDFDocument,
  rawTexts: readonly string[],
  face: StandardFace = "sans",
): Promise<PDFFont> {
  // Line breaks and tabs are layout, not glyphs — callers split on them before
  // drawing. Left in, they reach both the coverage check and the shaper: no
  // face has a glyph for U+000A, so a two-line Bengali document would be
  // refused for "a script we cannot draw" whose character prints as nothing in
  // the message. Normalised once, here, rather than at each of the eight call
  // sites that would each have to remember.
  const texts = rawTexts.map((text) => text.replace(/[\r\n\t]+/g, " "));
  const pdfLib = await loadPdfLib();
  if (allWinAnsi(texts)) {
    const name = STANDARD_FACE_NAMES[face];
    return doc.embedFont(
      pdfLib.StandardFonts[name as keyof typeof pdfLib.StandardFonts],
    );
  }

  const joined = texts.join("");
  const coverage = await loadCoverage();

  const uncovered = uncoveredCodePoints(coverage, joined);
  if (uncovered.length > 0) refuseUncovered(uncovered);

  const candidates = candidatePacks(coverage, joined);
  if (candidates.length === 0) {
    refuseMixedScripts(packLabelsInText(coverage, joined));
  }

  const fontkit = await loadFontkit();
  doc.registerFontkit(fontkit.forPdfLib as never);

  let lastBad: { pack: FontPack; characters: string[] } | null = null;
  for (const pack of candidates) {
    const bytes = await loadPackBytes(pack);
    const bad = notdefCharacters(fontkit.open(bytes), texts);
    if (bad.length > 0) {
      // Coverage said this face had the code points and shaping disagreed. Try
      // the next candidate — a rare kanji missing from Noto Sans JP is exactly
      // why the list is ordered rather than a single pick — and only refuse
      // once every face we ship has been asked.
      lastBad = { pack, characters: bad };
      continue;
    }
    // Markdown asks for four faces — body, bold, mono, italic — and on the
    // Unicode path all four resolve to the same Noto Regular. Without this memo
    // that is four independent subsets of one face in a single file, which for
    // Chinese means four copies of the same outlines. Keyed by PACK, not by the
    // fact that some Unicode face was needed: a document whose title is Bengali
    // and whose body is Chinese resolves to two different faces, and handing
    // the second call the first font would draw `.notdef` — silently, which is
    // the one outcome this module exists to prevent. Per document, so nothing
    // leaks between exports.
    const memo = documentFonts(doc);
    const cached = memo.get(pack.id);
    if (cached) return cached;
    const embedded = await doc.embedFont(bytes, { subset: true });
    memo.set(pack.id, embedded);
    return embedded;
  }
  refuseNotdef(lastBad!.pack, lastBad!.characters);
}

const documentFontCache = new WeakMap<PDFDocument, Map<FontPackId, PDFFont>>();

function documentFonts(doc: PDFDocument): Map<FontPackId, PDFFont> {
  let memo = documentFontCache.get(doc);
  if (!memo) {
    memo = new Map();
    documentFontCache.set(doc, memo);
  }
  return memo;
}

/**
 * Refuse, before any work is committed, when text is headed for a path that is
 * still WinAnsi-only.
 *
 * Interactive form fields are that path. pdf-lib generates a field's appearance
 * stream itself, from the form's own default font, and `doc.save()` does it
 * implicitly — so filling a field with Bengali does not fail where the value is
 * set, it fails inside `save()` with the raw library string
 * `WinAnsi cannot encode "গ" (0x0997)`. That is a refusal, which is the right
 * behaviour and was never the problem; it just reads like a crash and blames
 * nothing in particular.
 *
 * The message deliberately does NOT say "pdf.xyz cannot draw this script". It
 * can: a watermark, a page number, a header, a note and a signature all draw
 * Bengali. Saying otherwise here would be a claim that is false in the same
 * breath it is made, and the kind of sentence that survives long after the
 * capability it describes has changed.
 */
export function assertFormFieldTextDrawable(texts: readonly string[]): void {
  const blocked = new Set<string>();
  for (const text of texts) {
    for (const ch of nonWinAnsiCharacters(text)) blocked.add(ch);
  }
  if (blocked.size === 0) return;
  throw new PdfEngineError(
    `Interactive form fields can only carry the built-in PDF alphabet, and ` +
      `these characters are outside it: ${showCharacters([...blocked])}. ` +
      `The stamping tools (watermark, page numbers, header/footer, notes, ` +
      `signature) do embed a Unicode font and can draw them — a fillable field ` +
      `cannot yet, because a PDF reader regenerates its appearance from the ` +
      `form's own font. ${NEVER_SUBSTITUTE}`,
  );
}

/**
 * The text pdf-lib will draw with the form's own WinAnsi font the next time it
 * regenerates appearances — in `defaultUpdateAppearances`, `flatten()`, or
 * implicitly inside `save()` for any field that is dirty or has no stored
 * appearance. Feed it to {@link assertFormFieldTextDrawable}.
 *
 * Fields pdf-lib will NOT regenerate contribute nothing: their stored
 * appearance is drawn as-is and the font never sees their value, so refusing
 * them would refuse a file the tool handles correctly.
 *
 * What each type draws is what pdf-lib's default appearance providers draw: a
 * text field's value, a dropdown's selection, EVERY option of a list box (its
 * appearance lists them all, so checking the selection alone let a
 * non-WinAnsi option through), and a button's captions. Checkboxes, radios
 * and signatures draw no field text.
 */
export function formTextsDrawnOnRegeneration(
  fields: readonly PDFField[],
  lib: PdfLibModule,
): string[] {
  const { PDFButton, PDFDropdown, PDFOptionList, PDFTextField } = lib;
  return fields.flatMap((field) => {
    if (!field.needsAppearancesUpdate()) return [];
    if (field instanceof PDFTextField) return [field.getText() ?? ""];
    if (field instanceof PDFDropdown) return field.getSelected();
    if (field instanceof PDFOptionList) return field.getOptions();
    if (field instanceof PDFButton) {
      return field.acroField.getWidgets().flatMap((widget) => {
        const captions = widget.getAppearanceCharacteristics()?.getCaptions();
        return [captions?.normal ?? "", captions?.down ?? ""];
      });
    }
    return [];
  });
}

/** Start fetching what `texts` will need, without waiting for it. */
export function warmDrawingFont(rawTexts: readonly string[]): void {
  const texts = rawTexts.map((text) => text.replace(/[\r\n\t]+/g, " "));
  if (allWinAnsi(texts)) return;
  void (async () => {
    const coverage = await loadCoverage();
    const [first] = candidatePacks(coverage, texts.join(""));
    if (first) await loadPackBytes(first);
    await loadFontkit();
  })().catch(() => {
    // Swallowed: the operation's own await is the surface that reports errors.
  });
}
