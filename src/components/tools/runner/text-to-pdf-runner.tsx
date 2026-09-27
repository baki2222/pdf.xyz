"use client";

import { MAX_SOURCE_BYTES, MAX_SOURCE_MB } from "@/lib/tools/tool-facts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Keyboard, ShieldCheck, Type } from "lucide-react";
import { textPdfOutputName, textToPdf } from "@/lib/pdf/text-to-pdf";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  Dropzone,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  useAsyncRun,
} from "./runner-kit";
import {
  HandoffLoadedBadge,
  HandoffLoading,
  HandoffProblem,
} from "./handoff-notice";
import { useToolHandoff } from "./use-tool-handoff";
import { TextSourceNotes } from "./text-source-notes";
import { decodeTextFile, describeDecoding } from "@/lib/text/decode-text-file";
import { FONT_PACKS } from "@/lib/pdf/font-packs";

/** One owner for the in-browser source cap: the check and the copy both derive. */

/**
 * The typography promise, derived from the face that keeps it.
 *
 * It used to read "readable monospace typography" unconditionally, and one
 * arrow made it false: the whole document moved to a proportional Japanese
 * face. The monospace pack now keeps it for the scripts it covers, and ONLY
 * those — a Greek, Bengali or CJK document is still set in a proportional Noto
 * face — so the sentence names them from the pack table rather than a
 * hand-typed list that could outlive a font change.
 */
const MONOSPACE_CLAIM = `Paginated Letter-size PDF. ${FONT_PACKS.filter(
  (pack) => pack.role === "monospace",
)
  .flatMap((pack) => pack.scripts)
  .join(
    " and ",
  )} text, arrows and box drawing are set in a monospace face. A document with any other script or symbol is set in a proportional Noto face.`;

interface TextSource {
  name: string;
  text: string;
  /** How the picked file was decoded, when that was a guess worth checking. */
  readNote?: string | null;
}

export function TextToPdfRunner() {
  const handoff = useToolHandoff("text-to-pdf");
  const [source, setSource] = useState<TextSource>({
    name: "text.txt",
    text: "",
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const seededRef = useRef(false);

  const readTextFile = useCallback(async (file: File) => {
    if (!isLikelyTextFile(file)) {
      setLoadError(
        `"${file.name}" isn't a plain text file — choose a .txt file.`,
      );
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setLoadError(
        `"${file.name}" is too large for in-browser conversion (max ${MAX_SOURCE_MB} MB).`,
      );
      return;
    }
    // Not `file.text()`: that is UTF-8 or nothing, and it turned a
    // Windows-1252 note into "caf� �q�" and a Notepad "Unicode" save into
    // U+FFFD and NULs — then reported "PDF created". The size gate above stays
    // on bytes, so this is one decode of at most MAX_SOURCE_BYTES.
    const decoded = await decodeTextFile(file);
    setSource({
      name: file.name || "text.txt",
      text: decoded.text,
      readNote: describeDecoding(decoded),
    });
    setLoadError(null);
  }, []);

  useEffect(() => {
    if (seededRef.current) return;
    if (handoff.status === "ready" && handoff.files.length > 0) {
      seededRef.current = true;
      queueMicrotask(() => {
        void readTextFile(handoff.files[0]!);
      });
    }
  }, [handoff.status, handoff.files, readTextFile]);

  if (handoff.status === "loading") return <HandoffLoading />;

  return (
    <div className="flex flex-col gap-4">
      <HandoffProblem handoff={handoff} toolName="Text to PDF" />
      {handoff.status === "ready" && (
        <HandoffLoadedBadge count={1} skipped={handoff.skipped} />
      )}
      <TextToPdfEditor
        source={source}
        onSource={setSource}
        onFile={(files) => files[0] && void readTextFile(files[0])}
        loadError={loadError}
        onClearError={() => setLoadError(null)}
      />
    </div>
  );
}

function TextToPdfEditor({
  source,
  onSource,
  onFile,
  loadError,
  onClearError,
}: {
  source: TextSource;
  onSource: (source: TextSource) => void;
  onFile: (files: File[]) => void;
  loadError: string | null;
  onClearError: () => void;
}) {
  const { busy, error, result, run, reset } = useAsyncRun<Uint8Array>();
  const characterCount = source.text.length;
  const byteCount = new TextEncoder().encode(source.text).byteLength;
  const filename = textPdfOutputName(source.name);

  const onRun = () =>
    run(() =>
      textToPdf(source.text, { title: source.name.replace(/\.[^/.]+$/, "") }),
    );

  if (result) {
    return (
      <ResultPanel
        title="PDF created"
        summary={`${formatBytes(result.byteLength)} · ${characterCount.toLocaleString()} characters converted`}
        onReset={() => {
          // The result lives in THIS component's hook; emptying the text alone
          // left the success panel up with "0 characters converted".
          reset();
          onSource({ name: "text.txt", text: "" });
          onClearError();
        }}
      >
        <button
          type="button"
          onClick={() => downloadBytes(result, filename)}
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Dropzone
        onFiles={onFile}
        accept="text/plain,.txt"
        multiple={false}
        title="Drop a TXT file here, or"
        hint="Plain text only · converted locally in your browser"
      />

      <RunnerSection
        title="Text content"
        aside={
          <span className="text-muted text-xs">
            {characterCount.toLocaleString()} chars · {formatBytes(byteCount)}
          </span>
        }
      >
        <textarea
          value={source.text}
          onChange={(event) =>
            onSource({ ...source, text: event.target.value })
          }
          placeholder="Paste or type plain text here…"
          className="border-line text-fg focus:border-accent focus:ring-accent/50 [min-height:18rem] w-full resize-y rounded-[4px] border bg-black/20 px-4 py-3 font-mono text-sm leading-6 transition outline-none focus:ring-2"
        />
        <TextSourceNotes readNote={source.readNote} text={source.text} />
        <div className="grid gap-3 sm:grid-cols-3">
          <InfoTile
            icon={ShieldCheck}
            title="Private"
            body="The text never leaves your browser."
          />
          <InfoTile icon={Type} title="Formatted" body={MONOSPACE_CLAIM} />
          <InfoTile
            icon={Keyboard}
            title="Flexible"
            body="Upload a .txt file or paste text directly."
          />
        </div>
      </RunnerSection>

      {loadError && <ErrorNote message={loadError} />}
      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton onClick={onRun} busy={busy} busyLabel="Creating PDF…">
          <FileText className="size-4" aria-hidden />
          Create PDF
        </RunButton>
      </div>
    </div>
  );
}

function isLikelyTextFile(file: File): boolean {
  return file.type === "text/plain" || /\.(txt|text)$/i.test(file.name);
}

function InfoTile({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof FileText;
  title: string;
  body: string;
}) {
  return (
    <div className="border-line bg-wash rounded-[4px] border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
