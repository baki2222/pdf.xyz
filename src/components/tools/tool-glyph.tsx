import { createElement } from "react";
import { getIcon, type IconName } from "@/lib/icons";

/**
 * A tool's bare glyph, for a {@link FamilyTile}. Carries `data-icon`, so the
 * guards that check a card shows its own tool's icon (`tool-card.test.tsx`)
 * read the glyph that was drawn, not the card's own idea of it.
 *
 * Imports the icon registry (~50 lucide glyphs): draw it on the server, or
 * on a surface that already ships the registry.
 */
export function ToolGlyph({ icon }: { icon: IconName }) {
  // `getIcon` returns a stable component from a static registry; see ToolIcon.
  // A variable, not a literal: lucide's props type has no `data-*` index,
  // and lucide passes every unknown prop through to the <svg>.
  const props = { strokeWidth: 1.75, "aria-hidden": true, "data-icon": icon };
  return createElement(getIcon(icon), props);
}
