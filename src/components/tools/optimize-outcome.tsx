"use client";

import Link from "next/link";
import type { Job } from "@/lib/jobs/types";
import { isLinearized } from "@/lib/pdf/linearization";
import { formatBytes } from "@/lib/utils";
import { RepairWarnings } from "./repair-warnings";

/**
 * The sentence a finished Optimize for Web run ends on — shown AND announced,
 * from the same function, so the eye and a screen reader get the same claim.
 *
 * It is read from the bytes the user is about to download. The worker checks
 * linearization too (since 2026-09-27), but its image is built by hand and can
 * be older than this page; an image from before that check would deliver
 * whatever qpdf wrote. Until then this was a constant — "Your web-optimized PDF
 * is ready." — on every success, whether or not the file was linearized.
 */
export function optimizeDoneSentence(output: Uint8Array): string {
  return isLinearized(output)
    ? "Your web-optimized PDF is ready."
    : "Your PDF is ready, but it is not linearized, so it will not load any faster than the original.";
}

/**
 * Everything a finished web optimization shows above its download: what qpdf
 * had to work around (if anything), the outcome sentence, and the size before
 * and after — with "Linearized for fast web view" only when the file carries
 * a linearization dictionary whose length is its own.
 *
 * A file that GREW is expected — linearizing adds hint tables — and is the one
 * case a user might have come here for the wrong tool, so it says which tool
 * makes files smaller.
 *
 * `inputBytes` is the size of the file THIS run uploaded, and is absent when
 * the page does not know it: a job resumed after a reload finishes with no
 * file in hand, and a size of 0 there would print "0 B → …" and call every
 * result a file that grew. Then only the output's size is shown.
 */
export function OptimizeOutcome({
  job,
  inputBytes,
  output,
}: {
  job: Job | undefined;
  inputBytes?: number;
  output: Uint8Array;
}) {
  const linearized = isLinearized(output);
  const known = inputBytes !== undefined && inputBytes > 0;
  const grew = known && output.byteLength > inputBytes;
  return (
    <>
      <RepairWarnings job={job} variant="optimize" />
      <p className={linearized ? "text-ok text-sm" : "text-warn text-sm"}>
        {optimizeDoneSentence(output)}
      </p>
      <p className="text-muted text-sm">
        {linearized ? "Linearized for fast web view · " : ""}
        {known
          ? `${formatBytes(inputBytes)} → ${formatBytes(output.byteLength)}`
          : formatBytes(output.byteLength)}
      </p>
      {grew && (
        <p className="text-muted text-sm leading-relaxed">
          The file grew: linearizing adds an index that lets the first page show
          before the rest downloads, and it does not compress anything. To make
          a PDF smaller, use{" "}
          <Link
            href="/tools/compress-pdf"
            className="text-fg font-medium underline underline-offset-4"
          >
            Compress PDF
          </Link>
          .
        </p>
      )}
    </>
  );
}
