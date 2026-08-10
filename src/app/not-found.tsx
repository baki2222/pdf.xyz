import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { getPopularTools, toolCount } from "@/lib/tools";
import { getCategory } from "@/lib/tools/categories";
import { Container } from "@/components/ui/container";
import { ToolIcon } from "@/components/ui/tool-icon";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  const suggestions = getPopularTools(6);

  return (
    <div className="grid min-h-[70vh] place-items-center py-20">
      <Container className="flex flex-col items-center gap-8 text-center">
        <span className="bg-gradient-to-br from-white to-slate-500 bg-clip-text text-7xl font-bold tracking-tight text-transparent sm:text-8xl">
          404
        </span>
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            This page took a wrong turn
          </h1>
          <p className="max-w-md text-base leading-relaxed text-pretty text-slate-400">
            We couldn&apos;t find what you were looking for. Try one of our{" "}
            {toolCount} tools, or head back home.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            Back to home
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link
            href="/tools"
            className={buttonVariants({ variant: "secondary", size: "md" })}
          >
            <Search className="size-4" aria-hidden />
            Browse all tools
          </Link>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 pt-4">
          {suggestions.map((tool) => (
            <Link
              key={tool.slug}
              href={`/tools/${tool.slug}`}
              className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1.5 pr-4 pl-1.5 text-sm font-medium text-slate-200 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
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
      </Container>
    </div>
  );
}
