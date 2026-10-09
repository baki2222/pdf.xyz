import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { categories, toolCount } from "@/lib/tools";
import { guides } from "@/lib/guides";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { ToolsExplorer } from "@/components/tools/tools-explorer";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "All PDF tools",
  description: `Browse all ${toolCount} pdf.xyz tools — merge, split, compress, convert, edit, sign, secure, and AI. Filter by category and see exactly where each tool runs.`,
  path: "/tools",
  // Without this the file-convention card is ignored: buildMetadata always sets
  // an explicit openGraph.images, and explicit beats convention.
  imagePath: "/tools/opengraph-image",
});

/**
 * Prerendered. This page used to await `searchParams` to seed the explorer's
 * filter, which made it dynamic: `Cache-Control: private, no-store` and a
 * server render per request for the hub that links every tool. The explorer
 * now applies `?category=` and `?q=` itself after hydration, so the static
 * HTML is the complete, unfiltered catalogue and every old filter URL still
 * works. `pages-static.test.ts` fails if a request-time API returns.
 */
export default function ToolsPage() {
  return (
    <div className="bg-canvas text-fg py-14 sm:py-20">
      <Container className="flex flex-col gap-12">
        <SectionHeading
          as="h1"
          align="left"
          eyebrow="Tool catalog"
          title="Every PDF tool, one place"
          description={`All ${toolCount} tools, organized into ${categories.length} categories. Search, filter, and each tool tells you honestly whether it runs in your browser or on a secure worker.`}
        />
        <ToolsExplorer />
        {/* The hub that links every tool also links the guides written for the
            same jobs. The footer's "Guides" item was the only way from here to
            them; `internal-links.test.ts` requires this link in the page's own
            content, where it is read as part of the page, not as site chrome. */}
        <aside
          aria-labelledby="tools-guides"
          className="border-line flex flex-col gap-3 border-t pt-8 sm:flex-row sm:items-end sm:justify-between sm:gap-8"
        >
          <div className="flex max-w-2xl flex-col gap-1.5">
            <h2 id="tools-guides" className="text-fg text-lg font-semibold">
              Not sure which tool you need?
            </h2>
            <p className="text-muted text-sm leading-relaxed">
              {guides.length} step-by-step guides walk through everyday PDF
              jobs. Each names the tool it uses and where that tool runs.
            </p>
          </div>
          <Link
            href="/guides"
            className="group text-accent inline-flex shrink-0 items-center gap-1.5 text-sm font-medium hover:underline"
          >
            Read the guides
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </aside>
      </Container>
    </div>
  );
}
