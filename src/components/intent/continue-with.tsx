"use client";

import { useId, useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { ModeShape } from "@/components/tools/processing-badge";
import {
  useToolRun,
  type ToolRun,
} from "@/components/tools/runner/tool-context";
import { NAME_WRAP } from "@/components/ui/name-wrap";
import {
  eligibleFilesFor,
  handoffCapabilityFor,
} from "@/lib/handoff/capability";
import { HANDOFF_MAX_TOTAL_BYTES } from "@/lib/handoff/record";
import { CONTINUE_SHOWN } from "@/lib/intent/continue-shown";
import { launchWithFiles } from "@/lib/intent/launch";
import { isPlainClick, toolHref } from "@/lib/intent/links";
import { continueTarget, type ContinueTarget } from "@/lib/intent/next-steps";
import { outputFiles, type RunOutput } from "@/lib/intent/run-output";
import { confirmLeave } from "@/lib/intent/unsaved";
import { getProcessingMeta } from "@/lib/tools/processing";
import { getToolBySlug } from "@/lib/tools";
import { cn, formatBytes } from "@/lib/utils";

/**
 * "Continue with": the result carried to the next tool, in this browser.
 *
 * The rows come from the page (`continueTargetsFor`, computed on the server
 * from the catalogue). Here they are narrowed by what is only known now:
 * the steps this job already went through (the trail) drop out, and so does
 * any tool this run's ACTUAL output cannot open — a split that made a ZIP
 * offers nothing, a batch of several PDFs only the tool that combines them,
 * and ONE file puts the tool that combines several after every other.
 * Four at most.
 *
 * Each row is a real link to its tool: without JavaScript, or with a
 * modifier held, it opens the plain tool page. A plain click carries the
 * output there as a hand-off (`launchWithFiles`, origin "result", the trail
 * plus this step), after the unsaved-work question. If the browser's
 * storage refuses the file, nothing navigates and the row says so, with
 * the plain link beside it — never an empty tool page with no word why.
 *
 * SIZE IS PART OF "OPENS THIS FILE". Two limits are known before any click,
 * and each is said with its figure rather than discovered on arrival:
 *  - a target's own ceiling (`ceilingBytes`, the figure its page states): a
 *    120 MB merge is not offered to Add Page Numbers, which refuses a PDF
 *    over 100 MB on arrival;
 *  - what one hand-off carries at all (`HANDOFF_MAX_TOTAL_BYTES`): over it,
 *    the stash refuses before storage is ever asked, so no row is offered,
 *    and the reason given is that budget — not "this browser's storage is
 *    unavailable", which is what any refused stash used to be called here,
 *    whatever refused it (WP-08 review, 2026-10-10).
 * So "Couldn't carry the file" is said only of a stash storage refused.
 */
export function ContinueWith({ output }: { output: RunOutput }) {
  const run = useToolRun();
  // Outside a tool page (a panel rendered on its own) there is no job to
  // continue — and no router to continue it with.
  return run ? <ContinueRows run={run} output={output} /> : null;
}

/** The tool a remedy's files are owed back to, as a Continue row. */
function returnTarget(run: ToolRun): ContinueTarget | null {
  if (!run.returnTo || run.returnTo === run.slug) return null;
  const tool = getToolBySlug(run.returnTo);
  if (!tool || !handoffCapabilityFor(tool.slug).supported) return null;
  return continueTarget(tool);
}

function ContinueRows({ run, output }: { run: ToolRun; output: RunOutput }) {
  const router = useRouter();
  const headingId = useId();
  const [launching, setLaunching] = useState<string | null>(null);
  const [failed, setFailed] = useState<ContinueTarget | null>(null);

  const files = outputFiles(output);
  const several = files.length > 1;
  const carried = (target: ContinueTarget) =>
    eligibleFilesFor(target.slug, [...files]);
  // A remedy's files go back first: Rotate sent a locked PDF to Unlock, so
  // Unlock's result continues to Rotate before anything the plan ranks.
  // Built here, from the catalogue, because the server's plan for this tool
  // cannot know who will send it a file to fix.
  const back = returnTarget(run);
  const offered = [
    ...(back ? [back] : []),
    ...run.plan.targets.filter((t) => t.slug !== back?.slug),
  ]
    .filter((t) => t.slug !== run.slug && !run.trail.includes(t.slug))
    .filter((t) => !several || t.combines)
    .filter((t) => carried(t).length === files.length);
  // One file carried: a tool that combines several (Merge PDF) opens with
  // it and asks for another, so it comes after every tool that works on
  // the one file, and never takes a row one of them would have had.
  const opens = several
    ? offered
    : [
        ...offered.filter((t) => !t.combines),
        ...offered.filter((t) => t.combines),
      ];
  const size = sizeOf(files);
  // One hand-off carries this much at most; past it nothing travels.
  const overBudget = size.total > HANDOFF_MAX_TOTAL_BYTES;
  const fits = (t: ContinueTarget) =>
    t.ceilingBytes === null || size.largest <= t.ceilingBytes;
  const targets = overBudget ? [] : opens.filter(fits).slice(0, CONTINUE_SHOWN);
  const refused = overBudget ? [] : opens.filter((t) => !fits(t));

  const what = several ? `${files.length} files` : files[0]!.name;

  if (targets.length === 0) {
    if (overBudget && opens.length > 0)
      return (
        <SizeNote>
          At {formatBytes(size.total)},{" "}
          {several ? "these files are" : "this file is"} more than the{" "}
          {formatBytes(HANDOFF_MAX_TOTAL_BYTES, 0)} this browser carries from
          one tool to the next. Download{" "}
          {several ? "them, then open them" : "it, then open it"} in the next
          tool.
        </SizeNote>
      );
    if (refused.length > 0)
      return (
        <SizeNote>
          Not offered: <TooLarge files={files} size={size} refused={refused} />{" "}
          Download {several ? "them" : "it"} to keep {several ? "them" : "it"}.
        </SizeNote>
      );
    return run.plan.none ? (
      <p data-no-continue="" className="text-muted text-xs leading-5">
        {run.plan.none}
      </p>
    ) : null;
  }

  const open = async (
    event: MouseEvent<HTMLAnchorElement>,
    target: ContinueTarget,
    rank: number,
  ) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    if (launching) return;
    setFailed(null);
    setLaunching(target.slug);
    const result = await launchWithFiles({
      toolSlug: target.slug,
      files: carried(target).map((f) => f.file()),
      origin: { kind: "result", fromSlug: run.slug },
      trail: [...run.trail, run.slug],
      suggestion: { source: "continue", rank },
      router,
      confirmLeave,
    });
    if (result === "failed") setFailed(target);
    if (result !== "carried") setLaunching(null);
  };

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      data-continue-with=""
      className="flex flex-col gap-2.5"
    >
      <p id={headingId} className="kicker text-faint">
        Continue with
      </p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {targets.map((target, i) => {
          const mode = getProcessingMeta(target.processing);
          const busy = launching === target.slug;
          return (
            <li key={target.slug} className="min-w-0">
              {/* Named by its words, which say what the click does:
                  "Continue with Compress PDF · In-browser · carries
                  merged.pdf" — the visible label inside the name. Said
                  outright (`aria-label`): from its content the name ran
                  "In-browsercarries", the " · " between them drawn
                  aria-hidden (PR #180 review). */}
              <a
                href={toolHref(target.slug)}
                onClick={(event) => void open(event, target, i + 1)}
                aria-busy={busy || undefined}
                aria-label={`Continue with ${target.name} · ${mode.short} · carries ${what}`}
                className="group border-line bg-panel hover:border-line-strong rounded-ctl flex min-h-10 items-center gap-3 border px-3.5 py-2.5 transition-colors"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-fg text-sm font-medium">
                    <span className="sr-only">Continue with </span>
                    {target.name}
                  </span>
                  {/* Carries the visitor's file name: wrapped, never cut
                      (NAME_WRAP) — a phone keeps it whole on its width. */}
                  <span className={cn("text-muted text-xs", NAME_WRAP)}>
                    <ModeShape
                      mode={target.processing}
                      className="mr-1.5 inline-block"
                    />
                    {mode.short}
                    <span aria-hidden className="text-faint">
                      {" · "}
                    </span>
                    carries {what}
                  </span>
                </span>
                {busy ? (
                  <Loader2
                    className="text-muted size-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                ) : (
                  <ArrowRight
                    className="text-faint group-hover:text-fg size-4 shrink-0 transition-[color,translate] motion-safe:group-hover:translate-x-0.5"
                    aria-hidden
                  />
                )}
              </a>
            </li>
          );
        })}
      </ul>
      {refused.length > 0 && (
        <SizeNote>
          Not offered: <TooLarge files={files} size={size} refused={refused} />
        </SizeNote>
      )}
      {failed && (
        <p
          role="alert"
          className={cn("text-warn text-xs leading-5", NAME_WRAP)}
        >
          Couldn&apos;t carry the file — this browser&apos;s storage is
          unavailable. Download it, then open {failed.name}:{" "}
          <a
            href={toolHref(failed.slug)}
            className="text-fg font-medium underline underline-offset-2"
          >
            {failed.name}
          </a>
          .
        </p>
      )}
    </div>
  );
}

type OutputList = ReturnType<typeof outputFiles>;

/** The output's total and its largest file: the two sizes a hand-off meets. */
function sizeOf(files: OutputList) {
  return {
    total: files.reduce((sum, f) => sum + f.size, 0),
    largest: files.reduce((max, f) => Math.max(max, f.size), 0),
  };
}

/**
 * "merged.pdf is 120.0 MB — Add Page Numbers and Watermark PDF open files
 * up to 100 MB." The ceiling said is the largest among the refused, which
 * is true of each of them.
 */
function TooLarge({
  files,
  size,
  refused,
}: {
  files: OutputList;
  size: { largest: number };
  refused: readonly ContinueTarget[];
}) {
  const ceiling = Math.max(...refused.map((t) => t.ceilingBytes ?? 0));
  const names = refused.map((t) => t.name);
  const listed =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  return (
    <>
      {files.length > 1 ? "the largest of these files" : files[0]!.name} is{" "}
      {formatBytes(size.largest)} — {listed}{" "}
      {names.length === 1 ? "opens" : "open"} files up to{" "}
      {formatBytes(ceiling, 0)}.
    </>
  );
}

/** Why a row is not offered, when the reason is the file's size. */
function SizeNote({ children }: { children: ReactNode }) {
  return (
    <p
      data-continue-refused=""
      className={cn("text-muted text-xs leading-5", NAME_WRAP)}
    >
      {children}
    </p>
  );
}
