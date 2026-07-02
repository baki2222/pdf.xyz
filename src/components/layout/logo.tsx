import Link from "next/link";
import { siteConfig } from "@/lib/site";
import { cn } from "@/lib/utils";

/** The pdf.xyz wordmark: a gradient document glyph + typeset name. */
export function Logo({
  href = "/",
  className,
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={`${siteConfig.name} — home`}
      className={cn("group inline-flex items-center gap-2.5", className)}
    >
      <span className="relative grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-500 text-white shadow-lg shadow-violet-500/30 transition-transform duration-200 group-hover:scale-105">
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 2.75h7L18.25 8v11.5a1.75 1.75 0 0 1-1.75 1.75h-9.5A1.75 1.75 0 0 1 5.25 19.5V4.5A1.75 1.75 0 0 1 6 2.75Z" />
          <path d="M13 3v5h5" />
          <path d="M8.5 13.5h5M8.5 16.5h3" />
        </svg>
      </span>
      <span className="text-lg font-semibold tracking-tight text-white">
        pdf<span className="gradient-text">.xyz</span>
      </span>
    </Link>
  );
}
