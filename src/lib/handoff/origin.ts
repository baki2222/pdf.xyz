/**
 * Where a hand-off came from, what it carries besides its files, and the
 * sentence a receiving page says about it.
 *
 * A hand-off used to be bytes and a target and nothing else, so every page
 * that received one said "Loaded 2 files from your workspace." — including
 * for files dropped on the home page, which never visited the workspace.
 * Every record now carries its ORIGIN, and every creator must supply one
 * (`stashHandoff`, `HandoffStore.create` and `launchWithFiles` all require
 * it, so the compiler is the guard). A record stored before origins existed
 * can only have come from the workspace, so it reads as one; a malformed
 * origin is not trusted either way.
 *
 * Copy lives here, so this file is in the copy guards' walk
 * (`copyFiles()` lists it by name), and `origin.test.ts` renders every
 * phrase and runs the rendered text through the predicates a source scan
 * cannot apply to interpolated words.
 */

/** The workspace page claims hand-offs addressed to this target. */
export const HANDOFF_TARGET_WORKSPACE = "workspace";
/**
 * Files set aside while another step runs first ("Convert report.docx
 * first"), claimed back only by the step that follows (WP-08).
 */
export const HANDOFF_TARGET_PARKED = "parked";
/** Targets that are not tools — `origin.test.ts` holds that no slug is one. */
export const RESERVED_HANDOFF_TARGETS: readonly string[] = [
  HANDOFF_TARGET_WORKSPACE,
  HANDOFF_TARGET_PARKED,
];

/** Where files were dropped or picked, outside any tool. */
export const DROP_SURFACES = ["home", "guide", "dialog"] as const;
export type DropSurface = (typeof DROP_SURFACES)[number];

/** Why a remedy sent a file onward. */
export const REMEDY_PROBLEMS = ["encrypted", "unreadable"] as const;
export type RemedyProblem = (typeof REMEDY_PROBLEMS)[number];

/** What a preflight hint saw in the file it sent onward (E.9). */
export const HINT_REASONS = ["image-only", "form-fields"] as const;
export type HintOriginReason = (typeof HINT_REASONS)[number];

export type HandoffOrigin =
  /** Staged in the workspace and launched from it. */
  | { readonly kind: "workspace" }
  /** Dropped or picked on a page that is not a tool. */
  | { readonly kind: "drop"; readonly surface: DropSurface }
  /** The output of a tool, carried to the next one. */
  | { readonly kind: "result"; readonly fromSlug: string }
  /** A tool could not open the file, and sent it to the tool that fixes that. */
  | {
      readonly kind: "remedy";
      readonly fromSlug: string;
      readonly problem: RemedyProblem;
    }
  /** A tool's preflight hint sent the file to the tool better suited to it. */
  | {
      readonly kind: "hint";
      readonly fromSlug: string;
      readonly reason: HintOriginReason;
    };

/** Every origin kind, in one list the tests walk. */
export const HANDOFF_ORIGINS = [
  "workspace",
  "drop",
  "result",
  "remedy",
  "hint",
] as const satisfies readonly HandoffOrigin["kind"][];

// A kind added to the union but not to the list is a compile error here.
type UnlistedOrigin = Exclude<
  HandoffOrigin["kind"],
  (typeof HANDOFF_ORIGINS)[number]
>;
const everyOriginListed: [UnlistedOrigin] extends [never] ? true : never = true;
void everyOriginListed;

/** A step to take after the target tool, and the files set aside for it. */
export interface PendingStep {
  readonly toolSlug: string;
  /** The parked record's id, or null when nothing was set aside. */
  readonly parkedId: string | null;
}

/** Steps a job remembers: the trail drops its oldest beyond this. */
export const MAX_TRAIL = 6;

/** The provenance a creator hands the store with the files. */
export interface HandoffMeta {
  readonly origin: HandoffOrigin;
  readonly trail?: readonly string[];
  readonly pending?: PendingStep;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isSlug = (v: unknown): v is string =>
  typeof v === "string" && SLUG.test(v);

/**
 * The origin of a stored record. Absent: the workspace, the only creator
 * before origins were recorded. Malformed: the workspace too — never a
 * richer claim than the record can back.
 */
export function readOrigin(raw: unknown): HandoffOrigin {
  const fallback: HandoffOrigin = { kind: "workspace" };
  if (typeof raw !== "object" || raw === null) return fallback;
  const o = raw as Record<string, unknown>;
  switch (o.kind) {
    case "workspace":
      return { kind: "workspace" };
    case "drop":
      return (DROP_SURFACES as readonly unknown[]).includes(o.surface)
        ? { kind: "drop", surface: o.surface as DropSurface }
        : fallback;
    case "result":
      return isSlug(o.fromSlug)
        ? { kind: "result", fromSlug: o.fromSlug }
        : fallback;
    case "remedy":
      return isSlug(o.fromSlug) &&
        (REMEDY_PROBLEMS as readonly unknown[]).includes(o.problem)
        ? {
            kind: "remedy",
            fromSlug: o.fromSlug,
            problem: o.problem as RemedyProblem,
          }
        : fallback;
    case "hint":
      return isSlug(o.fromSlug) &&
        (HINT_REASONS as readonly unknown[]).includes(o.reason)
        ? {
            kind: "hint",
            fromSlug: o.fromSlug,
            reason: o.reason as HintOriginReason,
          }
        : fallback;
    default:
      return fallback;
  }
}

/** The slugs of a stored trail, the most recent {@link MAX_TRAIL}. */
export function readTrail(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSlug).slice(-MAX_TRAIL);
}

/** A stored pending step, or null when there is none or it is malformed. */
export function readPending(raw: unknown): PendingStep | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (!isSlug(p.toolSlug)) return null;
  if (p.parkedId !== null && typeof p.parkedId !== "string") return null;
  return { toolSlug: p.toolSlug, parkedId: p.parkedId };
}

/** What a receiving page knows when it says where the files came from. */
export interface OriginContext {
  /**
   * How many files the page loaded — after the gate, so possibly fewer than
   * were added. No phrase may read it as "all of them".
   */
  readonly count: number;
  /** The file's name, when there is exactly one to name. */
  readonly fileName: string | null;
  /** The name of the tool a result or remedy came from. */
  readonly fromName: string | null;
}

const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

/** The sentence a page says about files that arrived from `origin`. */
export function originPhrase(
  origin: HandoffOrigin,
  { count, fileName, fromName }: OriginContext,
): string {
  const from = fromName ?? "the previous tool";
  switch (origin.kind) {
    case "workspace":
      return `Loaded ${files(count)} from your workspace.`;
    case "drop":
      // A count, never "the file(s) you added": the gate keeps only what the
      // tool takes, so three PDFs sent to Sign PDF arrive as one, and "the
      // file you added" was false of them (review, 2026-10-09).
      return `Loaded ${files(count)} you added.`;
    case "result":
      return count <= 1
        ? `Loaded your result from ${from}.`
        : `Loaded ${files(count)}, with your result from ${from}.`;
    case "remedy": {
      const what = fileName ?? "your file";
      const why = origin.problem === "encrypted" ? "unlock" : "repair";
      return `Loaded ${what} from ${from} to ${why} it first.`;
    }
    case "hint": {
      const what = fileName ?? "your file";
      return origin.reason === "image-only"
        ? `Loaded ${what} from ${from} to make it searchable first.`
        : `Loaded ${what} from ${from} to fill in its fields.`;
    }
    default: {
      const unhandled: never = origin;
      return unhandled;
    }
  }
}
