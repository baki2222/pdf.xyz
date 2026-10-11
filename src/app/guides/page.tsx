import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { guides } from "@/lib/guides";
import { getToolBySlug } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbSchema } from "@/lib/structured-data";

export const metadata: Metadata = buildMetadata({
  title: "PDF guides",
  description:
    "Step-by-step guides for everyday PDF work — merging, compressing, converting, signing, and more — each grounded in the tool that does the work.",
  path: "/guides",
  keywords: ["pdf guides", "pdf how to", "pdf tutorial", "pdf help"],
});

export default function GuidesPage() {
  return (
    <div className="bg-canvas text-fg py-14 sm:py-20">
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Guides", path: "/guides" },
        ])}
      />
      <Container className="flex flex-col gap-12">
        <SectionHeading
          as="h1"
          eyebrow="Guides"
          title="PDF guides"
          description="Practical walkthroughs for everyday PDF tasks. Every guide names the tool it uses and says plainly where the processing runs — in your browser, or on an auto-deleting worker."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {guides.map((guide) => {
            const primary = getToolBySlug(guide.tools[0] ?? "");
            return (
              <Link
                key={guide.slug}
                href={`/guides/${guide.slug}`}
                className="border-line bg-panel hover:border-line-strong group flex flex-col gap-3 rounded-[4px] border p-5 transition-colors"
              >
                {primary && (
                  <span className="text-faint font-mono text-[11px] font-medium tracking-wide uppercase">
                    {primary.name}
                  </span>
                )}
                <h2 className="text-fg text-lg font-semibold text-balance">
                  {guide.title}
                </h2>
                <p className="text-muted text-sm leading-relaxed">
                  {guide.description}
                </p>
                <span className="text-accent mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-medium">
                  Read the guide
                  <ArrowRight
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </Link>
            );
          })}
        </div>
      </Container>
    </div>
  );
}
