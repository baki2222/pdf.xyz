"use client";

import type { ReactNode } from "react";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import type { OwnerPasswordTool } from "@/lib/pdf/owner-password-copy";
import type { ToolGrant } from "@/lib/pdf/security/open-with-password";
import {
  OwnerOpenedNote,
  OwnerPasswordField,
  OwnerRefusal,
} from "./owner-password";
import type { OwnerOpened } from "./owner-unlock";
import { SignedInputNotice } from "./single-pdf-runner";
import {
  readPageBoard,
  type LoadedPdf,
  type SinglePdfError,
} from "./use-single-pdf";

/**
 * The owner-password field (`./owner-password`) for the single-file tools —
 * Extract Pages, Delete Pages, Rotate PDF and Extract Images — with what
 * each runner needs around it: the refusal, the opened file's page board,
 * and the note above the editor. Loaded with `next/dynamic`, only once an
 * encrypted file has been refused (review 2026-11-17: the board read, the
 * signed-file notice and the opened wrapper sat in each runner's first-load
 * chunk, +0.3 KB gz a page).
 *
 * Its own module, not `./owner-password`: it reads the board with
 * `./use-single-pdf`, which Merge PDF does not load, and a lazy chunk that
 * Merge PDF also reaches would split that module out of the shared chunk on
 * every page (`./owner-unlock`). Only runners that already load it import
 * this.
 */
async function adopt({
  file,
  plain,
  protection,
}: OwnerOpened): Promise<LoadedPdf> {
  const { pageCount, rotations } = await readPageBoard(plain, "pdf-lib");
  return {
    file,
    bytes: plain,
    pageCount,
    rotations,
    digitalSignatures: countDigitalSignatures(plain),
    protection,
  };
}

/** The refusal of an encrypted file, and the field under it. */
export function OwnerPdfRefusal({
  error,
  tool,
  grant,
  onOpened,
}: {
  error: SinglePdfError;
  tool: OwnerPasswordTool;
  grant?: ToolGrant;
  onOpened: (pdf: LoadedPdf) => void;
}) {
  return (
    <OwnerRefusal
      key={`${error.file.name}:${error.file.size}:${error.file.lastModified}`}
      file={error.file}
      verdict={error.verdict}
      tool={tool}
      grant={grant}
      onOpened={async (opened) => onOpened(await adopt(opened))}
    />
  );
}

/** The field alone, under a refusal already said (`./restricted-grant`). */
export function OwnerPdfField({
  file,
  tool,
  grant,
  onOpened,
}: {
  file: File;
  tool: OwnerPasswordTool;
  grant?: ToolGrant;
  onOpened: (pdf: LoadedPdf) => void;
}) {
  return (
    <OwnerPasswordField
      file={file}
      tool={tool}
      grant={grant}
      onOpened={async (opened) => onOpened(await adopt(opened))}
    />
  );
}

/**
 * The editor of a file the field opened: the note saying how (it takes the
 * focus), and the signed-file notice the runner would have drawn.
 */
export function OwnedPdf({
  pdf,
  tool,
  toolName,
  writesPdf = true,
  children,
}: {
  pdf: LoadedPdf;
  tool: OwnerPasswordTool;
  toolName: string;
  writesPdf?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <OwnerOpenedNote tool={tool} owner={!!pdf.protection?.unlocked} />
      {writesPdf && pdf.digitalSignatures > 0 && (
        <SignedInputNotice count={pdf.digitalSignatures} toolName={toolName} />
      )}
      {children}
    </div>
  );
}
