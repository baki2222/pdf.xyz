import type { Metadata } from "next";
import { categories, toolCount } from "@/lib/tools";
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
      </Container>
    </div>
  );
}
