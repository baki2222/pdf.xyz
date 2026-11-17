"use client";

import { useEffect, useId, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { parsePassword } from "@/lib/jobs/pdf-password";
import { classifyPdfAccess } from "@/lib/pdf/encryption";
import { OWNER_PASSWORD_LABEL } from "@/lib/pdf/owner-password-copy";
import { PASSWORD_QUEUE_LIFETIME } from "@/lib/privacy/job-queue";

/**
 * OCR PDF's Owner password field (competitor-audit backlog #11,
 * 2026-11-17), for a PDF that opens without a password but carries its
 * author's restrictions. Until then the worker refused such a file and sent
 * the person to Unlock PDF.
 *
 * Loaded with `next/dynamic` by the OCR panel only while the live worker
 * proves `ocrOwnerPassword` and a PDF is chosen, so no first load carries
 * it. It asks the file the question every other surface asks
 * (`classifyPdfAccess`, the browser's pdf.js open) and draws the field only
 * for a RESTRICTED file: an unrestricted PDF, one that needs a password to
 * open, and one the probe cannot read show nothing, and their job carries
 * no password.
 *
 * Unlike the browser-checked owner-password field of Merge PDF and the
 * other page tools (`./runner/owner-password`), this password must travel:
 * OCR runs on our server. The panel sends it with the job, where it is
 * sealed before the job queue stores it, and the worker checks that it IS
 * the owner password before anything is decrypted. What happens to it is
 * said in the hint, before it is typed.
 */

/** What the panel needs from the field. */
export interface OcrOwnerState {
  /** The file the state is about: a new file starts over. */
  file: File;
  /** The probe says the file opens freely but carries restrictions. */
  restricted: boolean;
  /** What is typed, as typed. Sent only when {@link problem} is null. */
  password: string;
  /** Why what is typed cannot be sent, or null. */
  problem: string | null;
}

export const OCR_OWNER_HINT = `This PDF opens without a password, but its author restricted what can be done with it. Type its owner (permissions) password to run OCR on it. The searchable PDF keeps the same restrictions and the same owner password, and still opens without a password; a text file, if you ask for one, has no restrictions. The password goes with your file to our secure server, which checks that it is the owner password before it reads anything. ${PASSWORD_QUEUE_LIFETIME}`;

/** Said under the field while it is empty. */
export const OCR_OWNER_NEEDED =
  "Type the owner password to run OCR on this PDF.";

function problemOf(password: string): string | null {
  if (password === "") return OCR_OWNER_NEEDED;
  const parsed = parsePassword(
    password,
    "options.ownerPassword",
    OWNER_PASSWORD_LABEL,
  );
  return parsed.ok ? null : parsed.error.body.error.message;
}

export function OcrOwnerPassword({
  file,
  onChange,
}: {
  file: File;
  onChange: (state: OcrOwnerState) => void;
}) {
  const id = useId();
  const [restricted, setRestricted] = useState(false);
  const [password, setPassword] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const access = await classifyPdfAccess(bytes);
      if (!live) return;
      const isRestricted = access.kind === "restricted";
      setRestricted(isRestricted);
      onChange({
        file,
        restricted: isRestricted,
        password: "",
        problem: isRestricted ? OCR_OWNER_NEEDED : null,
      });
    })().catch(() => {});
    return () => {
      live = false;
    };
    // One probe per file; `onChange` is the panel's state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  if (!restricted) return null;
  const problem = problemOf(password);
  return (
    <div
      data-ocr-owner-password=""
      className="border-line bg-panel rounded-panel flex flex-col gap-3 border px-4 py-3.5"
    >
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`${id}-pw`}
          className="text-fg flex items-start gap-2 text-sm font-medium"
        >
          <LockKeyhole
            className="text-info mt-0.5 size-4 shrink-0"
            aria-hidden
          />
          {OWNER_PASSWORD_LABEL}
        </label>
        <input
          id={`${id}-pw`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={password}
          onChange={(e) => {
            const next = e.target.value;
            setPassword(next);
            onChange({
              file,
              restricted: true,
              password: next,
              problem: problemOf(next),
            });
          }}
          aria-describedby={`${id}-hint${problem ? ` ${id}-problem` : ""}`}
          aria-invalid={(password !== "" && problem !== null) || undefined}
          className="border-line bg-canvas text-fg rounded-ctl h-11 w-full border px-3 text-sm"
        />
      </div>
      <p id={`${id}-hint`} className="text-muted text-xs">
        {OCR_OWNER_HINT}
      </p>
      {problem && (
        <p id={`${id}-problem`} className="text-warn text-xs leading-relaxed">
          {problem}
        </p>
      )}
    </div>
  );
}
