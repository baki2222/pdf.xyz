"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { announceOutcome } from "@/components/a11y/live-region";
import { ErrorNote } from "@/components/tools/runner/runner-kit";
import { useDropBox, sheetEmit } from "@/components/upload/use-drop-box";
import { takesByAccept } from "@/lib/intent/accept-match";
import { toolNameAt } from "@/lib/intent/drop-engine";
import { confirmLeave } from "@/lib/intent/unsaved";

/**
 * A tool page's "replace" targets: a file dropped or pasted anywhere on a
 * page whose drop zone has given way — to an open editor
 * (`SinglePdfRunner`), or to the chip of a file a worker panel has chosen
 * (`ChosenFileTarget`) — replaces what is there.
 *
 * FETCHED WITH THE FIRST FILE, NOT WITH THE PAGE. Both surfaces exist only
 * once a file has arrived, so what makes them targets — their drop boxes
 * (`useDropBox`), and what a file landing on them sets off — is this one
 * module, which they load as they appear (`React.lazy`). As first merged
 * each carried it in the page's first load: 0.2 KB gz on every single-PDF
 * tool page and every worker tool page, against WP-07's 0.8 for everything
 * it added there (G.1; WP-07 re-review). Until it is here (React reveals a
 * lazy component up to 300 ms after the surface it sits in), the surface
 * is drawn as the page's target to be — `data-page-drop-target` with no
 * engine's mark — and a file released meanwhile waits for it
 * (`targetsArrived` in the registry), up to 2 s, before the ticket dialog
 * takes it.
 *
 * Unsaved work is asked about first (`confirmLeave`; which editors register
 * it is WP-08's). Then the swap is SAID — "Replaced alpha.pdf with beta.pdf
 * in Rotate PDF.", the tool as its page names it (`data-tool-name`) — and,
 * in an editor, focus SURVIVES it.
 */

/**
 * This module's mark, rendered on the chip it makes a target
 * (`data-chunk`), so `lazy-chunks.test.ts` can find it in the build and in
 * no page's first load.
 */
export const REPLACE_BOXES_CHUNK = "replace-boxes-chunk";

/** What an open editor takes: a PDF, by type or by name. */
const PDF = "application/pdf,.pdf";
const takesPdf = takesByAccept(PDF);

/** The tool a target is part of, as its page names it — or `fallback`. */
const named = (box: HTMLElement | null, fallback: string) =>
  toolNameAt(box) ?? fallback;

/**
 * An open single-PDF editor as its page's target (verb "replace"): a PDF
 * dropped or pasted anywhere on the page opens in its place, through the
 * same `open` a pick uses. Renders nothing; makes `editor` — the editor's
 * own box, keyed by its file — the drop box. It does not take a file while
 * a run is in flight — read from the editor's own `aria-busy`, the
 * statement a screen reader hears — and a file that is not a PDF goes to
 * the ticket dialog rather than closing the editor on an error. Secondary
 * zones inside the editor never register (`Dropzone`'s `pageTarget` is
 * opt-in), so Sign PDF's signature-image zone cannot take the page's drops
 * from it, and a release made ON that zone is the zone's (it hears it
 * first).
 */
export function EditorBox({
  editor,
  from,
  open,
  toolName,
}: {
  /** The editor's box on the page now. */
  readonly editor: { readonly current: HTMLElement | null };
  /** The file open now. */
  readonly from: string;
  /** The runner's own `open`, the one a pick uses. */
  readonly open: (file: File) => Promise<void>;
  /** The tool, where no page names it. */
  readonly toolName: string;
}) {
  const box = useDropBox({
    accept: PDF,
    target: {
      verb: "replace",
      current: from,
      canReceive: () => !editor.current?.querySelector('[aria-busy="true"]'),
    },
    emit: (files) =>
      void replaceOpenFile({
        files,
        from,
        toolName,
        open,
        editor: () => editor.current,
      }),
  });
  useEffect(() => {
    const element = editor.current;
    return element ? (box(element) ?? undefined) : undefined;
  }, [editor, box]);
  return null;
}

/** What a worker panel's chosen file is made of (`ChosenFileTarget`). */
export interface ChosenFileProps {
  /** The file chosen now. */
  readonly file: File;
  /** The panel zone's `accept`. */
  readonly accept: string;
  /** The panel's job is running: nothing may land mid-run. */
  readonly busy: boolean;
  /** The panel zone's `refuse`. */
  readonly refuse: (file: File) => string | null;
  /** What the zone's `onFiles` does, after whatever Remove resets. */
  readonly onReplace: (files: File[]) => void;
  /** The chip. */
  readonly children: ReactNode;
}

/**
 * A worker panel's chosen file — its chip — as its page's target (verb
 * "replace"), with the same gates as the zone it replaced: the page routes
 * here only files of a kind the panel takes (its `accept`), never while its
 * job is running, and every file passes the panel's own `refuse` first (its
 * ceiling, the server's type rule) — a refused file is never chosen, and
 * why is said here, as the zone says it.
 */
export default function ChosenFileLive({
  file,
  accept,
  busy,
  refuse,
  onReplace,
  children,
}: ChosenFileProps) {
  // The chip's element, for the sentence's tool name: state, set as React
  // attaches it, so nothing reads a ref while rendering.
  const [chip, setChip] = useState<HTMLElement | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const emit = sheetEmit(
    (kept) =>
      replaceChosenFile({ files: kept, from: file.name, chip, onReplace }),
    refuse,
    setRefusal,
  );
  const box = useDropBox({
    accept,
    target: {
      verb: "replace",
      current: file.name,
      canReceive: () => !busy,
    },
    emit,
  });
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      setChip(element);
      return box(element);
    },
    [box],
  );
  return (
    <div
      ref={ref}
      data-page-drop-target=""
      data-chunk={REPLACE_BOXES_CHUNK}
      className="flex flex-col gap-2"
    >
      {children}
      {refusal && <ErrorNote message={refusal} />}
    </div>
  );
}

/**
 * Replace the document open in a single-PDF editor with the first PDF among
 * `files` (a drop or a paste anywhere on its page hands the target all of
 * them) — through the runner's own `open`, the one a pick uses.
 *
 * The editor is keyed by its file, so the swap remounts it: whatever had
 * focus inside it (a paste is made with focus somewhere — on Rotate's
 * buttons, say) is gone, and focus fell to <body>; and nothing said a file
 * had been swapped — on a paste the live region stayed empty, on a drop it
 * heard only "Rendering previews…" (WP-07 review, measured on the served
 * build). Now, once the new editor is on the page, the swap is announced,
 * and when focus was inside the old editor, or has nowhere to be, it moves
 * to the new one's file header (its name, pages and size), as
 * `useOutcomeFocus` repairs an orphaned focus after a run. A file that
 * cannot be opened says so itself (the runner's error), and is not
 * announced as a replace. A release with no PDF in it changes nothing.
 */
export async function replaceOpenFile({
  files,
  from,
  toolName,
  open,
  editor,
}: {
  /** The files arriving. */
  readonly files: readonly File[];
  /** The name of the file it replaces. */
  readonly from: string;
  /** The tool, when the page does not name it. */
  readonly toolName: string;
  /** The runner's own `open`, the one a pick uses. */
  readonly open: (file: File) => Promise<void>;
  /** The editor on the page now (its element changes with the file). */
  readonly editor: () => HTMLElement | null;
}): Promise<void> {
  const next = files.find((file) => takesPdf(file));
  if (!next || !confirmLeave()) return;
  const before = editor();
  const name = named(before, toolName);
  const active = document.activeElement;
  const focusInside = !!active && !!before?.contains(active);
  await open(next);
  const after = await remounted(editor, before);
  if (!after) return;
  announceOutcome(`Replaced ${from} with ${next.name} in ${name}.`);
  const now = document.activeElement;
  const orphaned = !now || now === document.body || !now.isConnected;
  if (!(focusInside || orphaned)) return;
  const into = after.querySelector<HTMLElement>("[data-file-header]") ?? after;
  if (!into.hasAttribute("tabindex")) into.setAttribute("tabindex", "-1");
  into.focus({ preventScroll: true });
}

/**
 * Replace a worker panel's chosen file with the files that passed its
 * `refuse` — after `confirmLeave()` — and say so.
 */
export function replaceChosenFile({
  files,
  from,
  chip,
  onReplace,
}: {
  /** The files that passed the panel's own `refuse`. */
  readonly files: File[];
  /** The name of the file chosen now. */
  readonly from: string;
  /** The chip on the page now. */
  readonly chip: HTMLElement | null;
  /** What the panel's zone does with files, after whatever Remove resets. */
  readonly onReplace: (files: File[]) => void;
}): void {
  if (files.length === 0 || !confirmLeave()) return;
  const name = named(chip, "this tool");
  onReplace(files);
  announceOutcome(`Replaced ${from} with ${files[0]!.name} in ${name}.`);
}

/** Frames to wait for the new editor; past them the file did not open. */
const FRAMES = 120;

/** The editor once it has remounted with the new file, or null. */
function remounted(
  editor: () => HTMLElement | null,
  before: HTMLElement | null,
): Promise<HTMLElement | null> {
  const frame =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 16);
  return new Promise((resolve) => {
    let frames = 0;
    const look = () => {
      const el = editor();
      if (el && el !== before && el.isConnected) return resolve(el);
      if (++frames > FRAMES) return resolve(null);
      frame(look);
    };
    look();
  });
}
