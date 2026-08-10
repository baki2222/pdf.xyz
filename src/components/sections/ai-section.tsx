import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { getAiTools } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { ToolIcon } from "@/components/ui/tool-icon";
import { buttonVariants } from "@/components/ui/button";

const highlights = [
  "Answers grounded in your document, with page-level citations",
  "Summaries, translations, and structured data extraction",
  "Runs on secure infrastructure under provider agreements that prohibit training on your content",
];

export function AiSection() {
  const aiTools = getAiTools();

  return (
    <section className="py-20 sm:py-28">
      <Container>
        <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-violet-600/20 via-indigo-600/10 to-blue-600/15 p-8 sm:p-12">
          <div
            className="bg-grid pointer-events-none absolute inset-0 opacity-40"
            aria-hidden
          />
          <div className="relative grid gap-10 lg:grid-cols-2 lg:items-center">
            <div className="flex flex-col gap-6">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-xs font-semibold tracking-widest text-violet-200 uppercase">
                <Sparkles className="size-3.5" aria-hidden />
                AI, done right
              </span>
              <h2 className="text-3xl font-bold tracking-tight text-balance text-white sm:text-4xl">
                Understand documents, not just process them
              </h2>
              <p className="text-base leading-relaxed text-pretty text-slate-300">
                Chat with a contract, summarize a 200-page report, translate a
                brochure&apos;s text into another language, or pull clean
                structured data from invoices. Your content stays private: we
                use providers under agreements that prohibit training on data
                sent through their API, and we cannot control what a provider
                does beyond those terms.
              </p>
              <ul className="flex flex-col gap-3">
                {highlights.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-sm text-slate-200"
                  >
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-violet-500/20 text-violet-200">
                      <Sparkles className="size-3" aria-hidden />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              <div>
                <Link
                  href="/tools?category=ai"
                  className={buttonVariants({ variant: "primary", size: "md" })}
                >
                  Explore AI tools
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {aiTools.map((tool) => (
                <Link
                  key={tool.slug}
                  href={`/tools/${tool.slug}`}
                  className="card-hover group bg-ink/40 hover:bg-ink/60 flex flex-col gap-3 rounded-2xl border border-white/10 p-5 backdrop-blur-sm hover:border-white/25"
                >
                  <ToolIcon
                    icon={tool.icon}
                    gradient="from-violet-500 via-purple-500 to-blue-500"
                    size="md"
                  />
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold text-white">
                      {tool.name}
                    </h3>
                    <p className="line-clamp-2 text-xs leading-relaxed text-slate-400">
                      {tool.tagline}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
