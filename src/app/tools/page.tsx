import type { Metadata } from "next";
import { categories, toolCount } from "@/lib/tools";
import type { ToolCategoryId } from "@/lib/tools/types";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { ToolsExplorer } from "@/components/tools/tools-explorer";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "All PDF tools",
  description: `Browse all ${toolCount} pdf.xyz tools — merge, split, compress, convert, edit, sign, secure, and AI. Filter by category and see exactly where each tool runs.`,
  path: "/tools",
});

const CATEGORY_IDS = new Set<ToolCategoryId>(categories.map((c) => c.id));

function resolveCategory(value: string | undefined): ToolCategoryId | "all" {
  if (value && CATEGORY_IDS.has(value as ToolCategoryId)) {
    return value as ToolCategoryId;
  }
  return "all";
}

export default async function ToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const { category, q } = await searchParams;
  const initialCategory = resolveCategory(category);
  const initialQuery = typeof q === "string" ? q : "";

  return (
    <div className="py-14 sm:py-20">
      <Container className="flex flex-col gap-12">
        <SectionHeading
          as="h1"
          align="left"
          eyebrow="Tool catalog"
          title="Every PDF tool, one place"
          description={`All ${toolCount} tools, organized into ${categories.length} categories. Search, filter, and each tool tells you honestly whether it runs in your browser or on a secure worker.`}
        />
        <ToolsExplorer
          initialCategory={initialCategory}
          initialQuery={initialQuery}
        />
      </Container>
    </div>
  );
}
