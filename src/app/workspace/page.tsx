import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { getPopularTools } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { Pill } from "@/components/ui/badge";
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
    <div className="bg-canvas text-fg py-14 sm:py-20">
      <Container className="flex flex-col gap-10">
        <div className="flex flex-col items-start gap-4">
          <Pill>
            <ShieldCheck className="text-ok size-3.5" aria-hidden />
            Local session only
          </Pill>
          <h1 className="font-display text-fg text-4xl font-medium tracking-tight text-balance sm:text-5xl">
            Your workspace
          </h1>
          <p className="text-muted max-w-2xl text-base leading-relaxed text-pretty sm:text-lg">
            Stage your documents here, see the tools that fit — each with the
            fact this tab read from your files — and line up a batch. Nothing is
            uploaded: the files stay in this browser, and the in-browser tools
            open with them already loaded.
          </p>
        </div>

        <WorkspaceClient tools={toolSummaries} popular={popularSummaries} />
      </Container>
    </div>
  );
}
