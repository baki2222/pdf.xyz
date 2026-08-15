import { cn } from "@/lib/utils";

/**
 * Editorial section opener: a mono kicker, a serif display title, and muted
 * supporting copy. Left alignment is the default voice of the redesign;
 * `align="center"` remains for the routes that still use it.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  as: Heading = "h2",
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "left";
  /** Heading level. Defaults to h2; use h1 when this is the page's main title. */
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        align === "center" ? "items-center text-center" : "items-start",
        className,
      )}
    >
      {eyebrow && (
        <span className="text-accent inline-flex items-center gap-3 font-mono text-xs font-medium tracking-[0.18em] uppercase">
          {eyebrow}
        </span>
      )}
      <Heading className="font-display text-fg max-w-3xl text-4xl leading-[1.08] font-medium tracking-tight text-balance sm:text-5xl">
        {title}
      </Heading>
      {description && (
        <p
          className={cn(
            "text-muted max-w-2xl text-base leading-relaxed text-pretty sm:text-lg",
            align === "center" && "mx-auto",
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}
