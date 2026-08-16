import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { getPopularTools, getToolBySlug } from "@/lib/tools";
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

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const { tool } = await searchParams;
  // Honor the deep-link only for a real catalog tool; the workspace states
  // honestly whether that tool runs in-browser or on a (not-yet-enabled) worker.
  const preselected = tool && getToolBySlug(tool) ? tool : undefined;

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
            Stage your documents here, get tool suggestions based on what you
            dropped, and line up a batch. Everything sits in this browser tab —
            nothing is uploaded, and your files clear the moment you close it.
          </p>
        </div>

        <WorkspaceClient
          tools={toolSummaries}
          popular={popularSummaries}
          preselected={preselected}
        />
      </Container>
    </div>
  );
}
