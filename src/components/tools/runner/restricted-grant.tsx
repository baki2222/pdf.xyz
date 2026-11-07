"use client";

import { LockKeyhole } from "lucide-react";
import type { ProtectedPdf } from "@/lib/pdf/security/protected-pdf";
import { GRANT_PERMISSION_NAME } from "@/lib/pdf/restricted-grant-names";
import { buttonVariants } from "@/components/ui/button";
import { ErrorNote } from "./runner-kit";
import { FileHeader } from "./single-pdf-runner";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * A restricted PDF (it opens without a password; its author set an owner
 * password and withheld some permissions) in a tool that is not the editor:
 * the tool asks for ONE of the author's permissions, and either the file
 * grants it — the tool runs, and says so — or it does not, and the tool
 * says which permission was withheld and that only the owner password lifts
 * it. Nothing here lifts a restriction.
 *
 * Its own module, imported only by the runners that open such a file
 * (`openProtected`), so no other page carries these sentences.
 *
 *  - `assemble` — /P bit 11, "assemble the document" (insert, rotate or
 *    delete pages): Rotate PDF. The rotated copy is saved as an incremental
 *    update under the author's own encryption (`ProtectedPdf.saveChanges`).
 *  - `copy` — /P bit 5, "copy or otherwise extract text and graphics":
 *    Extract Images. Nothing is written back; the images are the output.
 */
export type RestrictedGrant = "assemble" | "copy";

/** Does this file's author grant what `grant` names? */
export function grantAllows(
  protection: ProtectedPdf,
  grant: RestrictedGrant,
): boolean {
  if (grant === "assemble") return protection.canAssemble;
  return protection.unlocked || protection.permissions.copy;
}

/** Said above the tool when the author grants it. */
export const GRANTED_NOTE: Record<RestrictedGrant, string> = {
  assemble:
    "This PDF's author restricted changes to it but allows its pages to be rotated. The rotated copy keeps the author's encryption, permissions and owner password.",
  copy: "This PDF's author restricted it but allows copying its content, so its images can be extracted. The PDF itself is not changed.",
};

/** Said instead of the tool when the author withholds it. */
export const WITHHELD_MESSAGE: Record<RestrictedGrant, string> = {
  assemble: `This PDF's author doesn't allow its pages to be rotated, inserted or deleted (the ${GRANT_PERMISSION_NAME.assemble} permission), so Rotate PDF can't change it without the owner password. Unlock PDF removes the restrictions with that password.`,
  copy: `This PDF's author doesn't allow copying its text and images (the ${GRANT_PERMISSION_NAME.copy} permission), so Extract Images can't take them out without the owner password. Unlock PDF removes the restrictions with that password.`,
};

export function RestrictedGrantNote({ grant }: { grant: RestrictedGrant }) {
  return (
    <p
      role="note"
      data-restricted-grant={grant}
      className="border-info/40 bg-info/10 text-fg rounded-panel flex items-start gap-2 border px-4 py-3 text-sm"
    >
      <LockKeyhole className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{GRANTED_NOTE[grant]}</span>
    </p>
  );
}

/** The file header, why the tool cannot run on it, and a way back. */
export function RestrictedGrantRefusal({
  pdf,
  grant,
  onReset,
}: {
  pdf: LoadedPdf;
  grant: RestrictedGrant;
  onReset: () => void;
}) {
  return (
    <div data-restricted-withheld={grant} className="flex flex-col gap-4">
      <FileHeader pdf={pdf} />
      <ErrorNote message={WITHHELD_MESSAGE[grant]} />
      <div>
        <button
          type="button"
          onClick={onReset}
          className={buttonVariants({ variant: "secondary", size: "lg" })}
        >
          Choose another PDF
        </button>
      </div>
    </div>
  );
}
