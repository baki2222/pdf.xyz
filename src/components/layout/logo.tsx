import Link from "next/link";
import { siteConfig } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * The pdf.xyz wordmark: a registration-mark square in the accent, and the
 * name typeset in mono — an instrument's nameplate, not an app-store tile.
 * The old mark was a violet gradient rounded square with a document glyph,
 * which is to say: everyone's mark.
 */
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
      <span
        className="bg-accent size-2.5 transition-transform duration-200 group-hover:rotate-45"
        aria-hidden
      />
      <span className="text-fg font-mono text-[17px] font-semibold tracking-tight">
        pdf<span className="text-muted">.xyz</span>
      </span>
    </Link>
  );
}
