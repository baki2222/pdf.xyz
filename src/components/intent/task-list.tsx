import Link from "next/link";
import { ModeShape } from "@/components/tools/processing-badge";
import { renderEvidence } from "@/lib/intent/evidence";
import { getToolBySlug } from "@/lib/tools";
import { HERO_TASKS, type HeroTask } from "@/lib/tools/intents";
import { getProcessingMeta } from "@/lib/tools/processing";
import type { ProcessingMode } from "@/lib/tools/types";
import { TaskGlyph } from "./task-glyph";

/**
 * Where each shape's mode leaves a file — the legend a phone reads in place
 * of the words beside each task. A worker's is the ranking's own words for
 * the same fact (`renderEvidence`, "uploads only when you start it"), so the
 * desk and the ticket never describe one tool two ways.
 */
const LEGEND: Record<ProcessingMode, string> = {
  client: "stays in your browser",
  hybrid: "browser-first",
  server: renderEvidence({ kind: "uploads" }),
  ai: "sends its text only when you start it",
};

/** A task, its tool, and where that tool runs — read from the catalogue. */
function resolve(task: HeroTask) {
  const tool = getToolBySlug(task.slug);
  if (!tool) throw new Error(`hero task "${task.label}" names no tool`);
  return { ...task, mode: tool.processing };
}

/**
 * Six jobs to start from before a file is chosen, each a plain link to its
 * tool — server-rendered words and links (they are part of what a crawler
 * and a no-JavaScript reader get), each with its glyph and where it runs.
 *
 * A link's name is the task and then the mode word: on a phone the word is
 * not drawn (the shape is, and a legend under the grid says what each shape
 * means), but it is still read out.
 */
export function TaskList({
  tasks = HERO_TASKS,
  labelledBy,
}: {
  tasks?: readonly HeroTask[];
  labelledBy: string;
}) {
  const rows = tasks.map(resolve);
  const modes = MODES_IN_ORDER.filter((m) => rows.some((r) => r.mode === m));
  return (
    <>
      <ul
        aria-labelledby={labelledBy}
        className="grid grid-cols-2 gap-x-3 sm:gap-x-4"
      >
        {rows.map((task) => {
          const meta = getProcessingMeta(task.mode);
          return (
            <li key={task.slug}>
              <Link
                href={`/tools/${task.slug}`}
                className="group rounded-ctl hover:bg-wash -mx-1.5 flex min-h-10 items-center gap-2.5 px-1.5 py-1 transition-colors"
              >
                <TaskGlyph
                  name={task.glyph}
                  className="text-muted group-hover:text-fg transition-colors"
                />
                <span className="flex w-0 flex-1 flex-col">
                  <span className="text-fg text-[13px] leading-tight font-medium">
                    {task.label}
                    {/* On a phone the shape rides the label's last line and
                        the word is read, not drawn; the legend says it. */}
                    <ModeShape
                      mode={task.mode}
                      className="ml-1.5 inline-block align-[0.5px] sm:hidden"
                    />
                    <span className="sr-only sm:hidden">, {meta.short}</span>
                  </span>
                  <span className="text-faint mt-1 inline-flex items-center gap-1.5 font-mono text-[10px] leading-none tracking-wide uppercase max-sm:hidden">
                    <ModeShape mode={task.mode} />
                    {meta.short}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-faint mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-4 sm:hidden">
        {modes.map((mode) => (
          <span key={mode} className="inline-flex items-center gap-1.5">
            <ModeShape mode={mode} />
            {LEGEND[mode]}
          </span>
        ))}
      </p>
    </>
  );
}

const MODES_IN_ORDER: readonly ProcessingMode[] = [
  "client",
  "hybrid",
  "server",
  "ai",
];
