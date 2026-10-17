/**
 * Where a finished file can go next: the tools a result's "Continue with"
 * row offers, computed on the tool's SERVER page from the catalogue and
 * handed to the runner as plain data — never shipped as a graph.
 *
 * Every row is a promise that the tool opens this file, in this browser,
 * carried there by one click. So the candidates are DERIVED, not listed:
 *
 *  1. a tool that takes one of this tool's output formats, and that a
 *     hand-off can reach (`handoffCapabilityFor` — a tool with no
 *     in-browser runner has nothing to carry the file into yet);
 *  2. minus the tool itself, and its INVERSE — a converter's way back
 *     (PDF to JPG is never followed by JPG to PDF), plus the few
 *     same-format steps the format rule cannot see (a merge undone by a
 *     split, a flattened form sent to be filled);
 *  3. narrowed by policy where the output says so: after Sign PDF only the
 *     steps that finish a signed document; after Protect PDF and PDF to
 *     PDF/A nothing, with the reason said — on the result (`ContinueWith`,
 *     or a worker panel's `ResultCard`, which the page gives the same job).
 *
 * "Opens this file" has a SIZE half the formats cannot see: every target
 * carries its per-file ceiling (`ceilingBytes`, from `toolFileCeilingBytes`
 * — the figure the target's own page states and its gate refuses above),
 * and the row drops a target the output is larger than, saying why, rather
 * than offer a tool that refuses the file on arrival.
 *
 * Text, Markdown, image and archive outputs end up with nothing by rule 2
 * alone: only their inverses take them. Nothing here says so by name.
 *
 * ORDER: a curated `Tool.next`, then the tool's own `related` list, then
 * {@link PRIORITY}. The runner drops what the job has already been through
 * (the trail, known only in the browser) and what this run's actual output
 * cannot open, then shows {@link CONTINUE_SHOWN}.
 *
 * `next-steps.test.ts` holds every property above on the real catalogue,
 * with a positive control that the inverse assertion fails when the rule
 * is switched off.
 */
import {
  handoffCapabilityFor,
  type HandoffMode,
} from "@/lib/handoff/capability";
import { normalizeFormatLabel } from "@/lib/jobs/mime-by-format";
import { toolFileCeilingBytes } from "@/lib/tools/file-ceilings";
import type { ProcessingMode, Tool } from "@/lib/tools/types";
import { CONTINUE_SHOWN } from "./continue-shown";
import { toolAcceptsFormat, type FileFormat } from "./formats";

export { CONTINUE_SHOWN };

/** One tool a result may continue in — plain data, sent from the server. */
export interface ContinueTarget {
  readonly slug: string;
  readonly name: string;
  readonly processing: ProcessingMode;
  /** How the tool takes files: one, each of several, or several into one. */
  readonly mode: Exclude<HandoffMode, "none">;
  /**
   * Takes several files and makes ONE of the same kind (Merge PDF): the only
   * kind of tool a run that produced several files may continue in.
   */
  readonly combines: boolean;
  /**
   * The largest file the target opens, in bytes (`toolFileCeilingBytes`);
   * `null` when it takes no file of its own. A row whose output is larger
   * is not offered.
   */
  readonly ceilingBytes: number | null;
}

export interface ContinuePlan {
  /** Ranked, at most {@link CANDIDATES}; the runner filters, then shows four. */
  readonly targets: readonly ContinueTarget[];
  /** Why nothing is offered, when the output itself is the reason. */
  readonly none?: string;
}

/**
 * How many the server sends: enough that the trail and the run's own output
 * can drop some and still leave four, few enough to stay a short list.
 */
const CANDIDATES = 8;

/**
 * The order after a tool's own `next` and `related`: the steps people take
 * most often after a document is done, finishing steps first.
 */
const PRIORITY: readonly string[] = [
  "compress-pdf",
  "page-numbers",
  "sign-pdf",
  "merge-pdf",
  "watermark-pdf",
  "protect-pdf",
  "organize-pages",
  "split-pdf",
  "rotate-pdf",
  "edit-pdf",
  "flatten-pdf",
];

/**
 * After a signature, the steps that FINISH a signed document. Anything that
 * rewrites its pages (an edit, a watermark) would be a change after signing.
 */
export const FINISHING_STEPS: readonly string[] = [
  "flatten-pdf",
  "protect-pdf",
  "compress-pdf",
];
const FINISHING_ONLY: Readonly<Record<string, readonly string[]>> = {
  "sign-pdf": FINISHING_STEPS,
};

/** Outputs nothing here should touch again, and the sentence that says why. */
export const NO_CONTINUE: Readonly<Record<string, string>> = {
  "protect-pdf":
    "This PDF is encrypted now, so the tools in your browser can't open it.",
  "pdf-to-pdfa":
    "Further edits would break the file's PDF/A conformance, so nothing is offered after this one.",
};

/**
 * What the format rule cannot see, because both tools take and make PDFs:
 * `[after, never]` — a step that undoes `after` (a merge split apart again,
 * a split merged back), or one `after` left nothing to work on (a flattened
 * form has no fields left to fill).
 */
const UNDONE_BY: ReadonlyArray<readonly [string, string]> = [
  ["merge-pdf", "split-pdf"],
  ["split-pdf", "merge-pdf"],
  ["flatten-pdf", "fill-forms"],
];

const formatsOf = (labels: readonly string[]): string[] =>
  labels.map((label) => normalizeFormatLabel(label));

const takes = (target: Tool, format: string): boolean =>
  toolAcceptsFormat(target.accept, format as FileFormat);

/**
 * Is `candidate` the way back from `tool`? A converter's inverse takes what
 * the converter makes and makes what it took (PDF to JPG / JPG to PDF); a
 * tool that keeps its format (PDF in, PDF out) has no format inverse, only
 * the pairs in {@link UNDONE_BY}.
 */
export function isInverse(tool: Tool, candidate: Tool): boolean {
  if (
    UNDONE_BY.some(
      ([after, never]) => after === tool.slug && never === candidate.slug,
    )
  )
    return true;
  const accepted = formatsOf(tool.accept);
  const produced = formatsOf(tool.outputs);
  const converts = !accepted.some((f) => produced.includes(f));
  if (!converts) return false;
  return (
    produced.some((f) => takes(candidate, f)) &&
    formatsOf(candidate.outputs).some((f) => accepted.includes(f))
  );
}

/** Rules a test may swap, to prove an assertion sees the defect it is for. */
export interface ContinueRules {
  readonly inverse: (tool: Tool, candidate: Tool) => boolean;
}
const RULES: ContinueRules = { inverse: isInverse };

/** Where a finished `tool`'s output can go next, from the whole catalogue. */
export function continueTargetsFor(
  tool: Tool,
  all: readonly Tool[],
  rules: ContinueRules = RULES,
): ContinuePlan {
  const none = NO_CONTINUE[tool.slug];
  if (none !== undefined) return { targets: [], none };

  const produced = formatsOf(tool.outputs);
  const only = FINISHING_ONLY[tool.slug];
  const bySlug = new Map(all.map((t) => [t.slug, t]));
  const candidates = all.filter(
    (candidate) =>
      candidate.slug !== tool.slug &&
      handoffCapabilityFor(candidate.slug).supported &&
      produced.some((f) => takes(candidate, f)) &&
      !rules.inverse(tool, candidate) &&
      (only === undefined || only.includes(candidate.slug)),
  );
  const eligible = new Set(candidates.map((c) => c.slug));

  const order: string[] = [];
  for (const slug of [
    ...(only ?? []),
    ...(tool.next ?? []),
    ...(tool.related ?? []),
    ...PRIORITY,
    ...candidates.map((c) => c.slug),
  ])
    if (eligible.has(slug) && !order.includes(slug)) order.push(slug);

  return {
    targets: order.slice(0, CANDIDATES).map((slug) => {
      const target = bySlug.get(slug)!;
      const mode = handoffCapabilityFor(slug).mode as ContinueTarget["mode"];
      const accepted = formatsOf(target.accept);
      return {
        slug,
        name: target.name,
        processing: target.processing,
        mode,
        combines:
          mode === "collect" &&
          formatsOf(target.outputs).every((f) => accepted.includes(f)),
        ceilingBytes: toolFileCeilingBytes(target),
      };
    }),
  };
}
