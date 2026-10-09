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
    title: "Pick a tool",
    body: "Choose a suggested tool. In-browser tools open with your staged files already loaded, so there is nothing to upload again.",
  },
  {
    title: "Download",
    body: "Download the result when the tool finishes. Each tool runs on its own; pick the next one when you need it.",
  },
];

/**
 * Tools that open with the workspace's staged files. Not a sequence: the
 * workspace hands files to ONE tool at a time, and this strip used to be an
 * arrowed "Example pipeline" selling a chaining feature that does not exist.
 * Every entry here is a tool with an in-browser handoff (see
 * `feature-claims.test.ts`).
 */
const stages = ["Merge", "Compress", "Watermark", "Sign"] as const;
type Stage = (typeof stages)[number];

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
 * The document in each tool — pages being merged, condensed, watermarked,
 * signed. Decorative (the chip labels beneath carry the words), drawn
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
      {stage === "Watermark" && (
        <Sheet>
          <Bars ys={[36, 46, 68, 78]} />
          <rect
            x="12"
            y="51"
            width="60"
            height="10"
            rx="2"
            fill="var(--sf-accent)"
            opacity="0.3"
            transform="rotate(-14 42 56)"
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
    </svg>
  );
}

/**
 * The page's full-bleed moment: a wash ground, the document itself in the
 * tools that open staged files, at large scale, and the three steps as a
 * ruled row beneath. This is where a document product finally shows a
 * document.
 */
export function WorkflowSection() {
  return (
    <section className="border-line bg-wash border-b py-20 sm:py-24">
      <Container className="flex flex-col gap-14">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <SectionHeading
            eyebrow="Workspace"
            title="One workspace for your files"
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
          <p className="text-faint kicker">Tools that open your staged files</p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-10 sm:justify-between">
            {stages.map((stage) => (
              <div key={stage} className="flex flex-col items-center gap-3">
                <StageGlyph stage={stage} />
                <span className="border-line-strong/60 bg-panel text-fg rounded-[2px] border px-3 py-1.5 font-mono text-[13px]">
                  {stage}
                </span>
              </div>
            ))}
          </div>
        </div>

        <ol className="grid gap-x-10 gap-y-4 sm:grid-cols-3">
          {steps.map(({ title, body }, i) => (
            <li
              key={title}
              className="border-line-strong/50 flex flex-col gap-2 border-t pt-5"
            >
              <span className="text-accent font-mono text-sm" aria-hidden>
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="text-fg text-lg font-medium">{title}</h3>
              <p className="text-muted max-w-lg text-sm leading-relaxed">
                {body}
              </p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
