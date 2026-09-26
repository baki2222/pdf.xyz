"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { toolsForMissingPath } from "@/lib/tools/path-suggest";

/**
 * "Did you mean …?" on the 404 page, from the address that was asked for.
 * Renders nothing when the path names no tool, rather than a guess.
 */
export function MissingPathSuggestion() {
  const pathname = usePathname() ?? "";
  const suggestions = toolsForMissingPath(pathname);
  if (suggestions.length === 0) return null;
  return (
    <div className="border-line bg-wash flex flex-col items-center gap-3 rounded-[4px] border px-5 py-4">
      <p className="text-fg text-sm font-medium">Did you mean</p>
      <ul className="flex flex-wrap items-center justify-center gap-2">
        {suggestions.map((tool) => (
          <li key={tool.slug}>
            <Link
              href={`/tools/${tool.slug}`}
              className="text-accent inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4"
            >
              {tool.name}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
