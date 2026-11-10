import { formatsLine, formatsText } from "@/lib/tools/formats-line";
import type { Tool } from "@/lib/tools/types";
import { cn } from "@/lib/utils";

/**
 * "JPG, PNG → PDF": what a tool takes and what it makes, in mono. The arrow
 * line is drawn for the eye and hidden from assistive tech, which hears the
 * same facts as a sentence ("Takes JPG, PNG; makes PDF.") instead of "right
 * arrow". Server-renderable; no state.
 */
export function FormatsLine({
  tool,
  className,
}: {
  tool: Pick<Tool, "accept" | "outputs">;
  className?: string;
}) {
  const { takes, makes } = formatsLine(tool);
  const { shown, spoken } = formatsText(takes, makes);
  return (
    <span
      className={cn(
        "text-muted font-mono text-[11px] tracking-wide whitespace-nowrap",
        className,
      )}
    >
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
