"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PipelineStage } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { stageForPhase, type PhaseEvent } from "@/lib/workers/phases";
import { cn, formatBytes } from "@/lib/utils";
import { announceOutcome } from "@/components/a11y/live-region";

/** What a docket row is showing. */
export type StageState =
  "pending" | "current" | "done" | "passed" | "failed" | "scheduled";

export interface StageRow {
  readonly stage: PipelineStage;
  readonly state: StageState;
  /** How long it took, when it was observed and has ended. */
  readonly ms: number | null;
}

/** A job can announce at most this many stage changes (spec C.2). */
export const MAX_ANNOUNCEMENTS = 5;

/**
 * Each stage's state, from the phases the browser observed — and from
 * nothing else. A stage the polling never saw (a fast scan between two
 * reads) but that a later stage proves is behind the job reads "passed",
 * with no time: we know it happened, not how long it took. Auto-delete is
 * always "scheduled": nothing in the browser can see it happen.
 */
export function stageRows(
  stages: readonly PipelineStage[],
  events: readonly PhaseEvent[],
): StageRow[] {
  // Each observed stage's span: from the first phase that stamped it to the
  // first later phase that did not (the next stage, a queue wait, the end).
  const spans = new Map<
    string,
    { at: number; end: number | null; endedBy: PhaseEvent["phase"] | null }
  >();
  let open: string | null = null;
  for (const event of events) {
    const id = stageForPhase(event.phase, stages);
    if (id === open) continue;
    const span = open === null ? undefined : spans.get(open);
    if (span && span.end === null) {
      span.end = event.at;
      span.endedBy = event.phase;
    }
    open = id;
    if (id !== null && !spans.has(id))
      spans.set(id, { at: event.at, end: null, endedBy: null });
  }
  const finished = events[events.length - 1]?.phase === "done";
  // The furthest stage the job is known to have reached.
  let reached = finished ? stages.length : -1;
  stages.forEach((stage, i) => {
    if (spans.has(stage.id)) reached = Math.max(reached, i);
  });

  return stages.map((stage, i): StageRow => {
    if (stage.id === "delete") return { stage, state: "scheduled", ms: null };
    const span = spans.get(stage.id);
    if (!span)
      return { stage, state: i < reached ? "passed" : "pending", ms: null };
    if (span.end === null) return { stage, state: "current", ms: null };
    if (span.endedBy === "failed") return { stage, state: "failed", ms: null };
    return { stage, state: "done", ms: span.end - span.at };
  });
}

/** `0:01.9` — minutes, seconds and tenths. */
export function formatElapsed(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const seconds = (tenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

const MARKER: Record<StageState, string> = {
  pending: "border border-line-strong",
  current: "border border-accent bg-accent/15 animate-pulse",
  done: "bg-invert",
  passed: "bg-invert",
  failed: "bg-warn",
  scheduled: "border border-dashed border-line-strong",
};

function metaFor(row: StageRow, bytes: number | undefined): string {
  switch (row.state) {
    case "pending":
      return "";
    case "current":
      return "▸ running";
    case "passed":
      return "passed";
    case "failed":
      return "stopped";
    case "scheduled":
      return `scheduled · outputs expire after ${DEFAULT_RETENTION.outputTtlMinutes} minutes`;
    case "done": {
      const size =
        row.stage.id === "upload" && bytes !== undefined
          ? `${formatBytes(bytes)}  `
          : "";
      return row.ms === null ? `${size}✓` : `${size}${formatElapsed(row.ms)} ✓`;
    }
  }
}

/** What a screen reader hears when a row changes. */
function announcement(row: StageRow): string | null {
  switch (row.state) {
    case "current":
      return `${row.stage.title}: running.`;
    case "done":
      return `${row.stage.title}: done.`;
    case "failed":
      return `${row.stage.title}: stopped.`;
    default:
      return null;
  }
}

/**
 * The job docket: the stages this tool's job moves through, stamped live as
 * the browser observes them (spec D.7, E.10). Before a run it is the same
 * honest "what happens to your file" list the panels always showed — the
 * stage descriptions are its `<details>` — and every row is one line, so a
 * status answer that renames the checks stage moves nothing under it.
 */
export function LiveStages({
  stages,
  events,
  bytes,
}: {
  stages: readonly PipelineStage[];
  events: readonly PhaseEvent[];
  /** The upload's size, for its row. */
  bytes?: number;
}) {
  const rows = stageRows(stages, events);
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const last = events[events.length - 1]?.phase;
  // Spoken through the app's one live region, and only while the job runs:
  // its end is the result card's (or the error's) to announce.
  useAnnouncements(
    rows,
    last === undefined || last === "done" || last === "failed",
  );
  return (
    <div className="flex flex-col gap-2" data-docket="">
      <h3 className="text-faint kicker">What happens to your file</h3>
      <ol className="divide-line border-line rounded-ctl divide-y border px-3">
        {rows.map((row) => (
          <li
            key={row.stage.id}
            aria-current={row.state === "current" ? "step" : undefined}
            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm"
          >
            <span
              aria-hidden
              className={cn("rounded-tag size-3 shrink-0", MARKER[row.state])}
            />
            <span
              className={cn(
                "font-medium",
                row.state === "pending" || row.state === "scheduled"
                  ? "text-muted"
                  : "text-fg",
              )}
            >
              {row.stage.title}
            </span>
            <span className="text-muted ml-auto font-mono text-xs tabular-nums">
              {metaFor(row, bytes)}
            </span>
          </li>
        ))}
      </ol>
      {/* A disclosure button, not <details>: that is an ARIA "group", and a
          result card is the panel's one group (tests and screen readers
          find the result by it). Collapsed by default so a status answer
          that rewrites the checks stage's description moves nothing; in the
          HTML either way, so every crawler reads every stage's words. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((was) => !was)}
        className="text-muted hover:text-fg self-start text-xs font-medium underline-offset-4 transition hover:underline"
      >
        What each step does
      </button>
      <dl
        id={detailsId}
        hidden={!open}
        className="text-muted flex flex-col gap-2 text-xs leading-relaxed"
      >
        {stages.map((stage) => (
          <div key={stage.id}>
            <dt className="text-fg font-medium">{stage.title}</dt>
            <dd>{stage.description}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Speaks the latest row change, at most {@link MAX_ANNOUNCEMENTS} per job. */
function useAnnouncements(rows: StageRow[], quiet: boolean): void {
  const count = useRef(0);
  const last = useRef("");
  const key = rows.map((r) => `${r.stage.id}:${r.state}`).join("|");
  const idle = rows.every(
    (r) => r.state === "pending" || r.state === "scheduled",
  );
  useEffect(() => {
    if (idle) {
      // A new job starts the count again.
      count.current = 0;
      last.current = "";
      return;
    }
    if (quiet) return;
    const changed = rows
      .map(announcement)
      .filter((line): line is string => line !== null);
    const next = changed[changed.length - 1] ?? "";
    if (!next || next === last.current) return;
    if (count.current >= MAX_ANNOUNCEMENTS) return;
    count.current += 1;
    last.current = next;
    announceOutcome(next);
    // `rows` is read through `key`, which names every state it holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, idle, quiet]);
}
