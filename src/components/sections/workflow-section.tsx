import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { buttonVariants } from "@/components/ui/button";

/**
 * The three steps, one sentence each (design spec WP-13). What each rests on:
 *  1. a file dropped anywhere is read in the tab (WP-07's drop layer);
 *  2. the suggestion shows its reason (the ticket's evidence, WP-04/05);
 *  3. GATED by `feature-claims.test.ts`: every in-browser tool that makes a
 *     PDF offers a next tool, the property `next-steps.test.ts` proves
 *     ("every PDF made in the browser has somewhere to go"). The spec's
 *     wording said "every result", which a PDF to JPG result does not do; the
 *     sentence says what the property covers.
 */
const steps = [
  "Drop a file anywhere — the tab reads it, nothing uploads.",
  "Open the tool we suggest, with the reason we suggest it.",
  "Every PDF made in your browser offers the next tool, with the file already loaded.",
] as const;

/**
 * One chain a result's "Continue with" row offers, station by station: each
 * consecutive pair of tools is an edge of `continueTargetsFor`, which
 * `feature-claims.test.ts` reads back from the RENDERED strip. The last
 * station is the download, not a tool. `data-station` and the
 * `workflow-station` class are the hooks WP-12's scroll-driven lighting (M19)
 * attaches to; nothing here animates.
 */
const stations = [
  { stage: "Merge", slug: "merge-pdf" },
  { stage: "Compress", slug: "compress-pdf" },
  { stage: "Page numbers", slug: "page-numbers" },
  { stage: "Sign", slug: "sign-pdf" },
  { stage: "Download", slug: null },
] as const;
type Stage = (typeof stations)[number]["stage"];

/** A sheet of paper with a folded corner, in token colours. */
function Sheet({
  children,
  dim,
}: {
  children?: React.ReactNode;
  dim?: boolean;
}) {
  return (
    <g opacity={dim ? 0.55 : 1}>
      <path
        d="M16 8 H52 L68 24 V96 H16 Z"
        fill="var(--sf-panel)"
        stroke="var(--sf-line-strong)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M52 8 V24 H68 Z"
        fill="var(--sf-wash)"
        stroke="var(--sf-line-strong)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {children}
    </g>
  );
}

function Bars({
  ys,
  x = 26,
  w = 30,
}: {
  ys: number[];
  x?: number;
  w?: number;
}) {
  return (
    <>
      {ys.map((y) => (
        <rect
          key={y}
          x={x}
          y={y}
          width={w}
          height="3.5"
          rx="1"
          fill="var(--sf-line-strong)"
        />
      ))}
    </>
  );
}

/**
 * The document at each station — pages being merged, condensed, numbered,
 * signed, then saved. Decorative (the chip labels beneath carry the words), drawn
 * entirely in tokens so both schemes work.
 */
function StageGlyph({ stage }: { stage: Stage }) {
  return (
    <svg
      viewBox="0 0 84 104"
      className="h-24 w-auto"
      aria-hidden
      focusable="false"
    >
      {stage === "Merge" && (
        <>
          <g transform="translate(10 -4)">
            <Sheet dim />
          </g>
          <Sheet>
            <Bars ys={[38, 48, 58, 68]} />
          </Sheet>
        </>
      )}
      {stage === "Compress" && (
        <Sheet>
          <Bars ys={[34, 41, 48, 55, 62]} />
          <path
            d="M42 88 V74 M35 81 L42 74 L49 81"
            fill="none"
            stroke="var(--sf-faint)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Sheet>
      )}
      {stage === "Page numbers" && (
        <Sheet>
          <Bars ys={[34, 44, 54, 64]} />
          <rect
            x="35"
            y="80"
            width="14"
            height="9"
            rx="1"
            fill="none"
            stroke="var(--sf-accent)"
            strokeWidth="1.5"
          />
          <path
            d="M40 82.5 L42 81.5 V87.5"
            fill="none"
            stroke="var(--sf-accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Sheet>
      )}
      {stage === "Sign" && (
        <Sheet>
          <Bars ys={[36, 46, 56]} />
          <path
            d="M25 80 C31 68 35 88 43 77 C49 69 53 82 60 75"
            fill="none"
            stroke="var(--sf-accent)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </Sheet>
      )}
      {stage === "Download" && (
        <Sheet>
          <Bars ys={[34, 44]} />
          <path
            d="M42 56 V80 M33 71 L42 80 L51 71"
            fill="none"
            stroke="var(--sf-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M30 88 H54"
            stroke="var(--sf-line-strong)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </Sheet>
      )}
    </svg>
  );
}

/**
 * The page's full-bleed moment: a wash ground, the document itself at large
 * scale moving through one chain of tools, and the three steps as a ruled
 * row beneath. This is where a document product finally shows a document.
 */
export function WorkflowSection() {
  return (
    <section
      data-workflow
      className="border-line bg-wash border-b py-20 sm:py-24"
    >
      <Container className="flex flex-col gap-14">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <SectionHeading
            eyebrow="Workflow"
            title="One file, many tools, without picking it again."
            description="Most PDF sites make you upload the same file again for every tool. pdf.xyz stages your files once, and the in-browser tools open with them already loaded."
            className="max-w-2xl"
          />
          <Link
            href="/workspace"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            Open your workspace
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        <div className="flex flex-col gap-5">
          <p className="text-faint kicker" id="workflow-chain">
            One chain the results offer
          </p>
          <ol
            aria-labelledby="workflow-chain"
            className="flex flex-wrap items-start justify-center gap-x-3 gap-y-10 sm:grid sm:grid-cols-5"
          >
            {/* From sm, five equal columns, each station centred in its own;
                the arrow sits on the column's right edge at the drawing's
                middle, so it falls between two stations. */}
            {stations.map(({ stage, slug }, i) => (
              <li
                key={stage}
                data-station={slug ?? "download"}
                className="workflow-station flex flex-col items-center gap-3"
              >
                <div className="relative flex w-full justify-center">
                  <StageGlyph stage={stage} />
                  {i < stations.length - 1 && (
                    <ArrowRight
                      className="text-faint absolute top-1/2 right-0 size-4 -translate-y-1/2 max-sm:hidden"
                      aria-hidden
                    />
                  )}
                </div>
                <span
                  data-station-label
                  className="workflow-station-chip border-line-strong/60 bg-panel text-fg rounded-tag border px-3 py-1.5 font-mono text-[13px]"
                >
                  {stage}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <ol className="grid gap-x-10 gap-y-4 sm:grid-cols-3">
          {steps.map((step, i) => (
            <li
              key={step}
              className="border-line-strong/50 flex flex-col gap-2 border-t pt-5"
            >
              <span className="text-accent figure text-sm" aria-hidden>
                {String(i + 1).padStart(2, "0")}
              </span>
              <p className="text-fg max-w-lg text-lg leading-snug">{step}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
