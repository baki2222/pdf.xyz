/**
 * What to suggest for a set of files, the measured fact behind each
 * suggestion, and exactly what opening it carries (spec E.3, addendum WP-04).
 *
 * CANDIDATES come from each tool's `accept` row, read through the same
 * recogniser the hand-off gate uses, within the tool's own file ceiling — so
 * every suggestion opens at least one of the files, and none offers a size
 * its page refuses. A file whose bytes contradict its name opens nowhere.
 *
 * PRIORS are editorial and never shown: they order tools before any fact is
 * known, and no sentence may call them "popular". BOOSTS are measured facts
 * (a scan, a form, a large file, a long file), and each carries its evidence
 * into the row. LOCKS are two verdicts (addendum #71): Unlock PDF is pinned
 * for any lock; a file that needs a password is opened by Unlock PDF alone; a
 * restricted file stays open to the pdf.js readers and the workers; a lock
 * that could not be told keeps only the workers. An unreadable PDF pins
 * Repair PDF the same way. A blocked tool moves below the top, saying what
 * comes first.
 *
 * CARRY is what a launch sends, computed the way the gate computes it:
 * nothing for a tool with no in-browser runner, the first eligible file for
 * a one-file tool, all of them otherwise. `rank.test.ts` holds it equal to
 * `eligibleFilesFor`/`handoffPayload` over every mix in its corpus.
 *
 * Pure, and catalogue-free: the index is an argument, so no page carries the
 * catalogue just by importing this.
 */
import { imageOnlyRange } from "@/lib/pdf/probe-result";
import type { Evidence, RankNote } from "./evidence";
import type { FileFacts } from "./facts";
import {
  formatOf,
  toolAcceptsFormat,
  UNSUPPORTED_FORMATS,
  type UnsupportedFormat,
} from "./formats";
import type { ToolIndexEntry } from "./tool-index";
import { unsupportedAnswer } from "./unsupported";

/** The tools the model names. Every one is a catalogue slug (tested). */
const UNLOCK = "unlock-pdf";
const REPAIR = "repair-pdf";
const OCR = "ocr-pdf";
const FILL_FORMS = "fill-forms";
const COMPRESS = "compress-pdf";
const SPLIT = "split-pdf";
const JPG_TO_PDF = "jpg-to-pdf";
const PNG_TO_PDF = "png-to-pdf";

/** Priors for a tool that opens one PDF. */
const ONE_PDF: Readonly<Record<string, number>> = {
  [COMPRESS]: 70,
  "sign-pdf": 66,
  "edit-pdf": 64,
  "organize-pages": 60,
  [SPLIT]: 56,
  "pdf-to-word": 54,
  "page-numbers": 46,
  "rotate-pdf": 44,
  "protect-pdf": 40,
  "pdf-to-jpg": 34,
  "watermark-pdf": 30,
};
/** Priors for a tool that opens two or more PDFs. */
const MANY_PDFS: Readonly<Record<string, number>> = {
  "merge-pdf": 100,
  [COMPRESS]: 66,
};
/** A one-file tool offered several PDFs keeps this share of its prior. */
const ONE_FILE_SHARE = 0.6;
/** Priors for the converters, by the format they turn into a PDF. */
const CONVERTERS: Readonly<Record<string, number>> = {
  "word-to-pdf": 86,
  "excel-to-pdf": 85,
  "powerpoint-to-pdf": 85,
  "markdown-to-pdf": 82,
  "text-to-pdf": 80,
  "html-to-pdf": 80,
};
/** JPG to PDF when any JPG is among the images, otherwise PNG to PDF. */
const IMAGES_TO_PDF = 90;
/** Any other tool that opens the files. */
const OTHER = 10;

const NO_TEXT_BOOST = 70;
const FORM_BOOST = 60;
const BIG_FILE_BOOST = 25;
const LONG_DOC_BOOST = 15;
const RECENT_BOOST = 3;
const RECENT_CAP = 9;
/** Thresholds behind two boosts — never printed; the file's own figure is. */
const BIG_FILE_BYTES = 10 * 1024 * 1024;
const LONG_DOC_PAGES = 30;

/** Every slug the model names, for the test that each one exists. */
export const RANK_SLUGS: readonly string[] = [
  ...new Set([
    UNLOCK,
    REPAIR,
    OCR,
    FILL_FORMS,
    COMPRESS,
    SPLIT,
    JPG_TO_PDF,
    PNG_TO_PDF,
    ...Object.keys(ONE_PDF),
    ...Object.keys(MANY_PDFS),
    ...Object.keys(CONVERTERS),
  ]),
];

/** Suggestions shown before "More", by default. */
export const TOP_SUGGESTIONS = 3;

export interface RankContext {
  /**
   * The tool the visitor is already working toward — the workspace's
   * preselected tool, a guide's tool that cannot be handed the files:
   * pinned first, when it takes them.
   */
  readonly currentTool?: string | null;
  /** A step the job planned next: pinned first. */
  readonly pending?: string | null;
  /** Recently finished tools, newest first: a tie-break, nothing more. */
  readonly recents?: readonly string[];
  /** Tools this job has already been through: not offered again. */
  readonly trail?: readonly string[];
  /** How many suggestions come before "More". */
  readonly topCount?: number;
}

/** What comes first, for a tool that cannot open a file yet. */
export type Blocked = "unlock-first" | "repair-first";

export interface Suggestion<T extends ToolIndexEntry = ToolIndexEntry> {
  readonly slug: string;
  readonly tool: T;
  /** Prior × mix share + boosts; for ordering only, never shown. */
  readonly score: number;
  /** The facts behind it, in the order a row shows them. */
  readonly evidence: readonly Evidence[];
  /** Ids of the files it opens: its format, within its ceiling, unlocked. */
  readonly opens: readonly string[];
  /** What a launch sends: `eligible` files open in its runner; `ids` go. */
  readonly carry: {
    readonly eligible: number;
    readonly ids: readonly string[];
  };
  /** Set when it opens none of its files until another tool runs. */
  readonly blocked: Blocked | null;
  /** Why it is first, when it is pinned. */
  readonly pinned: "lock" | "repair" | "pending" | "current" | null;
  /** A measured fact raised it: it wins a tie over a prior. */
  readonly boosted: boolean;
}

export interface Ranking<T extends ToolIndexEntry = ToolIndexEntry> {
  readonly top: readonly Suggestion<T>[];
  readonly more: readonly Suggestion<T>[];
  readonly notes: readonly RankNote[];
}

const probeOf = (f: FileFacts) =>
  f.pdf?.state === "checked" ? f.pdf.probe : null;
const isPdf = (f: FileFacts) => f.format === "PDF";

/** Why `tool` cannot open `file` yet, or null when it can. */
function blockFor(tool: ToolIndexEntry, file: FileFacts): Blocked | null {
  const probe = isPdf(file) ? probeOf(file) : null;
  if (!probe) return null;
  // Which engines a tool brings is the one rule's answer for its mode
  // (`processing-split.ts`), carried on the index: a tool with no worker
  // path and no pdf.js reader rewrites with pdf-lib, which refuses /Encrypt.
  const browserOnlyWriter =
    !tool.mayUpload && tool.hasBrowserPath && !tool.opensRestricted;
  const readsHereWithPdfLib = tool.hasBrowserPath && !tool.opensRestricted;
  switch (probe.lock) {
    case "password-required":
      // Nothing opens it without its password — not a viewer, not a worker.
      return tool.slug === UNLOCK ? null : "unlock-first";
    case "restricted":
      return browserOnlyWriter ? "unlock-first" : null;
    case "unknown":
      // pdf.js could not open it either: nothing in this tab will.
      return tool.hasBrowserPath ? "unlock-first" : null;
    case "none":
      if (probe.read !== "unreadable") return null;
      return readsHereWithPdfLib ? "repair-first" : null;
  }
}

function priorFor(
  tool: ToolIndexEntry,
  basis: readonly FileFacts[],
  anyJpg: boolean,
): number {
  const converter = CONVERTERS[tool.slug];
  if (converter !== undefined) return converter;
  if (tool.slug === JPG_TO_PDF) return anyJpg ? IMAGES_TO_PDF : OTHER;
  if (tool.slug === PNG_TO_PDF) return anyJpg ? OTHER : IMAGES_TO_PDF;
  const pdfs = basis.filter(isPdf).length;
  if (pdfs >= 2) {
    const many = MANY_PDFS[tool.slug];
    if (many !== undefined) return many;
    const oneFile =
      tool.handoffMode !== "collect" && tool.handoffMode !== "batch";
    return (ONE_PDF[tool.slug] ?? OTHER) * (oneFile ? ONE_FILE_SHARE : 1);
  }
  return ONE_PDF[tool.slug] ?? OTHER;
}

/** The fact a boost rests on, and how much it adds — or null. */
function boostFor(
  tool: ToolIndexEntry,
  opens: readonly FileFacts[],
  pdfsInMix: number,
): { points: number; evidence: Evidence; file: FileFacts } | null {
  const probed = opens
    .filter(isPdf)
    .map((f) => ({ f, probe: probeOf(f) }))
    .filter((x) => x.probe !== null);
  switch (tool.slug) {
    case OCR: {
      for (const { f, probe } of probed) {
        const range = imageOnlyRange(probe!);
        if (range)
          return {
            file: f,
            points: NO_TEXT_BOOST,
            evidence: {
              kind: "no-text",
              name: pdfsInMix > 1 ? f.name : null,
              ...range,
            },
          };
      }
      return null;
    }
    case FILL_FORMS: {
      const most = probed
        .filter((x) => (x.probe!.formFields ?? 0) >= 1)
        .sort((a, b) => b.probe!.formFields! - a.probe!.formFields!)[0];
      return most
        ? {
            file: most.f,
            points: FORM_BOOST,
            evidence: {
              kind: "fields",
              name: most.f.name,
              count: most.probe!.formFields!,
            },
          }
        : null;
    }
    case COMPRESS: {
      const largest = [...opens].sort((a, b) => b.size - a.size)[0];
      return largest && largest.size >= BIG_FILE_BYTES
        ? {
            file: largest,
            points: BIG_FILE_BOOST,
            evidence: {
              kind: "big-file",
              name: largest.name,
              bytes: largest.size,
            },
          }
        : null;
    }
    case SPLIT: {
      const longest = probed
        .filter((x) => (x.probe!.pages ?? 0) >= LONG_DOC_PAGES)
        .sort((a, b) => b.probe!.pages! - a.probe!.pages!)[0];
      return longest
        ? {
            file: longest.f,
            points: LONG_DOC_BOOST,
            evidence: {
              kind: "long",
              name: longest.f.name,
              pages: longest.probe!.pages!,
            },
          }
        : null;
    }
    default:
      return null;
  }
}

/** The count (and pages) of what a tool opens, in its own terms. */
function countEvidence(
  tool: ToolIndexEntry,
  opens: readonly FileFacts[],
): Evidence[] {
  if (tool.slug === COMPRESS) {
    return [{ kind: "size", bytes: opens.reduce((n, f) => n + f.size, 0) }];
  }
  const what = filesNoun(opens);
  const out: Evidence[] = [{ kind: "count", count: opens.length, ...what }];
  if (what.noun === "pdf") {
    const pages = opens.map((f) => probeOf(f)?.pages ?? null);
    if (pages.every((p): p is number => p !== null))
      out.push({ kind: "pages", pages: pages.reduce((a, b) => a + b, 0) });
  }
  return out;
}

/**
 * What some files are, in a count's words: PDFs, images, or files — of one
 * format when they share it. One reading for the count and for "you'll add
 * the 2 DOCX files there", so the two never call the same files different
 * things.
 */
function filesNoun(files: readonly FileFacts[]): {
  noun: "pdf" | "image" | "file";
  format: string | null;
} {
  if (files.length > 0 && files.every(isPdf))
    return { noun: "pdf", format: "PDF" };
  if (files.every((f) => f.format === "JPG" || f.format === "PNG"))
    return { noun: "image", format: null };
  const formats = new Set(files.map((f) => f.format));
  return { noun: "file", format: formats.size === 1 ? [...formats][0]! : null };
}

/** Rank the tools in `index` for `facts`. Pure and deterministic. */
export function rankForFiles<T extends ToolIndexEntry>(
  facts: readonly FileFacts[],
  index: readonly T[],
  ctx: RankContext = {},
): Ranking<T> {
  const usable = facts.filter((f) => !f.contradicted);
  // The files some tool here can open. One that none can (a HEIC, a renamed
  // file, a format nothing reads) is answered by its own note, and must not
  // count against every tool in "opens 2 of your 3 files" or the mix share.
  const total = Math.max(
    1,
    usable.filter(
      (f) =>
        f.format !== null &&
        index.some((t) => toolAcceptsFormat(t.accept, f.format)),
    ).length,
  );
  const anyJpg = usable.some((f) => f.format === "JPG");
  const pdfsInMix = usable.filter(isPdf).length;
  const trail = new Set(ctx.trail ?? []);
  const nameOf = (slug: string) =>
    index.find((t) => t.slug === slug)?.name ?? slug;

  const notes: RankNote[] = [];
  const unsupported = new Set<UnsupportedFormat>();
  for (const f of facts) {
    if (f.contradicted && f.format !== null) {
      notes.push({
        kind: "contradicted",
        name: f.name,
        named: f.format,
        actual: f.bytes ?? null,
      });
    } else if (f.format === null) {
      notes.push({ kind: "unrecognised", name: f.name });
    } else if (
      (UNSUPPORTED_FORMATS as readonly string[]).includes(f.format) &&
      !unsupported.has(f.format as UnsupportedFormat)
    ) {
      const format = f.format as UnsupportedFormat;
      unsupported.add(format);
      notes.push({
        kind: "unsupported",
        format,
        answer: unsupportedAnswer(format, index),
      });
    }
  }

  /** file id → the tools whose ceiling it is over, and the largest ceiling. */
  const over = new Map<string, { tools: string[]; ceiling: number }>();
  const recents = ctx.recents ?? [];
  const suggestions: Suggestion<T>[] = [];

  for (const tool of index) {
    if (trail.has(tool.slug)) continue;
    const accepted = usable.filter(
      (f) => f.format !== null && toolAcceptsFormat(tool.accept, f.format),
    );
    if (accepted.length === 0) continue;
    const ceiling = tool.ceilingBytes;
    const within = accepted.filter(
      (f) => ceiling !== null && f.size <= ceiling,
    );
    for (const f of accepted) {
      if (ceiling === null || f.size <= ceiling) continue;
      const entry = over.get(f.id) ?? { tools: [], ceiling: 0 };
      entry.tools.push(tool.name);
      entry.ceiling = Math.max(entry.ceiling, ceiling);
      over.set(f.id, entry);
    }
    if (within.length === 0) continue;

    const reasons = within.map((f) => blockFor(tool, f));
    const open = within.filter((_, i) => reasons[i] === null);
    const blocked: Blocked | null =
      open.length > 0
        ? null
        : reasons.includes("unlock-first")
          ? "unlock-first"
          : "repair-first";
    const locked = within.find((f) => (probeOf(f)?.lock ?? "none") !== "none");
    const broken = within.find((f) => probeOf(f)?.read === "unreadable");
    let pinned: Suggestion["pinned"] = null;
    if (tool.slug === UNLOCK && locked) pinned = "lock";
    else if (tool.slug === REPAIR && broken) pinned = "repair";
    else if (ctx.pending === tool.slug) pinned = "pending";
    else if (ctx.currentTool === tool.slug) pinned = "current";
    const boost = blocked ? null : boostFor(tool, open, pdfsInMix);
    // The file the leading fact names goes first — the pin's, else the
    // boost's — so a one-file tool carries the file that justified it, not
    // whichever was staged first.
    const subject =
      pinned === "lock"
        ? locked
        : pinned === "repair"
          ? broken
          : (boost?.file ?? null);
    const opens =
      subject && open.includes(subject)
        ? [subject, ...open.filter((f) => f !== subject)]
        : open;
    const basis = blocked ? within : opens;

    // What a launch carries — the gate's rule, from the index's fields.
    const eligible =
      tool.handoffMode === "none"
        ? []
        : opens.filter((f) =>
            toolAcceptsFormat(tool.accept, formatOf(f).format),
          );
    const sent =
      tool.handoffMode === "single" ? eligible.slice(0, 1) : eligible;

    const recent = Math.min(
      RECENT_CAP,
      recents.filter((slug) => slug === tool.slug).length * RECENT_BOOST,
    );
    const score =
      priorFor(tool, basis, anyJpg) * Math.sqrt(basis.length / total) +
      (boost?.points ?? 0) +
      recent;

    const evidence: Evidence[] = [];
    if (pinned === "lock" && locked) {
      const lock = probeOf(locked)!.lock;
      if (lock !== "none")
        evidence.push({ kind: "lock", name: locked.name, lock });
    } else if (pinned === "repair" && broken) {
      evidence.push({ kind: "unreadable", name: broken.name });
    } else if (boost) {
      evidence.push(boost.evidence);
    } else {
      evidence.push(...countEvidence(tool, basis));
    }
    if (tool.handoffMode === "single" && eligible.length > 1) {
      // Named once: when the fact before says which file, this need not.
      const taken = eligible[0]!;
      evidence.push({
        kind: "one-file",
        name: taken.name,
        named: subject === taken,
      });
    }
    if (basis.length < total) {
      evidence.push({ kind: "partial", opens: basis.length, total });
    }
    if (blocked) {
      evidence.push({
        kind: "after",
        tool: nameOf(blocked === "unlock-first" ? UNLOCK : REPAIR),
      });
    }
    if (tool.handoffMode === "none") {
      evidence.push({
        kind: "add-there",
        count: basis.length,
        name: basis.length === 1 ? basis[0]!.name : null,
        ...filesNoun(basis),
        all: basis.length === total,
      });
    }
    // A worker-only tool: the file moves when it starts. (A browser-first
    // tool's worker step is optional, and says so on its own page.)
    if (tool.mayUpload && !tool.hasBrowserPath) {
      evidence.push({ kind: "uploads" });
    }

    suggestions.push({
      slug: tool.slug,
      tool,
      score,
      evidence,
      opens: opens.map((f) => f.id),
      carry: { eligible: eligible.length, ids: sent.map((f) => f.id) },
      blocked,
      pinned,
      boosted: boost !== null,
    });
  }

  for (const f of facts) {
    const entry = over.get(f.id);
    if (!entry) continue;
    notes.push({
      kind: "over-ceiling",
      name: f.name,
      bytes: f.size,
      ceiling: entry.ceiling,
      tools: entry.tools,
    });
  }

  const PIN_ORDER = ["lock", "repair", "pending", "current"] as const;
  const position = new Map(index.map((t, i) => [t.slug, i]));
  const order = (a: Suggestion<T>, b: Suggestion<T>) => {
    const pa = a.pinned ? PIN_ORDER.indexOf(a.pinned) : PIN_ORDER.length;
    const pb = b.pinned ? PIN_ORDER.indexOf(b.pinned) : PIN_ORDER.length;
    return (
      pa - pb ||
      b.score - a.score ||
      Number(b.boosted) - Number(a.boosted) ||
      position.get(a.slug)! - position.get(b.slug)!
    );
  };
  const open = suggestions.filter((s) => !s.blocked).sort(order);
  const waiting = suggestions.filter((s) => s.blocked).sort(order);
  const topCount = ctx.topCount ?? TOP_SUGGESTIONS;
  return {
    top: open.slice(0, topCount),
    more: [...open.slice(topCount), ...waiting],
    notes,
  };
}

/**
 * Keep rows where a person last saw them: suggestions already shown stay in
 * their old order, and new ones follow in rank order. A list that reorders
 * under the pointer moves the row someone was about to press.
 */
export function holdOrder<S extends { readonly slug: string }>(
  previous: readonly string[],
  next: readonly S[],
): S[] {
  const at = new Map(previous.map((slug, i) => [slug, i]));
  const kept = next.filter((s) => at.has(s.slug));
  kept.sort((a, b) => at.get(a.slug)! - at.get(b.slug)!);
  return [...kept, ...next.filter((s) => !at.has(s.slug))];
}
