"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { formatBytes } from "@/lib/utils";
import {
  PASTED_HTML_FILENAME,
  pastedHtmlByteLength,
  pastedHtmlBytes,
} from "@/lib/workers/html-render/pasted-html";

/**
 * "Paste HTML code": the alternative to the drop box on HTML to PDF. What is
 * pasted becomes a file — `pasted.html`, its bytes made by the ONE function
 * the Chromium test renders (`pastedHtmlBytes`: a UTF-8 byte-order mark,
 * then the text as UTF-8) — and goes up EXACTLY as a chosen file does: the
 * same missing-files note, layout, job, retention, cancel and download. It
 * is not rendered in the browser, and the description says so.
 *
 * Loaded only when the user opens it (`html-source-area.tsx`).
 *
 * THE BOUND is the HTML ceiling the page states (`ceilingBytes`, from the
 * server's pick facts), counted in the bytes that will be uploaded — the
 * mark included — by `pastedHtmlByteLength`. The count is shown once the
 * text passes {@link COUNT_FROM} of it; past the ceiling the box is marked
 * invalid, the error is tied to it, and nothing is handed on to upload.
 */

/** The share of the ceiling past which the byte count is shown. */
export const COUNT_FROM = 0.8;

/** How long typing must pause before the text becomes the file. */
const SETTLE_MS = 250;

const INPUT_MINUTES = DEFAULT_RETENTION.inputTtlMinutes;

export function HtmlPasteBox({
  ceilingBytes,
  disabled,
  onFile,
}: {
  /** The most bytes one HTML upload may be; null outside a tool page. */
  ceilingBytes: number | null;
  disabled?: boolean;
  /** The pasted page as a file to upload, or null (empty, or over the bound). */
  onFile: (file: File | null) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;
  const errorId = `${id}-error`;
  const [text, setText] = useState("");
  const bytes = text === "" ? 0 : pastedHtmlByteLength(text);
  const over = ceilingBytes !== null && bytes > ceilingBytes;
  const showCount = ceilingBytes !== null && bytes >= ceilingBytes * COUNT_FROM;

  // The text becomes the file once typing settles — or at once when it is
  // emptied or goes over the bound, so Run never starts on a stale file.
  const handed = useRef<string | null>(null);
  useEffect(() => {
    if (text.trim() === "" || over) {
      if (handed.current !== null) {
        handed.current = null;
        onFile(null);
      }
      return;
    }
    const timer = setTimeout(() => {
      handed.current = text;
      onFile(
        new File([pastedHtmlBytes(text) as BlobPart], PASTED_HTML_FILENAME, {
          type: "text/html",
        }),
      );
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [text, over, onFile]);

  const describedBy = [
    hintId,
    showCount ? countId : null,
    over ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-fg text-xs font-medium">
        HTML code
      </label>
      <textarea
        id={id}
        value={text}
        readOnly={disabled}
        aria-readonly={disabled || undefined}
        onChange={(event) => setText(event.target.value)}
        rows={8}
        spellCheck={false}
        autoCapitalize="none"
        autoComplete="off"
        aria-invalid={over || undefined}
        aria-describedby={describedBy}
        placeholder="<!doctype html>…"
        className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 focus:ring-accent/50 rounded-ctl aria-invalid:border-err min-h-40 w-full border px-3 py-2 font-mono text-xs outline-none focus:ring-2"
      />
      <p id={hintId} className="text-muted text-xs leading-relaxed">
        Pasted code is not run in your browser: it is uploaded to our server as
        a file named {PASTED_HTML_FILENAME}, exactly like a chosen file, and
        deleted when the job finishes (within {INPUT_MINUTES} minutes in any
        case).
        {ceilingBytes !== null &&
          ` Up to ${formatBytes(ceilingBytes)}, counted as uploaded.`}
      </p>
      {showCount && ceilingBytes !== null && (
        <p id={countId} className="text-muted text-xs tabular-nums">
          {formatBytes(bytes)} of {formatBytes(ceilingBytes)}
        </p>
      )}
      {over && ceilingBytes !== null && (
        <p id={errorId} role="alert" className="text-err text-xs">
          This HTML is {formatBytes(bytes)}, over the{" "}
          {formatBytes(ceilingBytes)} HTML to PDF takes in one run. Remove some
          of it, or move large images into files linked by full https://
          addresses.
        </p>
      )}
    </div>
  );
}
