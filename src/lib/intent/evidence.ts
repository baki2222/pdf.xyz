/**
 * The words a suggestion shows for the fact that justified it, and the notes
 * a ranking adds about what it could not offer.
 *
 * Each kind of fact is a variant of {@link Evidence}, rendered by ONE
 * exhaustive switch (a new variant without words is a compile error), and
 * every number a sentence prints is a field of the value it renders — this
 * file holds no figure of its own, which `evidence.test.ts` checks by reading
 * its string literals. A prior is editorial and is never shown: no sentence
 * here calls a tool popular, or ranks it in words.
 *
 * Interpolated sentences evade the copy guards' source scans, so the test
 * renders every variant and runs the rendered text through the transmission
 * and identity predicates, and parses each number back to its field.
 */
import type { PdfLock } from "@/lib/pdf/probe-result";
import { formatBytes } from "@/lib/utils";
import type { FileFormat, UnsupportedFormat } from "./formats";
import type { AnswerTool, UnsupportedAnswer } from "./unsupported";

export type Evidence =
  /** How many of the files the tool opens: "2 PDFs", "3 images", "1 DOCX file". */
  | {
      readonly kind: "count";
      readonly count: number;
      readonly noun: "pdf" | "image" | "file";
      readonly format: string | null;
    }
  /** Their pages, when every one was counted. */
  | { readonly kind: "pages"; readonly pages: number }
  /** Their size together. */
  | { readonly kind: "size"; readonly bytes: number }
  /** One file is large: the fact behind Compress PDF. */
  | { readonly kind: "big-file"; readonly name: string; readonly bytes: number }
  /** One file is long: the fact behind Split PDF. */
  | { readonly kind: "long"; readonly name: string; readonly pages: number }
  /** Every sampled page is a picture: the fact behind OCR PDF. */
  | {
      readonly kind: "no-text";
      /** Named when more than one PDF could be meant. */
      readonly name: string | null;
      readonly from: number;
      readonly to: number;
    }
  /** The fact behind Fill forms. */
  | { readonly kind: "fields"; readonly name: string; readonly count: number }
  /** A lock, in the words true of its kind. */
  | {
      readonly kind: "lock";
      readonly name: string;
      readonly lock: Exclude<PdfLock, "none">;
    }
  /** A PDF this tab could not read. */
  | { readonly kind: "unreadable"; readonly name: string }
  /** The tool opens the file only after another one runs. */
  | { readonly kind: "after"; readonly tool: string }
  /** A one-file tool offered several: the one it takes. */
  | { readonly kind: "one-file"; readonly name: string }
  /** It opens some of the files, not all. */
  | { readonly kind: "partial"; readonly opens: number; readonly total: number }
  /** A worker or AI tool: the moment the file moves. */
  | { readonly kind: "uploads" }
  /** A tool that cannot receive the files: they are picked again there. */
  | { readonly kind: "add-there"; readonly count: number };

/** Every kind, in one list the tests walk. */
export const EVIDENCE_KINDS = [
  "count",
  "pages",
  "size",
  "big-file",
  "long",
  "no-text",
  "fields",
  "lock",
  "unreadable",
  "after",
  "one-file",
  "partial",
  "uploads",
  "add-there",
] as const satisfies readonly Evidence["kind"][];

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** "No selectable text on page 1", "… on pages 1–3", "… of scan.pdf". */
function noText(e: Extract<Evidence, { kind: "no-text" }>): string {
  const pages = e.from === e.to ? `page ${e.from}` : `pages ${e.from}–${e.to}`;
  return `No selectable text on ${pages}${e.name ? ` of ${e.name}` : ""}`;
}

/** One fact, in the words a suggestion row shows. */
export function renderEvidence(e: Evidence): string {
  switch (e.kind) {
    case "count":
      if (e.noun === "pdf") return plural(e.count, "PDF");
      if (e.noun === "image") return plural(e.count, "image");
      return plural(e.count, e.format ? `${e.format} file` : "file");
    case "pages":
      return plural(e.pages, "page");
    case "size":
      return formatBytes(e.bytes);
    case "big-file":
      return `${e.name} is ${formatBytes(e.bytes)}`;
    case "long":
      return `${e.name} has ${plural(e.pages, "page")}`;
    case "no-text":
      return noText(e);
    case "fields":
      return `${e.name} has ${plural(e.count, "form field")}`;
    case "lock":
      // Only a file that needs a password is said to have one: most locked
      // PDFs open in every viewer and only restrict editing.
      if (e.lock === "password-required")
        return `${e.name} needs a password to open`;
      if (e.lock === "restricted") return `${e.name} has editing restrictions`;
      return `${e.name} is encrypted`;
    case "unreadable":
      return `${e.name} couldn't be read here`;
    case "after":
      return `after ${e.tool}`;
    case "one-file":
      return `takes one file — ${e.name}`;
    case "partial":
      return `opens ${e.opens} of your ${plural(e.total, "file")}`;
    case "uploads":
      return "uploads only when you start it";
    case "add-there":
      return e.count === 1
        ? "you'll add the file there"
        : "you'll add the files there";
    default: {
      const unhandled: never = e;
      return unhandled;
    }
  }
}

/** What a ranking could not offer, and why — said once per cause. */
export type RankNote =
  /** No tool opens this format: the /tools answer, alternative included. */
  | {
      readonly kind: "unsupported";
      readonly format: UnsupportedFormat;
      readonly answer: UnsupportedAnswer<AnswerTool>;
    }
  /** A file over the limit of tools that take its format. */
  | {
      readonly kind: "over-ceiling";
      readonly name: string;
      readonly bytes: number;
      readonly ceiling: number;
      readonly tools: readonly string[];
    }
  /** The bytes say a different format from the name. */
  | {
      readonly kind: "contradicted";
      readonly name: string;
      readonly named: FileFormat;
      readonly actual: FileFormat | null;
    }
  /** Neither its name nor its type is a format anything here reads. */
  | { readonly kind: "unrecognised"; readonly name: string };

export const NOTE_KINDS = [
  "unsupported",
  "over-ceiling",
  "contradicted",
  "unrecognised",
] as const satisfies readonly RankNote["kind"][];

/** "A", "A and B", "A, B and C". */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const IMAGE_FORMATS: ReadonlySet<string> = new Set([
  "JPG",
  "PNG",
  "HEIC",
  "HEIF",
  "WEBP",
  "GIF",
  "TIFF",
  "BMP",
  "SVG",
  "AVIF",
]);

/** "a PNG image", "a DOCX file", "an XLSX file". */
function aFormat(format: FileFormat): string {
  const article = /^[AEFHILMNORSX]/.test(format) ? "an" : "a";
  const noun = IMAGE_FORMATS.has(format) ? "image" : "file";
  return format === "PDF" ? "a PDF" : `${article} ${format} ${noun}`;
}

/** One note, in the words a suggestion list shows below its rows. */
export function renderNote(note: RankNote): string {
  switch (note.kind) {
    case "unsupported": {
      const { headline, how, alternative } = note.answer;
      if (!how) return headline;
      return alternative?.kind === "tool"
        ? `${headline} ${how} ${alternative.tool.name} takes ${alternative.takes}.`
        : `${headline} ${how}`;
    }
    case "over-ceiling":
      return `${note.name} is ${formatBytes(note.bytes)}, over the ${formatBytes(
        note.ceiling,
      )} that ${andList(note.tools)} ${note.tools.length === 1 ? "takes" : "take"}.`;
    case "contradicted":
      return note.actual
        ? `${note.name} is really ${aFormat(note.actual)}, so no tool here opens it under its name.`
        : `${note.name} isn't really ${aFormat(note.named)}, so no tool here opens it.`;
    case "unrecognised":
      return `No tool here opens ${note.name}.`;
    default: {
      const unhandled: never = note;
      return unhandled;
    }
  }
}
