import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";
import { proseMeasure } from "@/components/ui/prose";
import { cn } from "@/lib/utils";

/**
 * Shared shell for the policy pages.
 *
 * Long-form legal text is the one place on this site where readability beats
 * visual density: a constrained measure, real heading hierarchy, and a visible
 * "last updated" date, because a policy whose age you cannot tell is a policy
 * you cannot rely on.
 *
 * "Constrained measure" was not true when that was first written: the body sat
 * at 14px across the full max-w-3xl column. It is now {@link proseMeasure}.
 * `src/app/guides/guide-page.test.tsx` renders both policy pages and fails
 * if the body copy loses it, and `e2e/reading-measure.spec.ts` counts the
 * characters its lines hold.
 */
export function LegalPage({
  title,
  updated,
  summary,
  children,
}: {
  title: string;
  /** ISO date. Rendered readably and machine-readably. */
  updated: string;
  /** One paragraph a person can act on without reading the rest. */
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="py-16 sm:py-24">
      <Container>
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          <header className="flex flex-col gap-4">
            <h1 className="font-display text-fg text-3xl font-medium tracking-tight sm:text-4xl">
              {title}
            </h1>
            <p className="text-muted text-sm">
              Last updated{" "}
              <time dateTime={updated} className="font-mono text-[13px]">
                {new Date(`${updated}T00:00:00Z`).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </time>
            </p>
            {/* The reader's one-paragraph summary carries the accent — the
                rubricated passage of the document. */}
            <div className="border-accent/30 bg-accent/5 text-fg rounded-panel border p-5 text-sm leading-relaxed">
              {summary}
            </div>
          </header>
          <div
            className={cn(
              "legal-prose text-muted flex flex-col gap-6",
              proseMeasure,
            )}
          >
            {children}
          </div>
        </div>
      </Container>
    </div>
  );
}

/** One numbered section. Kept here so both documents share exact structure. */
export function LegalSection({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-24 flex-col gap-3">
      <h2 className="text-fg text-lg font-semibold">{heading}</h2>
      {children}
    </section>
  );
}
