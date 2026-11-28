/**
 * The name the upload is written under before LibreOffice reads it.
 *
 * WAS, until 2026-11-17: `input.<ext>` for every upload. LibreOffice names
 * things after the file it opened, so that word reached the PDF a user
 * downloads. Found in production by a real Excel to PDF job: a CSV becomes
 * one sheet named after the file's stem, and Calc's default page style
 * prints the sheet name as the page header, so every converted CSV said
 * "input" across the top of each page. The same name is what a document's
 * own file-name field prints (Word's FILENAME, Excel's `&F` header code).
 *
 * Now the stem is the user's own file name, cut down to characters that are
 * safe on every file system LibreOffice may run on and that LibreOffice will
 * not read as URL syntax (it turns the path into a `file://` URL, where `%`
 * and `#` mean something). The extension logic is unchanged from the old
 * `safeInputName`, so the import filter LibreOffice picks is the same.
 *
 * Every property here is held by `input-name.test.ts` over a hostile corpus,
 * with a positive control that shows its predicate rejecting the raw names.
 */

/** What is left when nothing of the user's name survives. */
export const INPUT_NAME_FALLBACK_STEM = "document";

/** At most this many code points of the user's stem are kept. */
export const INPUT_STEM_MAX_CODE_POINTS = 64;

/**
 * And at most this many UTF-8 bytes, so stem + extension stays well under
 * the 255-byte file-name limit of ext4 and NTFS, whatever the script (a CJK
 * letter is 3 bytes, one outside the BMP is 4).
 */
export const INPUT_STEM_MAX_BYTES = 150;

/** One character a kept stem may contain: a letter, a mark, a digit, or these. */
const ALLOWED = /[\p{L}\p{M}\p{N} _-]/u;

/**
 * Windows device names, which name a device rather than a file whatever the
 * extension (`CON.csv` is the console). The worker runs on Linux; local
 * development does not always, and a name that breaks one run is a defect.
 */
const WINDOWS_RESERVED =
  /^(?:con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/i;

const utf8Bytes = (s: string) => new TextEncoder().encode(s).byteLength;

/**
 * Characters that draw nothing: format characters (a right-to-left override,
 * a zero-width joiner) and every Default_Ignorable_Code_Point, which adds the
 * ones that are letters or marks by category: the Hangul fillers U+115F,
 * U+1160, U+3164 and U+FFA0 (Lo), the variation selectors and U+034F (Mn).
 * ADDED 2026-11-18 (review): a name made only of U+3164 kept it, and the
 * header looked blank instead of saying "document".
 */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The user's file name without its directory and its last extension, kept
 * to letters, marks, digits, space, hyphen and underscore (any other run of
 * characters becomes one space; invisible ones are dropped), with no leading
 * dot, hyphen or mark, bounded in code points and bytes (cut on a grapheme
 * boundary), and never empty or a Windows device name.
 */
export function sanitizeInputStem(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const raw = (dot >= 0 ? base.slice(0, dot) : base).normalize("NFC");
  let stem = "";
  let pendingSpace = false;
  for (const ch of raw) {
    // Invisible characters are dropped outright: they never separate words.
    if (INVISIBLE.test(ch)) continue;
    if (ALLOWED.test(ch) && !/\s/u.test(ch)) {
      if (pendingSpace && stem) stem += " ";
      pendingSpace = false;
      stem += ch;
    } else {
      // Whitespace of any kind, and everything not allowed, separates words.
      pendingSpace = true;
    }
  }
  // No leading hyphen (an argv reader may take it for an option), and no
  // leading mark (a combining accent with nothing to sit on); dots never
  // survive the loop, so no leading dot either.
  stem = stem.replace(/^[-\s\p{M}]+/u, "");
  // Cut on a grapheme boundary, so a long Bengali name never ends on a bare
  // vowel sign: a cluster that does not fit whole is left out whole.
  let kept = "";
  let count = 0;
  for (const { segment } of graphemes.segment(stem)) {
    const n = [...segment].length;
    if (
      count + n > INPUT_STEM_MAX_CODE_POINTS ||
      utf8Bytes(kept + segment) > INPUT_STEM_MAX_BYTES
    )
      break;
    kept += segment;
    count += n;
  }
  kept = kept.trimEnd();
  if (!kept) return INPUT_NAME_FALLBACK_STEM;
  return WINDOWS_RESERVED.test(kept) ? `${kept}_` : kept;
}

/**
 * The extension the upload is written with: EXACTLY the old `safeInputName`
 * rule, so a file's import filter does not change with this fix.
 */
export function officeInputExtension(filename: string): string {
  const ext = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".")).replace(/[^a-zA-Z0-9.]/g, "")
    : ".docx";
  return ext || ".docx";
}

/** The file name the upload is written under, inside the job's temp dir. */
export function officeInputName(filename: string): string {
  return `${sanitizeInputStem(filename)}${officeInputExtension(filename)}`;
}

/**
 * Where LibreOffice's `--convert-to pdf --outdir <dir>` writes for that
 * input: the name cut at its last dot (one not at the start), then `.pdf`
 * (INetURLObject::setExtension). WAS `replace(/\.[^.]+$/, "")`, which
 * agrees for every name with a non-empty extension and missed the file for
 * a name ending in a dot; no supported upload has one, and the runner no
 * longer depends on that.
 */
export function officeOutputName(
  inputName: string,
  /** `--convert-to`'s format: "pdf", or "xlsx" for the page-setup step. */
  ext: "pdf" | "xlsx" = "pdf",
): string {
  const dot = inputName.lastIndexOf(".");
  return `${dot > 0 ? inputName.slice(0, dot) : inputName}.${ext}`;
}
