"use client";

import { useEffect, useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { formatOfName } from "@/lib/intent/formats";
import { outputFiles, type RunOutput } from "@/lib/intent/run-output";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import { countPdfPagesDetailed } from "@/lib/pdf/page-count";
import { cn, formatBytes } from "@/lib/utils";
import { RESULT_ENDING_CHUNK } from "./result-ending-chunk";

/**
 * The receipt: what the run made, measured here. Type and size at once; for
 * a PDF, the page count — not the tool's own word for it, but the output
 * RE-OPENED in this browser and counted (`countPdfPagesDetailed`, the
 * count every other surface uses), after the first paint and never in the
 * way of Download.
 *
 * The proof ring (⊕) is drawn only next to a count that was made that way.
 * When the runner says how many pages it meant to write and the file holds
 * a different number, the receipt says so, where the reader is about to
 * download it. A file over the reader's ceiling is not re-opened, and the
 * receipt says that rather than show a number it did not measure.
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

/** Re-open every PDF the run made and count its pages, once per output. */
function usePageCount(output: RunOutput): Count | null {
  const files = outputFiles(output);
  const pdfs = files.filter((f) => isPdf(f.name, f.type));
  const counts = pdfs.length > 0 && pdfs.length === files.length;
  const [count, setCount] = useState<{ of: RunOutput; count: Count } | null>(
    null,
  );
  useEffect(() => {
    if (!counts) return;
    let live = true;
    const settle = (next: Count) => {
      if (live) setCount({ of: output, count: next });
    };
    if (pdfs.length > MAX_COUNTED) {
      settle({ state: "unknown" });
      return;
    }
    if (pdfs.some((f) => f.size > MAX_PDF_BYTES)) {
      settle({ state: "too-large" });
      return;
    }
    const measure = async () => {
      let total = 0;
      for (const file of pdfs) {
        const result = await countPdfPagesDetailed(
          await file.bytes(),
          MAX_PDF_BYTES,
        );
        if (!result.ok) return settle({ state: "unknown" });
        total += result.count;
      }
      settle({ state: "counted", pages: total });
    };
    // After the first paint, and never ahead of a click on Download.
    const idle = (
      window as { requestIdleCallback?: typeof requestIdleCallback }
    ).requestIdleCallback;
    const handle = idle
      ? idle(() => void measure(), { timeout: 500 })
      : window.setTimeout(() => void measure(), 0);
    return () => {
      live = false;
      if (idle) window.cancelIdleCallback?.(handle);
      else window.clearTimeout(handle);
    };
    // `output` is one object per output (`outputFile`), so this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output, counts]);
  if (!counts) return null;
  return count?.of === output ? count.count : { state: "counting" };
}

const pages = (n: number) => `${n} page${n === 1 ? "" : "s"}`;

export function OutputFacts({
  output,
  inputBytes,
  expectedPages,
  optimize = false,
}: {
  output: RunOutput;
  /** What went in, for the optimize tools' before-and-after. */
  inputBytes?: number;
  /** How many pages the runner meant to write, when it knows exactly. */
  expectedPages?: number;
  optimize?: boolean;
}) {
  const files = outputFiles(output);
  const size = files.reduce((sum, f) => sum + f.size, 0);
  const formats = [
    ...new Set(
      files.map((f) => (isPdf(f.name, f.type) ? "PDF" : formatOfName(f.name))),
    ),
  ].filter(Boolean);
  const count = usePageCount(output);
  const counted = count?.state === "counted" ? count.pages : null;
  const mismatch =
    counted !== null &&
    expectedPages !== undefined &&
    expectedPages !== counted;
  const proofId = useId();

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
            {count.state === "counted" ? (
              <span
                className="inline-flex items-center gap-1.5"
                aria-describedby={proofId}
              >
                <span className="figure">{count.pages}</span>
                <ProofMark />
              </span>
            ) : count.state === "counting" ? (
              <span className="sweep-placeholder motion-safe:animate-sweep text-faint">
                counting…
              </span>
            ) : count.state === "too-large" ? (
              <span className="text-muted">
                not re-counted (over {formatBytes(MAX_PDF_BYTES, 0)})
              </span>
            ) : (
              <span className="text-muted">not re-counted</span>
            )}
          </Fact>
        )}
      </dl>
      {counted !== null && (
        <p
          id={proofId}
          className="text-muted flex items-center gap-1.5 text-xs leading-5"
        >
          <ProofMark />
          Re-opened and counted in this browser: {pages(counted)}.
        </p>
      )}
      {mismatch && (
        <p
          role="status"
          className="text-warn flex items-start gap-2 text-xs leading-5"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Expected {pages(expectedPages!)}, counted {counted} — check the file
            before you share it.
          </span>
        </p>
      )}
      {optimize && inputBytes !== undefined && inputBytes > 0 && size > 0 && (
        <SizeCompare before={inputBytes} after={size} />
      )}
    </div>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="kicker text-faint">{term}</dt>
      <dd className="text-fg">{children}</dd>
    </div>
  );
}

/**
 * ⊕ — this figure was measured by re-opening the output here. Its words are
 * beside it ("Re-opened and counted in this browser"), so it is hidden from
 * assistive tech. Still; drawing it once (M10) is WP-12's.
 */
function ProofMark() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
      className="size-3 shrink-0"
      // The mark's colour: decoration, never text (B.2).
      style={{ color: "var(--sf-mark)" }}
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
