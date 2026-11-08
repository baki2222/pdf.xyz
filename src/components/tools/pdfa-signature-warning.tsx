"use client";

import { useId } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * The warning a digitally signed PDF gets on PDF to PDF/A before Run (audit
 * pdf-to-pdfa#6, 2026-11-08), with the confirmation Run waits for.
 *
 * Ghostscript's pdfwrite rebuilds the whole file. A signature covers exact
 * byte ranges of the original, so whatever happens to the signature field in
 * the copy, it no longer validates: it is dropped or reads as invalid. Which
 * of the two has not been checked on a real job, so the warning says only
 * that the signatures will not survive as valid ones.
 *
 * The count is `countDigitalSignatures`, the byte scan Optimize for Web's
 * warning uses, read in the browser before anything is uploaded. Shaped like
 * that warning (`web-input-notices.tsx`) so the tools that rewrite a signed
 * file say it the same way.
 */
function signatureNoun(count: number): string {
  return count === 1 ? "digital signature" : "digital signatures";
}

export function PdfASignatureWarning({
  id: groupId,
  count,
  confirmed,
  onConfirm,
}: {
  /** So Run can name this as the reason it is off (`aria-describedby`). */
  id: string;
  count: number;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
}) {
  const id = useId();
  const noun = signatureNoun(count);
  const one = count === 1;
  return (
    <div
      id={groupId}
      role="group"
      aria-label={`This PDF has ${count} ${noun}`}
      className="border-warn/40 bg-warn/10 text-warn rounded-panel flex flex-col gap-2 border px-4 py-3 text-sm"
    >
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">
            This PDF has {count} {noun}.
          </strong>{" "}
          Converting to PDF/A rewrites the whole file, so{" "}
          {one
            ? "it will not survive as a valid signature"
            : "they will not survive as valid signatures"}
          : the copy cannot prove who signed it or that it is unchanged. Keep
          the signed original, and archive it beside the PDF/A copy if the{" "}
          {noun} matter.
        </span>
      </p>
      <label
        htmlFor={id}
        className="text-fg flex min-h-11 items-center gap-2 pl-6"
      >
        <input
          id={id}
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirm(e.target.checked)}
        />
        <span>Convert anyway — I understand the {noun} will not survive</span>
      </label>
    </div>
  );
}
