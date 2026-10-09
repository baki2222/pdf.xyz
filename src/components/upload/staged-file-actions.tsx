"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FolderInput, Loader2 } from "lucide-react";
import { handoffCapabilityFor } from "@/lib/handoff";
import { renderEvidence, type Evidence } from "@/lib/intent/evidence";
import { launchWithFiles, openWorkspaceWithFiles } from "@/lib/intent/launch";
import { buildToolIndex } from "@/lib/intent/tool-index";
import { createWorkspaceFile } from "@/lib/workspace";
import { suggestTools } from "@/lib/workspace/suggestions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** How many one-click tools the zone offers for the staged files. */
export const STAGED_TOOL_CHOICES = 3;

interface Choice {
  slug: string;
  name: string;
  /** The fact behind the suggestion, in the ranking's own words. */
  reason: string;
}

/** Facts, not terms: how a file reaches the tool is said by the layout here. */
const FACT_KINDS: ReadonlySet<Evidence["kind"]> = new Set<Evidence["kind"]>([
  "count",
  "pages",
  "size",
  "big-file",
  "long",
  "no-text",
  "fields",
  "lock",
  "unreadable",
  "one-file",
  "partial",
]);

/**
 * What a visitor can do with the files they just dropped on the homepage.
 *
 * WHAT SHIPPED BEFORE: the zone kept only each file's name and size, and its
 * button was a plain link to `/workspace`. A visitor dropped a PDF, saw it
 * listed, clicked the primary button, and landed on "No files staged yet" —
 * the site's main conversion path began by throwing their work away.
 *
 * Now the zone keeps the `File`s themselves, and this offers the tools the
 * ranking (`rankForFiles`, through the workspace's adapter) puts first, each
 * with the fact behind it. A tool that can receive a hand-off gets a button
 * that opens it with the files loaded, through `launchWithFiles` — the same
 * launch the workspace uses, so the two cannot disagree about which files
 * travel, and the record says they came from a drop here, not from a
 * workspace they never visited. A launch whose files could not be stored
 * says so with a plain link instead of opening an empty tool. A tool that
 * cannot receive one (it runs on a worker, or none of the files are its
 * kind) is offered as a plain link whose text says the file has to be picked
 * again there, because it does. "Open in workspace" carries every file there.
 *
 * Mounted only once a file is staged, and loaded lazily by the zone, so the
 * router, the catalogue, the ranking and the hand-off store cost the homepage
 * nothing until someone actually drops a file. WP-05's desk replaces it.
 */
export default function StagedFileActions({ files }: { files: File[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const readyLabel = useId();
  // A hand-off that could not be stored: said here, with a plain way on.
  const [failed, setFailed] = useState<{ name: string; href: string } | null>(
    null,
  );
  const index = useMemo(() => buildToolIndex(), []);

  const { ready, elsewhere } = useMemo(() => {
    const staged = files.map((file, i) =>
      createWorkspaceFile(
        { name: file.name, size: file.size, type: file.type },
        String(i),
        0,
      ),
    );
    const { top, more } = suggestTools(staged, index);
    const choices = [...top, ...more]
      .filter((s) => !s.blocked)
      .map((s) => ({
        slug: s.slug,
        name: s.tool.name,
        reason: s.evidence
          .filter((e) => FACT_KINDS.has(e.kind))
          .map(renderEvidence)
          .join(" · "),
        carries:
          s.carry.ids.length >=
          Math.max(1, handoffCapabilityFor(s.slug).minFiles),
        top: top.includes(s),
      }));
    return {
      ready: choices.filter((c) => c.carries).slice(0, STAGED_TOOL_CHOICES),
      elsewhere: choices.filter((c) => !c.carries && c.top).slice(0, 2),
    };
  }, [files, index]);

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
      if (result === "failed")
        setFailed({ name: choice.name, href: `/tools/${choice.slug}` });
    });
  };

  const openWorkspace = () => {
    if (pending) return;
    setPending("workspace");
    setFailed(null);
    void openWorkspaceWithFiles({
      files,
      origin: { kind: "drop", surface: "home" },
      router,
    }).then((result) => {
      if (result === "carried") return;
      setPending(null);
      if (result === "failed")
        setFailed({ name: "the workspace", href: "/workspace" });
    });
  };

  const one = files.length === 1;

  return (
    <div className="flex flex-col gap-3">
      {ready.length > 0 && (
        <div className="flex flex-col gap-2">
          <p id={readyLabel} className="kicker text-faint">
            Continue with your {one ? "file" : "files"}
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
                    "group border-line bg-canvas hover:border-fg/40 rounded-ctl flex w-full items-center justify-between gap-3 border px-3 py-2.5 text-left transition-colors",
                    "aria-disabled:cursor-wait aria-disabled:opacity-70",
                  )}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-fg group-hover:text-accent text-sm font-medium transition-colors">
                      {pending === choice.slug
                        ? `Opening ${choice.name}…`
                        : choice.name}
                    </span>
                    {choice.reason && (
                      <span className="text-muted truncate text-xs">
                        {choice.reason}
                      </span>
                    )}
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
          Couldn&apos;t carry your {one ? "file" : "files"} to {failed.name} in
          this browser.{" "}
          <Link
            href={failed.href}
            className="text-accent underline underline-offset-4"
          >
            Open {failed.name}
          </Link>{" "}
          and add {one ? "it" : "them"} there.
        </p>
      )}

      {elsewhere.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-muted text-xs">
            {ready.length > 0 ? "Also fits: " : ""}these tools open without your{" "}
            {one ? "file" : "files"}, so you choose {one ? "it" : "them"} again
            there.
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
          No tool here takes {one ? "this file" : "these files"} as it is.{" "}
          <Link href="/tools" className="text-accent underline">
            Browse all tools
          </Link>
          .
        </p>
      )}

      <button
        type="button"
        onClick={openWorkspace}
        aria-disabled={pending !== null}
        aria-busy={pending === "workspace"}
        className={cn(
          "text-muted hover:text-fg inline-flex items-center gap-1.5 self-start text-xs font-medium transition-colors",
          "aria-disabled:cursor-wait aria-disabled:opacity-70",
        )}
      >
        {pending === "workspace" ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <FolderInput className="size-3.5" aria-hidden />
        )}
        Open in workspace
        <span className="sr-only"> with your {one ? "file" : "files"}</span>
      </button>
    </div>
  );
}
