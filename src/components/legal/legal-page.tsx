import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";

/**
 * Shared shell for the policy pages.
 *
 * Long-form legal text is the one place on this site where readability beats
 * visual density: a constrained measure, real heading hierarchy, and a visible
 * "last updated" date, because a policy whose age you cannot tell is a policy
 * you cannot rely on.
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
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {title}
            </h1>
            <p className="text-sm text-slate-400">
              Last updated{" "}
              <time dateTime={updated}>
                {new Date(`${updated}T00:00:00Z`).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </time>
            </p>
            <div className="rounded-2xl border border-violet-400/25 bg-violet-500/[0.07] p-5 text-sm leading-relaxed text-slate-200">
              {summary}
            </div>
          </header>
          <div className="legal-prose flex flex-col gap-6 text-sm leading-relaxed text-slate-300">
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
      <h2 className="text-lg font-semibold text-white">{heading}</h2>
      {children}
    </section>
  );
}
