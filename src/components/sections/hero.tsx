import Link from "next/link";
import { ArrowRight, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { getPopularTools, toolCount } from "@/lib/tools";
import { getCategory } from "@/lib/tools/categories";
import { Container } from "@/components/ui/container";
import { Pill } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ToolIcon } from "@/components/ui/tool-icon";
import { UploadZone } from "@/components/upload/upload-zone";
import { cn } from "@/lib/utils";

const trust = [
  { icon: ShieldCheck, label: "No sign-up to start" },
  { icon: Zap, label: "Most tools run in-browser" },
  { icon: Sparkles, label: "AI built in, not bolted on" },
];

export function Hero() {
  const popular = getPopularTools(6);

  return (
    <section className="relative overflow-hidden pt-14 sm:pt-20">
      <Container className="flex flex-col items-center gap-7 text-center">
        <Pill className="animate-float-up">
          <Sparkles className="size-3.5 text-violet-300" aria-hidden />
          Privacy-first PDF platform · {toolCount} tools
        </Pill>

        <h1 className="max-w-4xl text-4xl leading-[1.05] font-bold tracking-tight text-balance text-white sm:text-6xl md:text-7xl">
          Every PDF tool.{" "}
          <span className="gradient-text">Private by design.</span>
        </h1>

        <p className="max-w-2xl text-base leading-relaxed text-pretty text-slate-400 sm:text-lg">
          Merge, split, compress, convert, edit, sign, and run AI on your
          documents — in one fast, beautiful workspace. Most tools run entirely
          in your browser, so your files never leave your device.
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

        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {trust.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="inline-flex items-center gap-2 text-sm text-slate-400"
            >
              <Icon className="size-4 text-emerald-400" aria-hidden />
              {label}
            </li>
          ))}
        </ul>
      </Container>

      <Container className="mt-12 max-w-3xl">
        <div className="gradient-border">
          <div className="glass rounded-3xl p-5 sm:p-7">
            <UploadZone />
          </div>
        </div>

        <div className="mt-7 flex flex-col items-center gap-3">
          <p className="text-xs font-semibold tracking-widest text-slate-400 uppercase">
            Popular right now
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {popular.map((tool) => (
              <Link
                key={tool.slug}
                href={`/tools/${tool.slug}`}
                className={cn(
                  "group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1.5 pr-4 pl-1.5 text-sm font-medium text-slate-200 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white",
                )}
              >
                <ToolIcon
                  icon={tool.icon}
                  gradient={getCategory(tool.category)?.gradient}
                  size="sm"
                />
                {tool.name}
              </Link>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
