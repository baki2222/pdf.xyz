import Link from "next/link";
import { Gift, ShieldCheck, UserX } from "lucide-react";
import { toolCount } from "@/lib/tools";
import { processingSplit } from "@/lib/tools/processing-split";

/**
 * Why pdf.xyz, in three points: private, free, no sign-up.
 *
 * Merges what were four sections until 2026-10-21 — the stats band, the
 * six-fact privacy grid, the two-column pricing panel and About — into the
 * three answers a first-time visitor is looking for. The detail they held
 * lives on /privacy (linked here) and in the FAQ below.
 *
 * The anchors the header and footer link to stay where their words now
 * live: `#about` on this section, `#privacy` and `#security` on the privacy
 * point, `#pricing` on the free one (`src/lib/site.ts`).
 *
 * A column, not a section: the page sets it beside "How it works" in one
 * band (`HowAndWhy`).
 *
 * The count is the conservative partition — tools with no upload path at
 * all — from the same `processingSplit()` /privacy and /status read.
 */
export function WhySection() {
  const neverUploads = processingSplit().neverUploads.length;
  const points = [
    {
      id: "privacy",
      icon: ShieldCheck,
      title: "Private",
      body: `${neverUploads} of the ${toolCount} tools work entirely in your browser and never upload your file. The rest say so on their card before you start.`,
      more: { href: "/privacy", label: "How files are handled" },
    },
    {
      id: "pricing",
      icon: Gift,
      title: "Free",
      body: `Every one of the ${toolCount} tools is free to use today — no card and no trial clock.`,
    },
    {
      id: "sign-up",
      icon: UserX,
      title: "No sign-up",
      body: "There is no account to create. Open a tool and start.",
    },
  ];
  return (
    <div id="about" className="scroll-mt-24">
      <h2 className="font-display text-fg text-display-2 font-medium text-balance">
        Why pdf.xyz
      </h2>
      <ul className="mt-6 flex flex-col gap-5">
        {points.map(({ id, icon: Icon, title, body, more }) => (
          <li key={id} id={id} className="flex scroll-mt-24 gap-4">
            {id === "privacy" && <span id="security" className="sr-only" />}
            <Icon
              className="text-accent mt-0.5 size-6 shrink-0"
              strokeWidth={1.5}
              aria-hidden
            />
            <div className="flex flex-col gap-1">
              <h3 className="text-fg text-base font-medium">{title}</h3>
              <p className="text-muted text-sm leading-relaxed">{body}</p>
              {more && (
                <Link
                  href={more.href}
                  className="text-accent text-sm font-medium underline-offset-4 hover:underline"
                >
                  {more.label}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
