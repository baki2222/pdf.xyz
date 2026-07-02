import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { getToolBySlug } from "@/lib/tools";
import { getCategory } from "@/lib/tools/categories";
import { isToolSupported, supportedToolSlugs } from "@/lib/pdf/registry";
import { Container } from "@/components/ui/container";
import { Pill } from "@/components/ui/badge";
import { buildMetadata } from "@/lib/seo";
import { WorkspaceClient, type WorkspaceTool } from "./workspace-client";

export const metadata: Metadata = buildMetadata({
  title: "Workspace",
  description:
    "Your private pdf.xyz workspace. Stage files locally in your browser, then jump into any in-browser tool. Nothing is uploaded.",
  path: "/workspace",
  noIndex: true,
});

/** Every tool with a working in-browser runner, as a client-safe summary. */
const workspaceTools: WorkspaceTool[] = supportedToolSlugs
  .map((slug) => getToolBySlug(slug))
  .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool))
  .map((tool) => ({
    slug: tool.slug,
    name: tool.name,
    tagline: tool.tagline,
    icon: tool.icon,
    gradient: getCategory(tool.category)?.gradient,
    badge: tool.badge,
  }));

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const { tool } = await searchParams;
  // Only honor the deep-link when the tool actually has an in-browser runner —
  // no point suggesting a tool the workspace can't open.
  const preselected = tool && isToolSupported(tool) ? tool : undefined;

  return (
    <div className="py-14 sm:py-20">
      <Container className="flex flex-col gap-10">
        <div className="flex flex-col items-start gap-4">
          <Pill>
            <ShieldCheck className="size-3.5 text-emerald-400" aria-hidden />
            Local session only
          </Pill>
          <h1 className="text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Your workspace
          </h1>
          <p className="max-w-2xl text-pretty text-base leading-relaxed text-slate-400 sm:text-lg">
            Stage your documents here, then open a tool to work on them.
            Everything sits in this browser tab — nothing is uploaded, and your
            files clear the moment you close it.
          </p>
        </div>

        <WorkspaceClient tools={workspaceTools} preselected={preselected} />
      </Container>
    </div>
  );
}
