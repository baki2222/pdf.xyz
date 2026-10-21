"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isPlainClick } from "@/lib/intent/links";
import { confirmLeave } from "@/lib/intent/unsaved";
import type { Remedy } from "@/lib/pdf/remedies";
import { useToolRun } from "./tool-context";

/**
 * A remedy's link that takes the file with it (WP-10): the tool that fixes
 * the file STAGES it — nothing uploads until Run there — with a `remedy`
 * origin, and the job's way back (`pending`: the tool that sent it), so the
 * fix's result continues to this tool first. A modified click (new tab) is
 * the plain link it always was; a stash the browser refuses navigates
 * plainly, and the page there asks for the file.
 *
 * Its own component because it needs the App Router (the plain link does
 * not, and an alert drawn outside a page never reaches here), and its own
 * module so the launch — the hand-off store with it — loads on the click,
 * not with every tool page. WAS a lazy component too (49f4a56f): a click
 * before it arrived took the plain link and left the file behind.
 */
export function CarryingRemedyLink({
  remedy,
  file,
}: {
  remedy: Remedy;
  file: File;
}) {
  const router = useRouter();
  const run = useToolRun();
  const [going, setGoing] = useState(false);
  return (
    <Link
      href={remedy.href}
      aria-busy={going || undefined}
      onClick={async (event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        if (going) return;
        setGoing(true);
        try {
          const { launchWithFiles } = await import("@/lib/intent/launch");
          const result = await launchWithFiles({
            toolSlug: remedy.toolSlug,
            files: [file],
            origin: {
              kind: "remedy",
              fromSlug: run?.slug ?? "",
              problem: remedy.problem,
            },
            trail: run?.trail ?? [],
            ...(run ? { pending: { toolSlug: run.slug, parkedId: null } } : {}),
            suggestion: { source: "remedy", rank: 1 },
            router,
            confirmLeave,
          });
          if (result === "failed") router.push(remedy.href);
        } finally {
          setGoing(false);
        }
      }}
      className="font-semibold underline underline-offset-2"
    >
      {remedy.label}
    </Link>
  );
}
