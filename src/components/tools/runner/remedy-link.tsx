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
 * Its own module, loaded only when an alert has a file to carry: the App
 * Router, the launch and the hand-off store are no part of a tool page's
 * first load (`runner-kit.tsx` draws the plain link until this arrives).
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
