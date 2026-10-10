"use client";

import { useId, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { ModeShape } from "@/components/tools/processing-badge";
import {
  useToolRun,
  type ToolRun,
} from "@/components/tools/runner/tool-context";
import { NAME_WRAP } from "@/components/ui/name-wrap";
import { eligibleFilesFor } from "@/lib/handoff/capability";
import { launchWithFiles } from "@/lib/intent/launch";
import { isPlainClick, toolHref } from "@/lib/intent/links";
import { CONTINUE_SHOWN, type ContinueTarget } from "@/lib/intent/next-steps";
import { outputFiles, type RunOutput } from "@/lib/intent/run-output";
import { confirmLeave } from "@/lib/intent/unsaved";
import { getProcessingMeta } from "@/lib/tools/processing";
import { cn } from "@/lib/utils";

/**
 * "Continue with": the result carried to the next tool, in this browser.
 *
 * The rows come from the page (`continueTargetsFor`, computed on the server
 * from the catalogue). Here they are narrowed by what is only known now:
 * the steps this job already went through (the trail) drop out, and so does
 * any tool this run's ACTUAL output cannot open — a split that made a ZIP
 * offers nothing, a batch of several PDFs only the tool that combines them.
 * Four at most.
 *
 * Each row is a real link to its tool: without JavaScript, or with a
 * modifier held, it opens the plain tool page. A plain click carries the
 * output there as a hand-off (`launchWithFiles`, origin "result", the trail
 * plus this step), after the unsaved-work question. If the browser's
 * storage refuses the file, nothing navigates and the row says so, with
 * the plain link beside it — never an empty tool page with no word why.
 */
export function ContinueWith({ output }: { output: RunOutput }) {
  const run = useToolRun();
  // Outside a tool page (a panel rendered on its own) there is no job to
  // continue — and no router to continue it with.
  return run ? <ContinueRows run={run} output={output} /> : null;
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
  const targets = run.plan.targets
    .filter((t) => t.slug !== run.slug && !run.trail.includes(t.slug))
    .filter((t) => !several || t.combines)
    .filter((t) => carried(t).length === files.length)
    .slice(0, CONTINUE_SHOWN);

  if (targets.length === 0) {
    return run.plan.none ? (
      <p className="text-muted text-xs leading-5">{run.plan.none}</p>
    ) : null;
  }

  const what = several ? `${files.length} files` : files[0]!.name;

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
      <ul className="grid gap-2 sm:grid-cols-2">
        {targets.map((target, i) => {
          const mode = getProcessingMeta(target.processing);
          const busy = launching === target.slug;
          return (
            <li key={target.slug}>
              {/* Named by its words, which say what the click does:
                  "Continue with Compress PDF · In-browser · carries
                  merged.pdf" — the visible label inside the name. */}
              <a
                href={toolHref(target.slug)}
                onClick={(event) => void open(event, target, i + 1)}
                aria-busy={busy || undefined}
                className="group border-line bg-panel hover:border-line-strong rounded-ctl flex min-h-10 items-center gap-3 border px-3.5 py-2.5 transition-colors"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-fg text-sm font-medium">
                    <span className="sr-only">Continue with </span>
                    {target.name}
                  </span>
                  <span className="text-muted flex min-w-0 items-center gap-1.5 text-xs">
                    <ModeShape mode={target.processing} />
                    <span className="shrink-0">{mode.short}</span>
                    <span aria-hidden className="text-faint">
                      ·
                    </span>
                    <span className="truncate">carries {what}</span>
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
