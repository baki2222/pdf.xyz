"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  eligibleFilesFor,
  handoffCapabilityFor,
} from "@/lib/handoff/capability";
import { hintFor } from "@/lib/intent/hints";
import { confirmLeave } from "@/lib/intent/unsaved";
import type { PdfProbe } from "@/lib/pdf/probe-result";
import { whereFor } from "@/lib/pdf/remedies";
import { getToolEntry } from "@/lib/tools/directory";
import { cn } from "@/lib/utils";

/**
 * Whether `file` travels to `toolSlug` with a launch — the same verdict as
 * `handoffPayload`, which `launchWithFiles` goes by (`preflight-hint.test`
 * holds the two equal), read here without loading the hand-off store.
 */
export function hintCarries(toolSlug: string, file: File): boolean {
  return (
    handoffCapabilityFor(toolSlug).supported &&
    eligibleFilesFor(toolSlug, [file]).length > 0
  );
}

/**
 * The one preflight hint a file gets (redesign C.2, E.9), drawn in the
 * `FileHeader` it is about. It is computed from facts read while the file
 * opened, so it arrives in the same update as the editor and moves nothing
 * after it is drawn.
 *
 * Its action is a real button that opens the tool the sentence names. When
 * that tool can take the file, the file goes with it ("Open Fill Forms with
 * this file") through the one launch every surface uses; when it cannot yet
 * — OCR PDF runs on the secure worker, and a worker tool takes no hand-off
 * until its stage mode lands — the button says only "Open OCR PDF", and the
 * sentence after it says where the file goes there, the words a remedy says
 * (`whereFor`). The label follows the launch's own verdict, so the day the
 * tool can take the file, the button carries it and says so.
 */
export function PreflightHint({
  slug,
  probe,
  file,
  className,
}: {
  slug: string;
  probe: PdfProbe | null | undefined;
  file: File;
  /** Spacing where it sits outside a `FileHeader`. */
  className?: string;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const hint = hintFor(slug, probe);
  if (!hint) return null;
  const carries = hintCarries(hint.toolSlug, file);
  const href = `/tools/${hint.toolSlug}`;
  const where = carries
    ? null
    : whereFor(getToolEntry(hint.toolSlug)?.processing ?? "client");

  const open = async () => {
    const { launchWithFiles } = await import("@/lib/intent/launch");
    const result = await launchWithFiles({
      toolSlug: hint.toolSlug,
      files: [file],
      origin: { kind: "hint", fromSlug: slug, reason: hint.reason },
      suggestion: { source: "hint", rank: 1 },
      router,
      confirmLeave,
    });
    if (result === "failed") setFailed(true);
  };

  return (
    <p
      role="note"
      data-preflight-hint={hint.reason}
      className={cn("text-muted text-xs", className)}
      style={{ flexBasis: "100%" }}
    >
      {hint.text}.{" "}
      {failed ? (
        <>
          Your file could not be carried there —{" "}
          <Link
            href={href}
            className="text-accent font-semibold underline underline-offset-2"
          >
            open {hint.toolName}
          </Link>{" "}
          and add it again.
        </>
      ) : (
        <button
          type="button"
          onClick={() => void open()}
          className="text-accent font-semibold underline underline-offset-2"
        >
          Open {hint.toolName}
          {carries ? " with this file" : ""}
        </button>
      )}
      {where && !failed && <>. {where}</>}
    </p>
  );
}
