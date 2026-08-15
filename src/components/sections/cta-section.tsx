import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { toolCount } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { buttonVariants } from "@/components/ui/button";

/**
 * The colophon: the page's one full-bleed ink band, closing the paper page
 * the way a printed piece ends. Inside `.theme-ink` every token inverts, so
 * the same buttonVariants render a paper button on ink — no gradient panel,
 * no dotted grid, no glow.
 */
export function CtaSection() {
  return (
    <section className="theme-ink bg-canvas">
      <Container className="grid gap-10 py-20 sm:py-24 lg:grid-cols-12 lg:items-end">
        <div className="flex flex-col items-start gap-6 lg:col-span-8">
          <h2 className="font-display text-fg max-w-2xl text-4xl leading-[1.06] font-medium tracking-tight text-balance sm:text-5xl">
            Every PDF tool, in one private workspace
          </h2>
          <p className="text-muted max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
            Join thousands who edit, convert, and sign documents without giving
            up their privacy. {toolCount} tools, no sign-up to start.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:col-span-4 lg:justify-end lg:pb-2">
          <Link
            href="/workspace"
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            Start for free
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link
            href="/tools"
            className="text-fg decoration-line-strong hover:decoration-accent inline-flex items-center gap-1.5 text-[15px] font-medium underline decoration-1 underline-offset-[6px] transition-colors"
          >
            Browse all tools
          </Link>
        </div>
      </Container>
    </section>
  );
}
