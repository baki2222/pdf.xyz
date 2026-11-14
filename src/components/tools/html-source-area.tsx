"use client";

import { useCallback, useEffect, useId, useState } from "react";
import dynamic from "next/dynamic";
import { ClipboardPaste, Info } from "lucide-react";
import { decodeTextFile } from "@/lib/text/decode-text-file";
import {
  findUnbundledAssetsInHtml,
  unbundledAssetsNote,
} from "@/lib/workers/html-render/unbundled-assets";
import {
  HTML_ZIP_NOT_RUNNING_MESSAGE,
  isZipName,
} from "@/lib/workers/html-render/zip-config";
import type { ZipInspection } from "@/lib/workers/html-render/zip-inspect";
import { toolTakesFile } from "@/lib/uploads/pick-check";
import { ceilingRefusal } from "@/lib/tools/ceiling-message";
import type { HtmlRenderWorkerInput } from "@/lib/workers/html-render-client";
import type {
  PdfSecurityWorkerOptions,
  PdfSecurityWorkerResult,
} from "@/lib/workers/pdf-security-client";
import type { Tool } from "@/lib/tools/types";
import { Dropzone } from "./runner/runner-kit";
import { ChosenFileTarget } from "./chosen-file-target";

/**
 * HTML to PDF's input, the part of the panel only that tool has: a chosen
 * HTML file, pasted HTML code, or — when the running worker proves it can
 * print one (`status.htmlZip`) — a ZIP of a page and its files.
 *
 * ITS OWN CHUNK. `html-render-worker-panel.tsx` serves three tools (HTML,
 * Webpage and EPUB to PDF) and loads this module for HTML to PDF alone, so
 * the other two pages carry none of it — not the missing-files scan, not
 * the paste box's loader, not the ZIP picker. The paste box and the ZIP
 * reader (with JSZip) load later still: when the box is opened, and when a
 * ZIP is picked.
 *
 * What the panel needs back ({@link HtmlSourceState}): whether Run may start
 * and, if not, why in words; and for a ZIP, how to run it (the page to
 * print travels with the job as `entry`, through `html-zip-client`).
 */

export interface HtmlSourceState {
  /** Why Run cannot start yet, in words; null when it can. */
  blocked: string | null;
  /** A ZIP's run (its page chosen); absent for an HTML file or pasted code. */
  run?: (
    input: HtmlRenderWorkerInput,
    controls: PdfSecurityWorkerOptions,
  ) => Promise<PdfSecurityWorkerResult>;
}

const HtmlPasteBox = dynamic(
  () => import("./html-paste-box").then((m) => m.HtmlPasteBox),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden
        className="border-line bg-wash rounded-ctl h-48 border"
      />
    ),
  },
);

/** What the picker takes: HTML, and a ZIP only when the worker opens one. */
const HTML_ACCEPT = "text/html,.html,.htm";
const ZIP_ACCEPT = "text/html,.html,.htm,application/zip,.zip";

const SELECT =
  "border-line bg-wash text-fg focus:border-accent/40 rounded-ctl min-h-11 border px-3 py-1.5 text-sm outline-none sm:min-h-0";

/**
 * The note for linked files the upload will not carry, read from the chosen
 * file on this machine — nothing is uploaded to work it out. The worker
 * serves only the file itself, so a sibling `logo.png` or `style.css` comes
 * out as a broken image or an unstyled page while the job still succeeds.
 * (Moved here from the panel, unchanged, on 2026-11-14.)
 */
function useUnbundledAssetsNote(file: File | null): string | null {
  const [note, setNote] = useState<{ file: File; text: string | null } | null>(
    null,
  );
  useEffect(() => {
    if (!file) return;
    let active = true;
    // Decoded in the file's own encoding, as every read of a user's text file
    // is (`decodeTextFile`): Blob.text() would turn a Windows-1252 page's
    // accented link names into U+FFFD before they were looked for.
    decodeTextFile(file)
      .then(({ text: html }) => {
        if (active)
          setNote({
            file,
            text: unbundledAssetsNote(findUnbundledAssetsInHtml(html)),
          });
      })
      .catch(() => {
        // Unreadable here means unreadable for the upload too; the run
        // reports that. A note we cannot compute is simply not shown.
      });
    return () => {
      active = false;
    };
  }, [file]);
  // A note belongs to the file it was computed for, never to the next one.
  return note && note.file === file ? note.text : null;
}

/** A picked ZIP, read in the browser (`zip-inspect`, loaded with the pick). */
function useZipInspection(file: File | null): ZipInspection | "reading" | null {
  const [state, setState] = useState<{
    file: File;
    inspection: ZipInspection;
  } | null>(null);
  useEffect(() => {
    if (!file) return;
    let active = true;
    import("@/lib/workers/html-render/zip-inspect")
      .then(({ inspectHtmlZip }) => inspectHtmlZip(file))
      .then((inspection) => {
        if (active) setState({ file, inspection });
      })
      .catch(() => {
        if (active)
          setState({
            file,
            inspection: {
              ok: false,
              message:
                "This ZIP could not be read here. Check your connection and choose it again.",
            },
          });
      });
    return () => {
      active = false;
    };
  }, [file]);
  if (!file) return null;
  return state && state.file === file ? state.inspection : "reading";
}

export function HtmlSourceArea({
  tool,
  file,
  busy,
  zipOffered,
  ceilingBytes,
  refuse,
  onFile,
  onState,
}: {
  tool: Tool;
  file: File | null;
  busy: boolean;
  /** The live worker proves `htmlZip`: a ZIP may be picked. */
  zipOffered: boolean;
  /** The HTML ceiling the page states (`usePickFacts`). */
  ceilingBytes: number | null;
  /** The page's pick check for an HTML file (`usePickRefusal`). */
  refuse: (file: File) => string | null;
  onFile: (file: File | null) => void;
  onState: (state: HtmlSourceState) => void;
}) {
  const [pasting, setPasting] = useState(false);
  const zip = file !== null && isZipName(file.name) ? file : null;
  const assetsNote = useUnbundledAssetsNote(zip ? null : file);
  const inspection = useZipInspection(zip);
  const [chosen, setChosen] = useState<{ file: File; entry: string } | null>(
    null,
  );
  const entry =
    chosen && chosen.file === zip
      ? chosen.entry
      : inspection !== null &&
          inspection !== "reading" &&
          inspection.ok &&
          inspection.choice.kind === "one"
        ? inspection.choice.entry
        : null;
  const [zipNote, setZipNote] = useState<{
    key: string;
    text: string | null;
  } | null>(null);
  const noteKey = zip && entry ? `${zip.name}\u0000${entry}` : null;
  useEffect(() => {
    if (
      !noteKey ||
      inspection === null ||
      inspection === "reading" ||
      !inspection.ok ||
      !entry
    )
      return;
    let active = true;
    inspection.note(entry).then((text) => {
      if (active) setZipNote({ key: noteKey, text });
    });
    return () => {
      active = false;
    };
  }, [noteKey, inspection, entry]);
  const missingNote = zip
    ? zipNote && zipNote.key === noteKey
      ? zipNote.text
      : null
    : assetsNote;

  // What the panel needs to know, every time it changes.
  useEffect(() => {
    if (!zip) return onState({ blocked: null });
    if (!zipOffered) return onState({ blocked: HTML_ZIP_NOT_RUNNING_MESSAGE });
    if (inspection === "reading" || inspection === null)
      return onState({ blocked: "Reading the ZIP…" });
    if (!inspection.ok) return onState({ blocked: inspection.message });
    if (!entry)
      return onState({
        blocked: "Choose which page of the ZIP to print.",
      });
    const page = entry;
    onState({
      blocked: null,
      run: (input, controls) =>
        import("@/lib/workers/html-zip-client").then(
          ({ runWorkerHtmlZipToPdf }) =>
            runWorkerHtmlZipToPdf({ ...input, entry: page }, controls),
        ),
    });
  }, [zip, zipOffered, inspection, entry, onState]);

  // A ZIP is judged by its name and the ceiling here; whether its insides
  // can be printed is the reader's question (above) and the worker's.
  const pickRefuse = useCallback(
    (picked: File): string | null => {
      if (zipOffered && isZipName(picked.name))
        return ceilingBytes !== null && picked.size > ceilingBytes
          ? ceilingRefusal(tool.name, ceilingBytes)
          : null;
      if (zipOffered && !toolTakesFile(tool, picked))
        return `"${picked.name}" isn't a file ${tool.name} takes — it works on HTML or HTM files, or a ZIP of a page and its files.`;
      return refuse(picked);
    },
    [zipOffered, ceilingBytes, refuse, tool],
  );
  const accept = zipOffered ? ZIP_ACCEPT : HTML_ACCEPT;
  const pickerId = useId();

  const pasteToggle = (
    <button
      type="button"
      aria-expanded={pasting}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (busy) return;
        // Closing the box drops what it handed on: a pasted page is never
        // uploaded from a box the user has closed.
        if (pasting) onFile(null);
        setPasting(!pasting);
      }}
      className="text-muted hover:text-fg tap-y inline-flex items-center gap-1.5 self-start text-xs font-medium transition aria-disabled:opacity-50"
    >
      <ClipboardPaste className="size-3.5" aria-hidden />
      {pasting ? "Choose a file instead" : "Or paste HTML code"}
    </button>
  );

  if (pasting)
    return (
      <div className="flex flex-col gap-2">
        <HtmlPasteBox
          ceilingBytes={ceilingBytes}
          disabled={busy}
          onFile={onFile}
        />
        <MissingNote text={file ? missingNote : null} />
        {pasteToggle}
      </div>
    );

  if (!file)
    return (
      <div className="flex flex-col gap-2">
        <Dropzone
          pageTarget
          refuse={pickRefuse}
          onFiles={(files) => onFile(files[0] ?? null)}
          accept={accept}
          multiple={false}
          compact
          title="Add an HTML file, or"
          hint={zipOffered ? "HTML, or a ZIP of a page and its files" : "HTML"}
        />
        {pasteToggle}
      </div>
    );

  const chosenRow = (
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
  );
  const candidates =
    inspection !== null && inspection !== "reading" && inspection.ok
      ? inspection.choice.candidates
      : [];
  return (
    <div className="flex flex-col gap-2">
      <ChosenFileTarget
        file={file}
        accept={accept}
        busy={busy}
        refuse={pickRefuse}
        onReplace={(files) => onFile(files[0] ?? null)}
      >
        {chosenRow}
      </ChosenFileTarget>
      {zip && candidates.length > 1 && (
        <label
          htmlFor={pickerId}
          className="text-muted flex flex-col gap-1 text-xs"
        >
          Page to print
          <select
            id={pickerId}
            value={entry ?? ""}
            aria-disabled={busy || undefined}
            onChange={(event) => {
              if (busy) return;
              setChosen(
                event.target.value
                  ? { file: zip, entry: event.target.value }
                  : null,
              );
            }}
            className={SELECT}
          >
            {entry === null && (
              <option value="" disabled>
                Choose a page…
              </option>
            )}
            {candidates.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      {zip && candidates.length === 1 && entry && (
        <p className="text-muted text-xs">
          Prints {entry}, the page in this ZIP.
        </p>
      )}
      <MissingNote text={missingNote} />
    </div>
  );
}

/**
 * Present, empty, from the moment a file is chosen: a live region created
 * together with its text is not announced by several screen readers. The
 * note arrives in it once the file is read.
 */
function MissingNote({ text }: { text: string | null }) {
  return (
    <div role="status">
      {text && (
        <p className="text-muted flex items-start gap-1.5 text-xs leading-relaxed">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{text}</span>
        </p>
      )}
    </div>
  );
}
