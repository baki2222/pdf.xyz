import { cn } from "@/lib/utils";

/** One section of a guide the contents link to. */
export interface GuideContentsEntry {
  /** The section's element id, linked as `#id`. */
  readonly id: string;
  readonly label: string;
}

/**
 * A guide's contents (design spec D.9), a server component in two forms:
 * `details`, collapsed in the article's flow below `lg`, and `rail`, a
 * sticky list in the left column from `lg`. The spec says `xl`; the page
 * switches at `lg` because no `xl:` utility shipped anywhere and the
 * stylesheet had no room left for new ones (`shipped-css.test.ts`, 15.0 KB),
 * while every `lg:` class this needs already did. It also matches the open
 * bar, which is `lg:hidden`: below lg the details and the bar, from lg the
 * rail. The page builds `entries` from the
 * same values it renders its sections from, and `guide-layout.test.tsx`
 * holds the rendered links equal to the article's own `section[id]`s, so a
 * section is listed by existing and a removed one cannot leave a dead link.
 *
 * Two copies rather than one element styled twice: a closed `<details>`
 * hides its content whatever the CSS says, so it cannot also be the open
 * rail. Only one is ever displayed, so only one is in the accessibility tree.
 */
export function GuideContents({
  entries,
  variant,
  className,
}: {
  entries: readonly GuideContentsEntry[];
  variant: "details" | "rail";
  className?: string;
}) {
  const list = (
    <ol className="flex flex-col gap-1">
      {entries.map(({ id, label }) => (
        <li key={id}>
          <a
            href={`#${id}`}
            className="text-muted hover:text-fg block py-1 text-sm leading-5 transition-colors"
          >
            {label}
          </a>
        </li>
      ))}
    </ol>
  );

  if (variant === "details") {
    return (
      <details
        data-guide-contents
        className={cn(
          "border-line bg-panel rounded-panel border px-4 py-1 lg:hidden",
          className,
        )}
      >
        <summary className="text-fg cursor-pointer py-2 text-sm font-medium">
          Contents
        </summary>
        <div className="pb-3">{list}</div>
      </details>
    );
  }

  return (
    <nav
      data-guide-contents
      aria-labelledby="guide-contents-rail"
      className={cn(
        "max-lg:hidden lg:sticky lg:top-24 lg:col-span-3",
        className,
      )}
    >
      <p id="guide-contents-rail" className="text-faint kicker mb-3">
        Contents
      </p>
      {list}
    </nav>
  );
}
