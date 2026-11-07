"use client";

import { useId } from "react";
import { AlertTriangle } from "lucide-react";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";

/**
 * What Optimize for Web learns from the picked file's bytes, in the browser,
 * before anything is uploaded (audit optimize-web#2, 2026-11-06).
 *
 * `qpdf --linearize` rewrites the whole file, so every certificate signature
 * in it stops validating: the byte ranges it covers move. Until this, the FAQ
 * was the only place that said so; the panel uploaded a signed contract and
 * handed back a file whose signature panel reads "altered".
 *
 * The count is the same byte scan the single-file tools' notice uses
 * (`countDigitalSignatures`), so no PDF parser is loaded for it. The panel
 * runs it twice on purpose: once on pick, to show the warning early, and
 * again on the exact bytes Run is about to upload, so a click that lands
 * before the first read finishes cannot slip a signed file past the gate.
 */
export interface WebInputFacts {
  /** The file these facts were read from; facts for another file are stale. */
  file: File;
  signatures: number;
}

export function inspectWebInput(file: File, bytes: Uint8Array): WebInputFacts {
  return { file, signatures: countDigitalSignatures(bytes) };
}

function signatureNoun(count: number): string {
  return count === 1 ? "digital signature" : "digital signatures";
}

/**
 * The warning a signed file gets before Run, with the confirmation Run waits
 * for. Shaped like Compress PDF's warning, so the two tools that rewrite a
 * signed file say it the same way.
 */
export function WebSignatureWarning({
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
          Linearizing rewrites the whole file, so the byte ranges{" "}
          {one ? "it covers" : "they cover"} no longer match:{" "}
          {one ? "it" : "they"} will show as invalid, even though every page
          looks the same. Keep your original if the {noun} matter, or linearize
          the unsigned version and sign it last.
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
        <span>
          Optimize anyway — I understand the {noun} will show as invalid
        </span>
      </label>
    </div>
  );
}
