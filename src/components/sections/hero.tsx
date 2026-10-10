import Link from "next/link";
import { toolCount } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { buttonVariants } from "@/components/ui/button";
import { HeroDeskIsland } from "@/components/intent/hero-desk-island";
import { TaskList } from "@/components/intent/task-list";
import {
  acceptAttribute,
  acceptHint,
} from "@/components/upload/accepted-kinds";

/** The home desk's id: the target of every "Choose files" link on the page. */
export const UPLOAD_ANCHOR = "upload";

/** The task list's label, shared by the kicker and the list it names. */
const TASKS_LABEL = "desk-tasks";

const trust = [
  "No sign-up to start",
  "Most tools run in-browser",
  "AI built in, not bolted on",
];

/**
 * Prepress hero: the promise on the left, the working object on the right —
 * a desk a file is dropped on, which becomes the job ticket for that file.
 * No badge pill, no gradient text, no glow. The kicker is a mono spec line,
 * the headline is the grotesque with the promise carried on a process-cyan
 * sweep (the mark at 22% — text stays fg, so the line can never fail
 * contrast), and the desk wears the crop marks: the one place the trim-room
 * device appears on this screen, because it is where a real page will be.
 *
 * ONE ORDER FOR EVERY WIDTH. On a phone the desk comes right under the
 * headline — kicker, title, desk, lede, actions, trust — and from `lg` the
 * same DOM is placed in two columns by row and column (no template areas,
 * no reordering): the reading order is the visual order at both sizes.
 *
 * WAS a "Start for free" button beside the lede, aimed at the drop zone
 * beside it. The desk's own "Choose files" is now the page's first action,
 * so the lede keeps the two ways onward that are not a file: the workspace,
 * and the catalogue. "Start with" (six editorial picks) became the desk's
 * six tasks — each a job in a person's words, with where its tool runs.
 */
export function Hero() {
  return (
    <section className="border-line border-b">
      <Container className="grid grid-cols-1 pt-6 pb-16 sm:pt-12 lg:grid-cols-12 lg:grid-rows-[auto_auto_auto_auto_1fr] lg:gap-x-10 lg:pt-16 lg:pb-20">
        <p className="text-muted kicker lg:col-span-7 lg:row-start-1">
          Privacy-first PDF platform · {toolCount} tools
        </p>

        <h1 className="font-display text-fg text-display-1 mt-4 font-bold text-balance sm:mt-6 lg:col-span-7 lg:row-start-2 lg:pr-6">
          Every PDF tool. <span className="mark-sweep">Private by design.</span>
        </h1>

        <div className="mt-6 lg:col-span-5 lg:col-start-8 lg:row-span-5 lg:row-start-1 lg:mt-2 lg:self-start">
          <HeroDeskIsland
            id={UPLOAD_ANCHOR}
            accept={acceptAttribute()}
            acceptHint={acceptHint()}
            tasks={
              <>
                <p id={TASKS_LABEL} className="kicker text-faint">
                  Start from a task
                </p>
                <div className="mt-2">
                  <TaskList labelledBy={TASKS_LABEL} />
                </div>
              </>
            }
          />
        </div>

        <p className="text-muted mt-10 max-w-xl text-base leading-relaxed text-pretty sm:text-lg lg:col-span-7 lg:row-start-3 lg:mt-6 lg:pr-6">
          Merge, split, compress, convert, edit, sign, and run AI on your
          documents — in one fast, beautiful workspace. Most tools run entirely
          in your browser, so your files never leave your device.
        </p>

        <div className="mt-7 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6 lg:col-span-7 lg:row-start-4">
          <Link
            href="/workspace"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            Open workspace
          </Link>
          <Link
            href="/tools"
            className="text-fg decoration-line-strong hover:decoration-accent inline-flex items-center gap-1.5 text-[15px] font-medium underline decoration-1 underline-offset-[6px] transition-colors"
          >
            Browse all tools
          </Link>
        </div>

        <ul className="border-line mt-10 flex w-full flex-wrap items-center gap-x-7 gap-y-2 border-t pt-5 lg:col-span-7 lg:row-start-5 lg:self-end">
          {trust.map((label) => (
            <li
              key={label}
              className="text-muted inline-flex items-center gap-2 text-[13px]"
            >
              <span className="bg-mark size-1.5 shrink-0" aria-hidden />
              {label}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
