"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { formatOfName } from "@/lib/intent/formats";
import {
  outputFiles,
  type OutputFile,
  type RunOutput,
} from "@/lib/intent/run-output";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import { countPdfPagesDetailed } from "@/lib/pdf/page-count";
import { cn, formatBytes } from "@/lib/utils";
import { RESULT_ENDING_CHUNK } from "./result-ending-chunk";

/**
 * The receipt: what the run made, measured here. Type and size at once; for
 * a PDF, the page count — not the tool's own word for it, but the output
 * RE-OPENED in this browser and counted (`countPdfPagesDetailed`, the
 * count every other surface uses), after the first paint.
 *
 * ONE STATEMENT, in the Pages fact: "5 ⊕ re-opened and counted in this
 * browser". The proof ring (⊕) is drawn only next to a count that was made
 * that way, and only once. (It was three statements of one figure — the
 * summary's, the fact's and a line of its own under them — with the ring
 * drawn twice, and on a phone the line's ring floated between its two
 * wrapped lines: WP-08 review, 2026-10-10.)
 *
 * NOTHING HERE MOVES DOWNLOAD. The count settles after the receipt has been
 * painted, and the Download row is under it, so the fact's every state —
 * counting, counted, not counted — is drawn in the SAME cell from the first
 * render, the ones not current invisible (`Settles`): the cell is as large
 * as the largest of them at every width, wrapped lines included, and a
 * state change repaints inside it. Measured at 50b2a243 before this: the
 * line the count added pushed Download down 32 px at 1280 and 52 px at
 * 390, after the input window (`e2e/continue-chain.spec.ts` holds the
 * button still from first paint to the settled count, and fails with the
 * stacking removed).
 *
 * When the runner says how many pages it meant to write and the file holds
 * a different number, `CountMismatch` says so — a part of its own, which
 * the result panel draws BELOW its Download row, so a warning that can only
 * arrive after the count never lands above the button. A file over the
 * reader's ceiling is not re-opened, and the receipt says that rather than
 * show a number it did not measure.
 *
 * For the optimize tools, the size before and after as two dimension lines
 * drawn to one scale — the only place on the site a length stands for a
 * quantity, and only under two measured figures.
 */

/** Files a receipt re-opens at most; past this it counts none rather than some. */
const MAX_COUNTED = 12;

type Count =
  | { readonly state: "counting" }
  | { readonly state: "counted"; readonly pages: number }
  | { readonly state: "too-large" }
  | { readonly state: "unknown" };

const isPdf = (name: string, type: string) =>
  type === "application/pdf" || formatOfName(name) === "PDF";

/**
 * What is known about an output's count before anything is re-opened: not
 * counted at all (`null` — not every file is a PDF), never to be counted and
 * why (a settled {@link Count}), or the PDFs to re-open.
 */
function countPlan(
  output: RunOutput,
): null | Count | { readonly pdfs: readonly OutputFile[] } {
  const files = outputFiles(output);
  const pdfs = files.filter((f) => isPdf(f.name, f.type));
  if (pdfs.length === 0 || pdfs.length !== files.length) return null;
  if (pdfs.length > MAX_COUNTED) return { state: "unknown" };
  if (pdfs.some((f) => f.size > MAX_PDF_BYTES)) return { state: "too-large" };
  return { pdfs };
}

/**
 * One count per output, however many parts of the receipt ask for it (the
 * facts, and the mismatch drawn under Download): the output object is one
 * per output (`outputFile` keeps it), so it keys both the count in flight
 * and the count it settled to.
 */
const inFlight = new WeakMap<object, Promise<Count>>();
const settledCounts = new WeakMap<object, Count>();

function countOf(output: RunOutput, pdfs: readonly OutputFile[]) {
  let pending = inFlight.get(output);
  if (!pending) {
    pending = (async (): Promise<Count> => {
      let total = 0;
      for (const file of pdfs) {
        const result = await countPdfPagesDetailed(
          await file.bytes(),
          MAX_PDF_BYTES,
        );
        if (!result.ok) return { state: "unknown" };
        total += result.count;
      }
      return { state: "counted", pages: total };
    })().then((count) => {
      settledCounts.set(output, count);
      return count;
    });
    inFlight.set(output, pending);
  }
  return pending;
}

/** Re-open every PDF the run made and count its pages, once per output. */
function usePageCount(output: RunOutput): Count | null {
  const plan = countPlan(output);
  const measuring = plan !== null && !("state" in plan);
  const [count, setCount] = useState<{ of: RunOutput; count: Count } | null>(
    null,
  );
  useEffect(() => {
    if (!measuring) return;
    // Already counted (a remount of the same output): the render reads it.
    if (settledCounts.has(output)) return;
    let live = true;
    const measure = () =>
      void countOf(output, (plan as { pdfs: readonly OutputFile[] }).pdfs).then(
        (next) => {
          if (live) setCount({ of: output, count: next });
        },
      );
    // After the first paint, and never ahead of a click on Download.
    const idle = (
      window as { requestIdleCallback?: typeof requestIdleCallback }
    ).requestIdleCallback;
    const handle = idle
      ? idle(measure, { timeout: 500 })
      : window.setTimeout(measure, 0);
    return () => {
      live = false;
      if (idle) window.cancelIdleCallback?.(handle);
      else window.clearTimeout(handle);
    };
    // `output` is one object per output (`outputFile`), so this runs once;
    // `plan` is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output, measuring]);
  if (plan === null) return null;
  if ("state" in plan) return plan;
  if (count?.of === output) return count.count;
  return settledCounts.get(output) ?? { state: "counting" };
}

const pages = (n: number) => `${n} page${n === 1 ? "" : "s"}`;

export function OutputFacts({
  output,
  inputBytes,
  expectedPages,
  optimize = false,
  mismatch = true,
}: {
  output: RunOutput;
  /** What went in, for the optimize tools' before-and-after. */
  inputBytes?: number;
  /** How many pages the runner meant to write, when it knows exactly. */
  expectedPages?: number;
  optimize?: boolean;
  /**
   * Draw the count-mismatch warning here, under the facts. The result panel
   * passes `false` and draws {@link CountMismatch} under its Download row
   * instead; a receipt that is already under its Download (the compress
   * analysis, a batch, a worker's card) keeps it.
   */
  mismatch?: boolean;
}) {
  const files = outputFiles(output);
  const size = files.reduce((sum, f) => sum + f.size, 0);
  const formats = [
    ...new Set(
      files.map((f) => (isPdf(f.name, f.type) ? "PDF" : formatOfName(f.name))),
    ),
  ].filter(Boolean);
  const count = usePageCount(output);

  return (
    <div
      className="flex flex-col gap-3"
      data-receipt=""
      data-chunk={RESULT_ENDING_CHUNK}
    >
      {/* The tear line the ticket uses: what follows is the stub — the
          measured facts of what was made. */}
      <div aria-hidden className="perforation" />
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <Fact term={files.length === 1 ? "File" : "Files"}>
          {files.length === 1
            ? (formats[0] ?? "File")
            : `${files.length} ${formats.length === 1 ? `${formats[0]}s` : "files"}`}
        </Fact>
        <Fact term="Size">
          <span className="figure">{formatBytes(size)}</span>
        </Fact>
        {count && (
          <Fact term="Pages">
            {count.state === "too-large" ? (
              // Known before anything is re-opened, and never changes.
              <span className="text-muted">
                not re-counted (over {formatBytes(MAX_PDF_BYTES, 0)})
              </span>
            ) : (
              <Settles
                current={count.state}
                states={{
                  counting: (
                    <span className="sweep-placeholder motion-safe:animate-sweep text-faint">
                      counting in this browser…
                    </span>
                  ),
                  counted: (
                    <CountedPages
                      pages={
                        count.state === "counted"
                          ? count.pages
                          : // The cell is sized before the figure is known:
                            // the figure the runner expects, else three
                            // digits — a count that differs by a digit
                            // changes no line break on any width tested.
                            (expectedPages ?? 100)
                      }
                    />
                  ),
                  unknown: <span className="text-muted">not re-counted</span>,
                }}
              />
            )}
          </Fact>
        )}
      </dl>
      {mismatch && (
        <CountMismatch output={output} expectedPages={expectedPages} />
      )}
      {optimize && inputBytes !== undefined && inputBytes > 0 && size > 0 && (
        <SizeCompare before={inputBytes} after={size} />
      )}
    </div>
  );
}

/**
 * "Expected 21 pages, counted 20 — check the file before you share it." —
 * the receipt's warning, for a result whose runner knew how many pages it
 * meant to write. Shares the receipt's count (one re-open per output). It
 * can only appear AFTER the count, so a panel draws it where its arrival
 * moves nothing the reader is reaching for: under the Download row.
 */
export function CountMismatch({
  output,
  expectedPages,
}: {
  output: RunOutput;
  expectedPages?: number;
}) {
  const count = usePageCount(output);
  if (
    expectedPages === undefined ||
    count?.state !== "counted" ||
    count.pages === expectedPages
  )
    return null;
  return (
    <p
      role="status"
      className="text-warn flex items-start gap-2 text-xs leading-5"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        Expected {pages(expectedPages)}, counted {count.pages} — check the file
        before you share it.
      </span>
    </p>
  );
}

/**
 * "5 ⊕ re-opened and counted in this browser": the figure, its ring and its
 * words, in one line of text that wraps like text — the ring is inline, so
 * it stays beside the figure on the first line rather than centring itself
 * between two. Heard as "5, re-opened and counted in this browser".
 */
function CountedPages({ pages }: { pages: number }) {
  return (
    <span>
      <span className="figure">{pages}</span>
      <span className="sr-only">,</span> <ProofMark />{" "}
      <span className="text-muted">re-opened and counted in this browser</span>
    </span>
  );
}

/**
 * Every state a value can settle to, drawn in ONE grid cell from the first
 * render: the cell takes the size of the largest at the width it has, and
 * only the current one is visible (and heard — `visibility: hidden` leaves
 * the accessibility tree). So a value that settles after the page is
 * painted repaints inside a box that was already its size, and moves
 * nothing around it.
 */
function Settles<K extends string>({
  current,
  states,
}: {
  current: K;
  states: Record<K, ReactNode>;
}) {
  return (
    <span className="grid" data-settles={current}>
      {(Object.keys(states) as K[]).map((key) => (
        <span
          key={key}
          data-current={key === current ? "" : undefined}
          aria-hidden={key === current ? undefined : true}
          className={key === current ? undefined : "invisible"}
          // One cell for all: a style, not a new utility, since this is an
          // on-demand chunk and the stylesheet is on every page.
          style={{ gridArea: "1 / 1" }}
        >
          {states[key]}
        </span>
      ))}
    </span>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="kicker text-faint shrink-0">{term}</dt>
      <dd className="text-fg min-w-0">{children}</dd>
    </div>
  );
}

/**
 * ⊕ — this figure was measured by re-opening the output here. Its words are
 * beside it ("re-opened and counted in this browser"), so it is hidden from
 * assistive tech. Inline, at the text's x-height, so it flows with the line
 * it belongs to. Still; drawing it once (M10) is WP-12's.
 */
function ProofMark() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
      className="inline-block size-3"
      // The mark's colour: decoration, never text (B.2). Its baseline
      // offset in style, not a new utility (the stylesheet is on every
      // page; this is an on-demand chunk).
      style={{ color: "var(--sf-mark)", verticalAlign: "-0.1em" }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
    >
      <circle cx="6" cy="6" r="5" pathLength="1" />
      <path d="M6 2.5v7M2.5 6h7" />
    </svg>
  );
}

/**
 * Before and after as dimension lines to one scale: the longer is the full
 * width, the shorter its share of it. The words carry the same facts
 * ("4.2 MB to 1.3 MB, 69% smaller"), so the lines are decoration to a
 * screen reader.
 */
function SizeCompare({ before, after }: { before: number; after: number }) {
  const longest = Math.max(before, after);
  const change = Math.round((Math.abs(before - after) / before) * 100);
  const verdict =
    after < before
      ? `${change}% smaller`
      : after > before
        ? `${change}% larger`
        : "the same size";
  return (
    // One scale, kept short: two lines across a wide panel put each figure
    // a hand's width from the end it measures.
    <figure
      className="flex flex-col gap-2"
      data-size-compare=""
      style={{ maxWidth: "28rem" }}
    >
      <div aria-hidden className="flex flex-col gap-2.5">
        {[
          ["Before", before],
          ["After", after],
        ].map(([label, bytes]) => (
          <div key={label as string} className="flex items-center gap-3">
            {/* Widths in style, not new utilities: this is an on-demand
                chunk, and the stylesheet is on every page. */}
            <span className="kicker text-faint shrink-0" style={{ width: 56 }}>
              {label}
            </span>
            <span className="flex h-2.5 flex-1 items-center">
              {/* A dimension line: the length is the figure, to one scale,
                  capped at both ends with the mark (the stats band's
                  `dim-cap`, so no new rule ships to every page). */}
              <span
                data-dimension-line=""
                className="dim-cap block"
                style={{
                  width: `${((bytes as number) / longest) * 100}%`,
                  height: 1,
                  background: "var(--sf-line-strong)",
                }}
              >
                <span
                  className="dim-cap"
                  style={{ position: "absolute", top: 0, right: 0 }}
                />
              </span>
            </span>
            <span className="figure text-fg text-xs">
              {formatBytes(bytes as number)}
            </span>
          </div>
        ))}
      </div>
      <figcaption
        className={cn(
          "text-xs",
          after < before
            ? "text-ok"
            : after > before
              ? "text-warn"
              : "text-muted",
        )}
      >
        <span className="sr-only">
          {formatBytes(before)} to {formatBytes(after)},{" "}
        </span>
        {verdict}
      </figcaption>
    </figure>
  );
}
