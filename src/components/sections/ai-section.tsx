import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { getAiTools } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { buttonVariants } from "@/components/ui/button";

const highlights = [
  "Answers grounded in your document, with page-level citations",
  "Summaries, translations, and structured data extraction",
  "Runs on secure infrastructure under provider agreements that prohibit training on your content",
];

/**
 * The AI story, without the violet wash: pitch on the left, and the actual
 * AI tools as index rows on the right — the same catalogue voice as the rest
 * of the page, because AI here is a set of working tools, not an aura.
 */
export function AiSection() {
  const aiTools = getAiTools();

  return (
    <section className="border-line border-b py-20 sm:py-28">
      <Container className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col items-start gap-6">
          <span className="text-accent font-mono text-xs font-medium tracking-[0.18em] uppercase">
            AI, done right
          </span>
          <h2 className="font-display text-fg text-4xl leading-[1.08] font-medium tracking-tight text-balance sm:text-5xl">
            Understand documents, not just process them
          </h2>
          <p className="text-muted text-base leading-relaxed text-pretty">
            {/* This sentence named a page count until 2026-08-11; it was
                true at only one of three measured text densities. The
                concrete figure now lives where it is derived from
                AI_INPUT_LIMITS and maintained — the tool page's own limit
                answer — not in a homepage line nothing recomputes. */}
            Chat with a contract, summarize a long report, translate a
            brochure&apos;s text into another language, or pull clean structured
            data from invoices. Your content stays private: we use providers
            under agreements that prohibit training on data sent through their
            API, and we cannot control what a provider does beyond those terms.
          </p>
          <ul className="flex flex-col gap-3">
            {highlights.map((item) => (
              <li key={item} className="text-fg flex items-start gap-3 text-sm">
                <span
                  className="bg-accent mt-[7px] size-1 shrink-0"
                  aria-hidden
                />
                {item}
              </li>
            ))}
          </ul>
          <Link
            href="/tools?category=ai"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            Explore AI tools
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        <ul className="border-line flex flex-col self-start border-t">
          {aiTools.map((tool) => (
            <li key={tool.slug} className="border-line border-b">
              <Link
                href={`/tools/${tool.slug}`}
                className="group hover:bg-wash flex items-center justify-between gap-4 py-4 pr-2 pl-1 transition-colors"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-fg group-hover:text-accent text-[15px] font-medium transition-colors">
                    {tool.name}
                  </span>
                  <span className="text-muted line-clamp-1 text-sm leading-relaxed">
                    {tool.tagline}
                  </span>
                </span>
                <ArrowUpRight
                  className="text-faint size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
