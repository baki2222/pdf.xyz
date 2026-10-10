"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { DropSheet, type DropVia } from "@/components/upload/drop-sheet";
import type { HandoffOrigin } from "@/lib/handoff/origin";
import type { LaunchRouter } from "@/lib/intent/launch";
import { toolHref } from "@/lib/intent/links";
import { deliverToFallback } from "@/lib/intent/page-target";
import { confirmLeave } from "@/lib/intent/unsaved";

const noSubscription = () => () => {};

/**
 * The App Router, caught for the launch. Mounted only once the page is live:
 * the router is needed only when a file arrives, and the desk itself renders
 * wherever the guide does — including where there is no router to ask for
 * (a static render of the page, as its tests make).
 */
function RouterInto({
  onRouter,
}: {
  onRouter: (router: LaunchRouter) => void;
}) {
  const router = useRouter();
  useEffect(() => onRouter(router), [router, onRouter]);
  return null;
}

/** Where a guide desk's files came from, for the tool page to say. */
const ORIGIN: HandoffOrigin = { kind: "drop", surface: "guide" };

export interface GuideDeskProps {
  /** The guide's primary tool. */
  readonly tool: { readonly slug: string; readonly name: string };
  /**
   * What a hand-off brings it, from its live runner (`handoffCapabilityFor`
   * on the server): one file, several, or — a tool with no in-browser
   * runner — none, when the desk shows the tools that open the file instead
   * of promising to open it here.
   */
  readonly opens: "one" | "many" | null;
  /** The files it takes (`acceptNoun`): "a PDF" / "PDFs", "a JPG or PNG image". */
  readonly noun: { readonly one: string; readonly many: string };
  /** The picker's `accept`, from the same `accept` row. */
  readonly accept: string;
  /** `stagingHint(tool)`: what it accepts and the cap it refuses above. */
  readonly hint: string;
}

/**
 * A guide's own drop sheet: the file the guide teaches about goes straight
 * into the tool it teaches, already loaded — "drop on the guide, the tool
 * opens with it" (redesign G.7, "Guide: merge").
 *
 * The guide page's drop target (a file dropped or pasted anywhere on the
 * article lands here). Server-rendered with the page, so its picker works
 * before hydration; it holds no catalogue — everything about the tool
 * arrives as props, and the hand-off code is fetched when a file does.
 *
 * WHAT IT PROMISES is decided by the tool's runner, not by the guide: a
 * tool with no in-browser runner (PDF to Word, OCR, Protect, Translate,
 * Repair, Unlock) cannot be handed a file, so its desk says "see which
 * tools open it" and opens the ticket dialog, never "open PDF to Word with
 * it". And a file the tool does not take — read through the hand-off's own
 * gate (`eligibleFilesFor`), the one a launch passes, so the desk cannot
 * disagree with it — goes to the dialog too.
 */
export function GuideDesk({ tool, opens, noun, accept, hint }: GuideDeskProps) {
  const live = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const router = useRef<LaunchRouter | null>(null);
  const keepRouter = useCallback((r: LaunchRouter) => {
    router.current = r;
  }, []);
  const [state, setState] = useState<"idle" | "launching" | "failed">("idle");

  const onFiles = useCallback(
    async (files: File[], via: DropVia) => {
      if (opens === null) {
        deliverToFallback(files, via, { kind: "none" });
        return;
      }
      setState("launching");
      try {
        const [{ launchWithFiles }, { eligibleFilesFor }] = await Promise.all([
          import("@/lib/intent/launch"),
          import("@/lib/handoff/capability"),
        ]);
        if (!router.current) throw new Error("no router yet");
        if (eligibleFilesFor(tool.slug, files).length === 0) {
          setState("idle");
          deliverToFallback(files, via, { kind: "refused", name: tool.name });
          return;
        }
        const result = await launchWithFiles({
          toolSlug: tool.slug,
          files,
          origin: ORIGIN,
          suggestion: { source: "guide", rank: 1 },
          router: router.current,
          confirmLeave,
        });
        setState(result === "failed" ? "failed" : "idle");
      } catch {
        setState("failed");
      }
    },
    [opens, tool.slug, tool.name],
  );

  const title =
    opens === "many"
      ? `Drop your ${noun.many} to open ${tool.name} with them, or`
      : opens === "one"
        ? `Drop ${noun.one} to open ${tool.name} with it, or`
        : `Drop ${noun.one} to see which tools open it, or`;

  return (
    <div className="flex w-full flex-col gap-2" data-guide-desk="">
      {live && <RouterInto onRouter={keepRouter} />}
      <DropSheet
        variant="compact"
        accept={accept}
        multiple={opens !== "one"}
        title={title}
        hint={hint}
        onFiles={onFiles}
        pageTarget={{
          name: tool.name,
          verb: opens ? "open" : "check",
          canReceive: () => state !== "launching",
          // Whatever arrives is answered: the tool, or the dialog that says
          // what opens it instead.
          takes: () => true,
        }}
        className="w-full"
      />
      {state === "launching" && (
        <p role="status" className="text-muted text-xs">
          Opening {tool.name} with your file…
        </p>
      )}
      {state === "failed" && (
        <p
          role="alert"
          className="text-muted flex items-start gap-2 text-xs leading-snug"
        >
          <AlertTriangle className="text-warn size-3.5 shrink-0" aria-hidden />
          <span>
            Couldn&apos;t carry your file to {tool.name} in this browser.{" "}
            <a
              href={toolHref(tool.slug)}
              className="text-fg underline underline-offset-4"
            >
              Open {tool.name}
            </a>{" "}
            and add it there.
          </span>
        </p>
      )}
    </div>
  );
}
