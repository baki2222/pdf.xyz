import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { guides } from "@/lib/guides";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

/** How many guides a phone shows; the rest stay in the HTML, hidden. */
const PHONE_GUIDES = 6;

/**
 * The how-to guides, linked from the home page — every one of them, because
 * the home page's links are the guides' strongest inbound links
 * (`internal-links.test.ts`: "every guide is linked from the homepage").
 * Rendered from the `guides` catalogue, so a new guide is linked by existing.
 *
 * Set compact (2026-10-21): titles only, in columns. On a phone the first
 * {@link PHONE_GUIDES} show and "All guides" leads to the rest; the others
 * stay in the HTML, hidden below `sm`.
 */
export function GuidesSection() {
  return (
    <section id="guides" className="scroll-mt-24 py-10 sm:py-14">
      <Container>
        <div className="flex items-end justify-between gap-6">
          <h2 className="font-display text-fg text-display-2 font-medium text-balance">
            Step-by-step guides
          </h2>
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
        <ul className="mt-6 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          {guides.map((guide, i) => (
            <li
              key={guide.slug}
              className={cn(i >= PHONE_GUIDES && "max-sm:hidden")}
            >
              <Link
                href={`/guides/${guide.slug}`}
                className="text-fg hover:text-accent block py-1.5 text-sm underline-offset-4 transition-colors hover:underline"
              >
                {guide.title}
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
