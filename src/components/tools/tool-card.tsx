import type { Tool } from "@/lib/tools/types";
import { ToolCardView } from "@/components/tools/tool-card-view";
import { ToolGlyph } from "@/components/tools/tool-glyph";

/**
 * A tool's card, with its glyph drawn — for the surfaces rendered on the
 * server: the home grid, the category pages, a tool page's Related tools, a
 * guide's Tools used. `/tools` renders `ToolCardView` inside its client
 * explorer and hands it glyphs drawn by the page, so this module (and the
 * icon registry it pulls in) never reaches that page's bundle. The markup
 * and what a card carries are documented on {@link ToolCardView}.
 */
export function ToolCard({
  tool,
  className,
}: {
  tool: Tool;
  className?: string;
}) {
  return (
    <ToolCardView
      tool={tool}
      icon={<ToolGlyph icon={tool.icon} />}
      className={className}
    />
  );
}
