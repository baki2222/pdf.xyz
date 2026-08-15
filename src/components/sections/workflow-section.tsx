import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { buttonVariants } from "@/components/ui/button";

const steps = [
  {
    title: "Add your files",
    body: "Drag in one file or a hundred. They stage in your browser — nothing uploads until a tool needs it.",
  },
  {
    title: "Chain tools",
    body: "Merge, then compress, then stamp and sign — line up steps once and run them as a single pipeline.",
  },
  {
    title: "Export & reuse",
    body: "Download instantly, or save a workflow as a preset you can rerun on the next batch in a click.",
  },
];

const chain = ["Merge", "Compress", "Watermark", "Sign", "Export"];

/**
 * Split editorial layout: the pitch and CTA in a left column, the mechanism
 * on the right — a mono pipeline strip and a ruled, numbered list instead of
 * three icon-tile cards with ghost numerals.
 */
export function WorkflowSection() {
  return (
    <section className="border-line border-b py-20 sm:py-28">
      <Container className="grid gap-12 lg:grid-cols-12">
        <div className="flex flex-col items-start gap-8 lg:col-span-5">
          <SectionHeading
            eyebrow="Workspace"
            title="Build workflows, not one-off tasks"
            description="Most PDF sites make you repeat yourself. pdf.xyz keeps your files in a single workspace so you can chain tools into repeatable pipelines."
          />
          <Link
            href="/workspace"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            Open your workspace
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        <div className="flex flex-col lg:col-span-7">
          <div className="border-line bg-panel rounded-[4px] border p-5 sm:p-6">
            <p className="text-faint font-mono text-xs font-medium tracking-[0.18em] uppercase">
              Example pipeline
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2.5">
              {chain.map((step, i) => (
                <span key={step} className="flex items-center gap-2">
                  <span className="border-line bg-wash text-fg rounded-[2px] border px-3 py-1.5 font-mono text-[13px]">
                    {step}
                  </span>
                  {i < chain.length - 1 && (
                    <ArrowRight className="text-faint size-3.5" aria-hidden />
                  )}
                </span>
              ))}
            </div>
          </div>

          <ol className="mt-8 flex flex-col">
            {steps.map(({ title, body }, i) => (
              <li
                key={title}
                className="border-line grid grid-cols-[3rem_1fr] gap-x-4 border-t py-6"
              >
                <span
                  className="text-accent pt-0.5 font-mono text-sm"
                  aria-hidden
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-fg text-lg font-medium">{title}</h3>
                  <p className="text-muted max-w-lg text-sm leading-relaxed">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}
