import Link from "next/link";
import { ArrowRight, FileUp, Layers, Workflow, Download } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { buttonVariants } from "@/components/ui/button";

const steps = [
  {
    icon: FileUp,
    title: "Add your files",
    body: "Drag in one file or a hundred. They stage in your browser — nothing uploads until a tool needs it.",
  },
  {
    icon: Layers,
    title: "Chain tools",
    body: "Merge, then compress, then stamp and sign — line up steps once and run them as a single pipeline.",
  },
  {
    icon: Download,
    title: "Export & reuse",
    body: "Download instantly, or save a workflow as a preset you can rerun on the next batch in a click.",
  },
];

const chain = ["Merge", "Compress", "Watermark", "Sign", "Export"];

export function WorkflowSection() {
  return (
    <section className="py-20 sm:py-28">
      <Container className="flex flex-col gap-14">
        <SectionHeading
          eyebrow="Workspace"
          title="Build workflows, not one-off tasks"
          description="Most PDF sites make you repeat yourself. pdf.xyz keeps your files in a single workspace so you can chain tools into repeatable pipelines."
        />

        <div className="bg-surface-2 overflow-hidden rounded-3xl border border-white/10 p-6 sm:p-8">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <Workflow className="size-4 text-violet-300" aria-hidden />
            Example pipeline
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {chain.map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <span className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white">
                  {step}
                </span>
                {i < chain.length - 1 && (
                  <ArrowRight className="size-4 text-slate-400" aria-hidden />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, body }, i) => (
            <div
              key={title}
              className="bg-surface-2 relative flex flex-col gap-4 rounded-2xl border border-white/10 p-6"
            >
              <div className="flex items-center justify-between">
                <span className="grid size-11 place-items-center rounded-xl border border-white/10 bg-gradient-to-br from-violet-500 to-blue-500 text-white">
                  <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="text-4xl font-bold text-white/10">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-white">{title}</h3>
              <p className="text-sm leading-relaxed text-slate-400">{body}</p>
            </div>
          ))}
        </div>

        <div className="flex justify-center">
          <Link
            href="/workspace"
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            Open your workspace
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </Container>
    </section>
  );
}
