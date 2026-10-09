import { processingMeta } from "./processing";
import type { ProcessingSplit } from "./processing-split";
import type { ProcessingMode, Tool } from "./types";

/**
 * The /tools "Where it runs" filter: what each choice is called, what it
 * holds, and how a sentence says it.
 *
 * The first choice names a PROPERTY — "Never uploads" — because that is the
 * question a reader filters by, and its members are the never-upload
 * partition itself (`processingSplit().neverUploads`), never "the tools whose
 * mode is client". Those are one set today; if a second mode that never
 * uploads ever exists, only the partition stays true. The other choices name
 * the mode a file can leave under, in that mode's own words from
 * `processing.ts`, and hold the tools of that mode among the ones that can
 * upload. Together they cover the catalogue exactly once
 * (`where-it-runs.test.ts`).
 *
 * Catalogue-free and partition-free on purpose: this module is imported by
 * the client explorer (for the ids, the words and the sentences), while the
 * MEMBERSHIP is computed on the server by {@link whereItRuns} and handed to
 * the explorer as slugs. `processingSplit` derives "uploads" through
 * `@/lib/jobs/capabilities`, which /tools does not otherwise ship.
 */

/** Every value `?runs=` can carry, in the order the choices are offered. */
export const RUNS_IDS = [
  "never-uploads",
  "browser-first",
  "secure-worker",
  "ai",
] as const;
export type RunsId = (typeof RUNS_IDS)[number];
/** A choice, or every tool. */
export type RunsFilter = RunsId | "all";

/** How a choice is named, and said in a sentence of one tool or many. */
export interface RunsCopy {
  /** The radio's words: "Never uploads", "Secure worker". */
  readonly label: string;
  /** "1 tool works without uploading". */
  readonly one: string;
  /** "29 tools work without uploading", "No tools … work without uploading". */
  readonly many: string;
}

/**
 * The words for each choice. The verb for "Never uploads" is said
 * positively — "work without uploading" — so an empty result never reads
 * "No tools never upload".
 */
export const RUNS_COPY: Readonly<Record<RunsId, RunsCopy>> = {
  "never-uploads": {
    label: "Never uploads",
    one: "works without uploading",
    many: "work without uploading",
  },
  "browser-first": {
    label: processingMeta.hybrid.label,
    one: "runs browser-first",
    many: "run browser-first",
  },
  "secure-worker": {
    label: processingMeta.server.label,
    one: "runs on a secure worker",
    many: "run on a secure worker",
  },
  ai: { label: processingMeta.ai.short, one: "uses AI", many: "use AI" },
};

/**
 * The choice that holds each mode's tools among those that CAN upload; null
 * for a mode none of whose tools can (they are the "Never uploads" choice).
 * Exhaustive over `ProcessingMode`, so a new mode is a compile error here;
 * and {@link whereItRuns} refuses an uploading tool whose mode has no choice,
 * rather than leaving it out of every one.
 */
const UPLOADING_CHOICE: Readonly<Record<ProcessingMode, RunsId | null>> = {
  client: null,
  hybrid: "browser-first",
  server: "secure-worker",
  ai: "ai",
};

/** One choice and its members. */
export interface RunsOption extends RunsCopy {
  readonly id: RunsId;
  /** The mode its tools share: the shape its radio wears. */
  readonly mode: ProcessingMode;
  readonly tools: readonly Tool[];
}

/** What the client explorer needs of a choice: no Tool objects, just slugs. */
export interface RunsChoice {
  readonly id: RunsId;
  readonly mode: ProcessingMode;
  readonly slugs: readonly string[];
}

/** The one mode a set of tools shares, or a thrown error naming the set. */
function soleMode(list: readonly Tool[], what: string): ProcessingMode {
  const modes = [...new Set(list.map((tool) => tool.processing))];
  if (modes.length !== 1)
    throw new Error(
      `"${what}" holds ${modes.length === 0 ? "no tools" : `tools of ${modes.length} modes (${modes.join(", ")})`}, so its radio has no single shape to wear`,
    );
  return modes[0]!;
}

/** The "Where it runs" choices, read off the partition. */
export function whereItRuns(split: ProcessingSplit): RunsOption[] {
  const options: RunsOption[] = [
    {
      id: "never-uploads",
      ...RUNS_COPY["never-uploads"],
      mode: soleMode(split.neverUploads, "never-uploads"),
      tools: split.neverUploads,
    },
  ];
  const byChoice = new Map<RunsId, Tool[]>();
  for (const tool of split.mayUpload) {
    const id = UPLOADING_CHOICE[tool.processing];
    if (!id)
      throw new Error(
        `${tool.slug} can upload its file, but its mode "${String(tool.processing)}" has no "Where it runs" choice`,
      );
    byChoice.set(id, [...(byChoice.get(id) ?? []), tool]);
  }
  for (const id of RUNS_IDS) {
    const members = byChoice.get(id);
    if (!members) continue;
    options.push({
      id,
      ...RUNS_COPY[id],
      mode: soleMode(members, id),
      tools: members,
    });
  }
  return options;
}

/** The choices as the client explorer takes them. */
export function runsChoices(options: readonly RunsOption[]): RunsChoice[] {
  return options.map(({ id, mode, tools }) => ({
    id,
    mode,
    slugs: tools.map((tool) => tool.slug),
  }));
}

/** `?runs=` as a choice, or "all" for anything else. */
export function runsFilter(value: string | null): RunsFilter {
  return value !== null && (RUNS_IDS as readonly string[]).includes(value)
    ? (value as RunsId)
    : "all";
}
