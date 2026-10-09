import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { getPopularTools, toolCount } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { buttonVariants } from "@/components/ui/button";
import { UploadZone } from "@/components/upload/upload-zone";

/** The homepage drop zone's id: the target of every "Start for free". */
export const UPLOAD_ANCHOR = "upload";

const trust = [
  "No sign-up to start",
  "Most tools run in-browser",
  "AI built in, not bolted on",
];

/**
 * Prepress hero: headline column left, the working object — a real drop
 * zone — right. No badge pill, no gradient text, no glow. The kicker is a
 * mono spec line, the headline is the grotesque with the promise carried on
 * a process-cyan sweep (the mark at 22% — text stays fg, so the line can
 * never fail contrast), and the sheet on the right wears the crop marks:
 * the one place the trim-room device appears on this screen, because it is
 * the one place a real page will actually be.
 */
export function Hero() {
  const popular = getPopularTools(6);

  return (
    <section className="border-line border-b">
      <Container className="grid gap-14 pt-10 pb-16 sm:pt-14 lg:grid-cols-12 lg:gap-10 lg:pt-16 lg:pb-20">
        <div className="flex flex-col items-start lg:col-span-7 lg:pr-6">
          <p className="text-muted kicker">
            Privacy-first PDF platform · {toolCount} tools
          </p>

          <h1 className="font-display text-fg text-display-1 mt-6 font-bold text-balance">
            Every PDF tool.{" "}
            <span className="mark-sweep">Private by design.</span>
          </h1>

          <p className="text-muted mt-6 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
            Merge, split, compress, convert, edit, sign, and run AI on your
            documents — in one fast, beautiful workspace. Most tools run
            entirely in your browser, so your files never leave your device.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            {/* Was a link to /workspace: a staging page that processes
                nothing, reached empty. The drop zone beside this is where
                starting actually happens. A plain anchor, so the browser
                fires the `hashchange` the zone listens for to focus its
                input (a client-side Link navigation does not). */}
            <a
              href={`#${UPLOAD_ANCHOR}`}
              className={buttonVariants({ variant: "primary", size: "lg" })}
            >
              Start for free
              <ArrowRight className="size-4" aria-hidden />
            </a>
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
                <span className="bg-mark size-1.5 shrink-0" aria-hidden />
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
              className="border-line bg-panel absolute -top-2.5 right-4 left-4 h-16 border"
            />
            <div
              aria-hidden
              className="border-line bg-panel absolute -top-[5px] right-2 left-2 h-16 border"
            />
            <div className="border-line bg-panel crop-marks shadow-sheet relative border p-4 sm:p-5">
              <UploadZone id={UPLOAD_ANCHOR} />
            </div>
          </div>

          <div className="mt-8">
            <p className="text-faint kicker">Popular right now</p>
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
