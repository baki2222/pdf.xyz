"use client";

/**
 * EPUB to PDF's file picker: the drop zone before a book is chosen, and the
 * chosen book (with Remove) after — the HTML panel's picker in shape, with
 * its own literal `accept`, which the guards that hold guides and page drops
 * to what a panel takes read from the source.
 */
import type { Tool } from "@/lib/tools/types";
import { pickRefusal } from "@/lib/uploads/pick-check";
import { Dropzone } from "./runner/runner-kit";
import { ChosenFileTarget } from "./chosen-file-target";

export function EpubFilePicker({
  tool,
  file,
  busy,
  onFile,
  onMany,
}: {
  tool: Tool;
  file: File | null;
  busy: boolean;
  onFile: (file: File | null) => void;
  /** Two or more books dropped at once: the batch (batch plan P3). */
  onMany: (files: File[]) => void;
}) {
  return file ? (
    <ChosenFileTarget
      file={file}
      accept="application/epub+zip,.epub"
      busy={busy}
      refuse={(file) => pickRefusal(tool, file)}
      onReplace={(files) => onFile(files[0] ?? null)}
    >
      <div className="border-line bg-wash text-fg rounded-ctl flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm">
        <span className="truncate">{file.name}</span>
        <button
          type="button"
          onClick={() => onFile(null)}
          className="text-muted hover:text-fg tap-y shrink-0 text-sm font-medium transition"
        >
          Remove
        </button>
      </div>
    </ChosenFileTarget>
  ) : (
    <Dropzone
      pageTarget
      busy={busy}
      refuse={(file) => pickRefusal(tool, file)}
      onFiles={(files) =>
        // Never to the batch while a job runs (one resumed after a reload
        // has no file in hand, so this zone shows): a second job would
        // start beside it, its status hidden behind the list.
        files.length > 1 && !busy ? onMany(files) : onFile(files[0] ?? null)
      }
      accept="application/epub+zip,.epub"
      compact
      title="Add an EPUB file, or"
      hint="One or more EPUB files"
    />
  );
}
