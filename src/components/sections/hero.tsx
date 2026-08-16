import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { getPopularTools, toolCount } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { buttonVariants } from "@/components/ui/button";
import { UploadZone } from "@/components/upload/upload-zone";

const trust = [
  "No sign-up to start",
  "Most tools run in-browser",
  "AI built in, not bolted on",
];

/**
 * Editorial hero: headline column left, the working object — a real drop
 * zone — right. No badge pill, no gradient text, no glow; the kicker is a
 * mono catalogue line, the headline is set in the serif with the promise
 * italicised in the accent, and the trust items sit on a hairline rule.
 */
export function Hero() {
  const popular = getPopularTools(6);

  return (
    <section className="border-line border-b">
      <Container className="grid gap-14 pt-10 pb-16 sm:pt-14 lg:grid-cols-12 lg:gap-10 lg:pt-16 lg:pb-20">
        <div className="flex flex-col items-start lg:col-span-7 lg:pr-6">
          <p className="text-muted font-mono text-xs font-medium tracking-[0.14em] uppercase sm:tracking-[0.2em]">
            Privacy-first PDF platform · {toolCount} tools
          </p>

          <h1 className="font-display text-fg mt-6 text-5xl leading-[1.04] font-medium tracking-tight text-balance sm:text-6xl lg:text-[4.25rem]">
            Every PDF tool.{" "}
            <em className="text-accent italic">Private by design.</em>
          </h1>

          <p className="text-muted mt-6 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
            Merge, split, compress, convert, edit, sign, and run AI on your
            documents — in one fast, beautiful workspace. Most tools run
            entirely in your browser, so your files never leave your device.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href="/workspace"
              className={buttonVariants({ variant: "primary", size: "lg" })}
            >
              Start for free
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/tools"
              className="text-fg decoration-line-strong hover:decoration-accent inline-flex items-center gap-1.5 text-[15px] font-medium underline decoration-1 underline-offset-[6px] transition-colors"
            >
              Browse all tools
            </Link>
          </div>

          <ul className="border-line mt-12 flex w-full flex-wrap items-center gap-x-7 gap-y-2 border-t pt-5">
            {trust.map((label) => (
              <li
                key={label}
                className="text-muted inline-flex items-center gap-2 text-[13px]"
              >
                <span className="bg-accent size-1 shrink-0" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col lg:col-span-5">
          {/* The working object. It gets the page's one shadow level and a
              stack of sheets behind it — physical presence, reserved for the
              single thing on this screen a visitor can actually use. */}
          <div className="relative mt-2">
            <div
              aria-hidden
              className="border-line bg-panel absolute -top-2.5 right-4 left-4 h-16 rounded-[4px] border"
            />
            <div
              aria-hidden
              className="border-line bg-panel absolute -top-[5px] right-2 left-2 h-16 rounded-[4px] border"
            />
            <div className="border-line bg-panel relative rounded-[4px] border p-4 shadow-[0_28px_48px_-32px_rgba(28,25,23,0.4)] sm:p-5">
              <UploadZone />
            </div>
          </div>

          <div className="mt-8">
            <p className="text-faint font-mono text-xs font-medium tracking-[0.2em] uppercase">
              Popular right now
            </p>
            <ul className="border-line mt-3 grid grid-cols-2 gap-x-6 border-t">
              {popular.map((tool) => (
                <li key={tool.slug} className="border-line border-b">
                  <Link
                    href={`/tools/${tool.slug}`}
                    className="group text-fg hover:text-accent flex items-center justify-between gap-2 py-2.5 pr-1 text-sm transition-colors"
                  >
                    {tool.name}
                    <ArrowUpRight
                      className="text-faint size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  );
}
