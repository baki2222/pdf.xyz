import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { toolCount } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { buttonVariants } from "@/components/ui/button";

export function CtaSection() {
  return (
    <section className="pb-8">
      <Container>
        <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-violet-600/25 via-indigo-600/15 to-blue-600/20 px-6 py-14 text-center sm:px-12 sm:py-20">
          <div
            className="bg-grid pointer-events-none absolute inset-0 opacity-30"
            aria-hidden
          />
          <div className="relative flex flex-col items-center gap-6">
            <h2 className="max-w-2xl text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
              Every PDF tool, in one private workspace
            </h2>
            <p className="max-w-xl text-pretty text-base leading-relaxed text-slate-300 sm:text-lg">
              Join thousands who edit, convert, and sign documents without giving
              up their privacy. {toolCount} tools, no sign-up to start.
            </p>
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <Link
                href="/workspace"
                className={buttonVariants({ variant: "primary", size: "lg" })}
              >
                Start for free
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                href="/tools"
                className={buttonVariants({ variant: "secondary", size: "lg" })}
              >
                Browse all tools
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
