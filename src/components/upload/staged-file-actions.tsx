"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { handoffCapabilityFor, handoffPayload } from "@/lib/handoff";
import { launchWithFiles } from "@/lib/intent/launch";
import { getToolBySlug } from "@/lib/tools";
import { createWorkspaceFile, suggestTools } from "@/lib/workspace";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** How many one-click tools the zone offers for the staged files. */
export const STAGED_TOOL_CHOICES = 3;

interface Choice {
  slug: string;
  name: string;
  reason: string;
}

/**
 * What a visitor can do with the files they just dropped on the homepage.
 *
 * WHAT SHIPPED BEFORE: the zone kept only each file's name and size, and its
 * button was a plain link to `/workspace`. A visitor dropped a PDF, saw it
 * listed, clicked the primary button, and landed on "No files staged yet" —
 * the site's main conversion path began by throwing their work away.
 *
 * Now the zone keeps the `File`s themselves, and this offers the tools that
 * fit them (the workspace's own `suggestTools`). A tool that can receive a
 * hand-off gets a button that stashes the files in browser-local storage and
 * opens the tool with them loaded, through `launchWithFiles` — the same
 * launch the workspace uses, so the two cannot disagree about which files
 * travel, and the record says they came from a drop here, not from a
 * workspace they never visited. A launch whose files could not be stored
 * says so with a plain link instead of opening an empty tool. A tool that cannot receive one (it runs on a worker, or none
 * of the files are its kind) is offered as a plain link whose text says the
 * file has to be picked again there, because it does.
 *
 * Mounted only once a file is staged, and loaded lazily by the zone, so the
 * router, the catalogue and the hand-off store cost the homepage nothing
 * until someone actually drops a file.
 */
export default function StagedFileActions({ files }: { files: File[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const readyLabel = useId();

  const { ready, elsewhere } = useMemo(() => {
    const staged = files.map((file, index) =>
      createWorkspaceFile(
        { name: file.name, size: file.size, type: file.type },
        String(index),
        0,
      ),
    );
    const choices: (Choice & { carries: boolean })[] = suggestTools(staged)
      .map((s) => {
        const tool = getToolBySlug(s.slug);
        if (!tool) return null;
        const cap = handoffCapabilityFor(s.slug);
        const carries =
          handoffPayload(s.slug, files).length >= Math.max(1, cap.minFiles);
        return { slug: s.slug, name: tool.name, reason: s.reason, carries };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    return {
      ready: choices.filter((c) => c.carries).slice(0, STAGED_TOOL_CHOICES),
      elsewhere: choices.filter((c) => !c.carries).slice(0, 2),
    };
  }, [files]);

  // A hand-off that could not be stored: said here, with a plain way on.
  const [failed, setFailed] = useState<Choice | null>(null);

  const open = (choice: Choice, rank: number) => {
    if (pending) return;
    setPending(choice.slug);
    setFailed(null);
    void launchWithFiles({
      toolSlug: choice.slug,
      files,
      // Where these files came from — the tool page says so, and never
      // "from your workspace" for a file that did not visit it.
      origin: { kind: "drop", surface: "home" },
      suggestion: { source: "desk", rank },
      router,
    }).then((result) => {
      if (result === "carried" || result === "plain") return;
      setPending(null);
      if (result === "failed") setFailed(choice);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {ready.length > 0 && (
        <div className="flex flex-col gap-2">
          <p
            id={readyLabel}
            className="text-faint font-mono text-[11px] font-medium tracking-[0.18em] uppercase"
          >
            Continue with your {files.length === 1 ? "file" : "files"}
          </p>
          <ul aria-labelledby={readyLabel} className="flex flex-col gap-1.5">
            {ready.map((choice, i) => (
              <li key={choice.slug}>
                <button
                  type="button"
                  onClick={() => open(choice, i + 1)}
                  // Not `disabled`: that would drop the focused button out of
                  // the focus order mid-launch (run-trigger-focus.test.ts).
                  // `open` ignores clicks while one is pending.
                  aria-disabled={pending !== null}
                  aria-busy={pending === choice.slug}
                  className={cn(
                    "group border-line bg-canvas hover:border-fg/40 flex w-full items-center justify-between gap-3 rounded-[3px] border px-3 py-2.5 text-left transition-colors",
                    "aria-disabled:cursor-wait aria-disabled:opacity-70",
                  )}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-fg group-hover:text-accent text-sm font-medium transition-colors">
                      {pending === choice.slug
                        ? `Opening ${choice.name}…`
                        : choice.name}
                    </span>
                    <span className="text-muted truncate text-xs">
                      {choice.reason}
                    </span>
                  </span>
                  {pending === choice.slug ? (
                    <Loader2
                      className="text-muted size-4 shrink-0 animate-spin"
                      aria-hidden
                    />
                  ) : (
                    <ArrowRight
                      className="text-faint group-hover:text-accent size-4 shrink-0 transition-colors"
                      aria-hidden
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {failed && (
        <p role="alert" className="text-warn text-xs leading-relaxed">
          Couldn&apos;t carry your {files.length === 1 ? "file" : "files"} to{" "}
          {failed.name} in this browser.{" "}
          <Link
            href={`/tools/${failed.slug}`}
            className="text-accent underline underline-offset-4"
          >
            Open {failed.name}
          </Link>{" "}
          and add {files.length === 1 ? "it" : "them"} there.
        </p>
      )}

      {elsewhere.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-muted text-xs">
            {ready.length > 0 ? "Also fits: " : ""}these tools open without your{" "}
            {files.length === 1 ? "file" : "files"}, so you choose{" "}
            {files.length === 1 ? "it" : "them"} again there.
          </p>
          <div className="flex flex-wrap gap-2">
            {elsewhere.map((choice) => (
              <Link
                key={choice.slug}
                href={`/tools/${choice.slug}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Open {choice.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {ready.length === 0 && elsewhere.length === 0 && (
        <p className="text-muted text-xs">
          No tool here takes {files.length === 1 ? "this file" : "these files"}{" "}
          as it is.{" "}
          <Link href="/tools" className="text-accent underline">
            Browse all tools
          </Link>
          .
        </p>
      )}
    </div>
  );
}
