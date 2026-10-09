import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { toolCount } from "@/lib/tools";
import { processingSplit } from "@/lib/tools/processing-split";
import { Container } from "@/components/ui/container";
import { buttonVariants } from "@/components/ui/button";
import { UPLOAD_ANCHOR } from "@/components/sections/hero";

/**
 * The colophon: the page's one full-bleed ink band, closing the paper page
 * the way a printed piece ends. Inside `.theme-ink` every token inverts, so
 * the same buttonVariants render a paper button on ink — no gradient panel,
 * no dotted grid, no glow.
 */
export function CtaSection() {
  /**
   * WAS `client + hybrid`, counted here — 30 — and the hedge that came with
   * it: deliberately "run in-browser" and NOT "entirely in your browser",
   * because a hybrid tool has a server fallback and "entirely" would have
   * traded one false sentence for another.
   *
   * The hedge was the right call for that number and the wrong number for
   * this sentence. `/privacy` counts the other partition — 29 that never
   * upload, 21 that may — so a reader who came from here was handed 30
   * in-browser and 21 uploading, 51 tools out of 50, with nothing on either
   * page saying `compress-pdf` is in both sets. Two true numbers, read as one
   * claim, and the arithmetic gave the reader no way to tell.
   *
   * Under a sentence that sells privacy, the number is the conservative one.
   * `neverUploads` is the group with no server path at all, so the strong
   * wording the hedge was avoiding is now simply true — and it moves with the
   * catalogue, from the same function `/privacy`, `/status` and the spec strip
   * read. See `@/lib/tools/processing-split`.
   */
  const neverUploads = processingSplit().neverUploads.length;

  return (
    <section className="theme-ink bg-canvas">
      <Container className="grid gap-10 py-20 sm:py-24 lg:grid-cols-12 lg:items-end">
        <div className="flex flex-col items-start gap-6 lg:col-span-8">
          <h2 className="font-display text-fg text-display-2 max-w-2xl font-medium text-balance">
            Every PDF tool, in one private workspace
          </h2>
          <p className="text-muted max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
            {/* "Join thousands who…" died here 2026-08-16: nothing in this
                repository counts users, so it was a claim no test could stand
                behind. These numbers the page can prove — both derived from
                the catalog, neither typed. */}
            Edit, convert, and sign documents without giving up your privacy:{" "}
            {toolCount} tools, {neverUploads} of them running entirely in your
            browser with nothing uploaded, and no sign-up to start.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:col-span-4 lg:justify-end lg:pb-2">
          {/* To the homepage drop zone, not the empty workspace; see hero.tsx. */}
          <a
            href={`#${UPLOAD_ANCHOR}`}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            Start for free
            <ArrowRight className="size-4" aria-hidden />
          </a>
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
