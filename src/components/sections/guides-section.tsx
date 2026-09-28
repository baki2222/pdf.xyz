import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { guides } from "@/lib/guides";
import { getToolBySlug } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

/**
 * The how-to guides, linked from the homepage.
 *
 * The guides are the pages written for long-tail "how do I…" searches, and
 * they sat at the weakest point of the internal-link graph: the homepage
 * linked only the `/guides` index, and each guide had four inbound links in
 * all (measured from production HTML). Rendered from the `guides` catalogue —
 * a new guide is linked here by existing, and this cannot link one that does
 * not.
 */
export function GuidesSection() {
  return (
    <section id="guides" className="border-line border-b py-20 sm:py-24">
      <Container className="flex flex-col gap-10">
        <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-end">
          <SectionHeading
            eyebrow="Guides"
            title="How to do it, step by step"
            description="Walkthroughs for everyday PDF tasks. Each one names the tool it uses and where that tool runs."
          />
          <Link
            href="/guides"
            className="group text-accent inline-flex shrink-0 items-center gap-1.5 text-sm font-medium hover:underline"
          >
            All guides
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </div>

        <ul className="border-line grid grid-cols-1 gap-x-10 border-t md:grid-cols-2">
          {guides.map((guide) => {
            const primary = getToolBySlug(guide.tools[0] ?? "");
            return (
              <li key={guide.slug} className="border-line border-b">
                <Link
                  href={`/guides/${guide.slug}`}
                  className="group hover:bg-wash flex items-center justify-between gap-4 py-4 pr-2 pl-1 transition-colors"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-fg group-hover:text-accent text-[15px] font-medium transition-colors">
                      {guide.title}
                    </span>
                    {primary && (
                      <span className="text-faint font-mono text-[11px] tracking-wide uppercase">
                        {primary.name}
                      </span>
                    )}
                  </span>
                  <ArrowUpRight
                    className="text-faint size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
