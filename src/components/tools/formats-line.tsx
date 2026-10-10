import { formatsLine } from "@/lib/tools/formats-line";
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
  return (
    <span
      className={cn(
        "text-muted font-mono text-[11px] tracking-wide whitespace-nowrap",
        className,
      )}
    >
      <span aria-hidden>{`${takes.join(", ")} → ${makes.join(", ")}`}</span>
      <span className="sr-only">{`Takes ${takes.join(", ")}; makes ${makes.join(", ")}.`}</span>
    </span>
  );
}
