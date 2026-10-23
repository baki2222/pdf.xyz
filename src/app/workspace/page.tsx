import type { Metadata } from "next";
import { getPopularTools } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { buildMetadata } from "@/lib/seo";
import { buildToolSummaries } from "./presenter";
import { WorkspaceClient } from "./workspace-client";

export const metadata: Metadata = buildMetadata({
  title: "Workspace",
  description:
    "Your private pdf.xyz workspace. Stage files locally in your browser, get file-aware tool suggestions, and line up batches. Nothing is uploaded.",
  path: "/workspace",
  // Without this the file-convention card is ignored: buildMetadata always sets
  // an explicit openGraph.images, and explicit beats convention.
  imagePath: "/workspace/opengraph-image",
  noIndex: true,
});

/** Client-safe summary for every catalog tool, built once on the server. */
const toolSummaries = buildToolSummaries();
const popularSlugs = new Set(getPopularTools(6).map((tool) => tool.slug));
const popularSummaries = toolSummaries.filter((tool) =>
  popularSlugs.has(tool.slug),
);

/**
 * Prerendered: the `?tool=` deep link is resolved in the browser by
 * `WorkspaceClient` (see `deep-link.ts`), so nothing here reads the request.
 */
export default function WorkspacePage() {
  return (
    <div className="bg-canvas text-fg py-8 sm:py-16">
      <Container className="flex flex-col gap-8">
        {/* Plain words, no mono chip (owner, 2026-10-23). WAS a "Local
            session only" mono pill above a sentence about "staging" and the
            "fact this tab read". */}
        <div className="flex flex-col items-start gap-3">
          <h1 className="font-display text-fg text-4xl font-medium tracking-tight text-balance sm:text-5xl">
            Your workspace
          </h1>
          <p className="text-muted max-w-2xl text-base leading-relaxed text-pretty sm:text-lg">
            Add your files and we&apos;ll suggest the tools that fit them, or
            open several files in one tool at once. Nothing is uploaded here:
            your files stay in this browser.
          </p>
        </div>

        <WorkspaceClient tools={toolSummaries} popular={popularSummaries} />
      </Container>
    </div>
  );
}
