import { cn } from "@/lib/utils";

/**
 * Editorial section opener: a mono kicker, a title in the display grotesque,
 * and muted supporting copy. Left alignment is the default voice of the
 * redesign; `align="center"` remains for the routes that still use it.
 *
 * Two sizes, because this is two roles. As an h2 it opens a section and is
 * the display-2 step every section heading shares. As an h1 it is the page
 * title of three templates — /tools, /guides and every category page — and
 * keeps the size page titles use across the site; display-2 would set those
 * titles SMALLER on a phone than the step they had, for no reason a reader
 * could see. `type-roles.test.tsx` holds both.
 */
const TITLE_SIZE = {
  h1: "text-4xl leading-[1.08] tracking-tight sm:text-5xl",
  h2: "text-display-2",
} as const;

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  as: Heading = "h2",
  className,
  descriptionClassName,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "left";
  /** Heading level. Defaults to h2; use h1 when this is the page's main title. */
  as?: "h1" | "h2";
  className?: string;
  /** Classes for the description alone (e.g. hiding it at a breakpoint). */
  descriptionClassName?: string;
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
        <span className="text-accent kicker inline-flex items-center gap-3">
          {eyebrow}
        </span>
      )}
      <Heading
        className={cn(
          "font-display text-fg max-w-3xl font-medium text-balance",
          TITLE_SIZE[Heading],
        )}
      >
        {title}
      </Heading>
      {description && (
        <p
          className={cn(
            "text-muted max-w-2xl text-base leading-relaxed text-pretty sm:text-lg",
            align === "center" && "mx-auto",
            descriptionClassName,
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}
