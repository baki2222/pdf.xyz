"use client";

import dynamic from "next/dynamic";
import { MAX_SOURCE_BYTES, MAX_SOURCE_MB } from "@/lib/tools/limits";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePreHydrationText } from "./pre-hydration-text";
import { Download, FileText, Keyboard, ShieldCheck, Type } from "lucide-react";
import {
  printablePlainText,
  textPdfOutputName,
  textToPdf,
} from "@/lib/pdf/text-to-pdf";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  Dropzone,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import {
  HandoffLoadedBadge,
  HandoffLoading,
  HandoffProblem,
} from "./handoff-notice";
import { useToolHandoff } from "./use-tool-handoff";
import { TextSourceNotes } from "./text-source-notes";
import { decodeTextFile, describeDecoding } from "@/lib/text/decode-text-file";
import { monospaceClaimSentence } from "@/lib/pdf/font-packs";

/** One owner for the in-browser source cap: the check and the copy both derive. */

/**
 * The typography promise, derived from the face that keeps it.
 *
 * It used to read "readable monospace typography" unconditionally, and one
 * arrow made it false. Then it read "Latin and Cyrillic text, arrows and box
 * drawing", which was false for ⇒ and for pinyin ǐ: the face draws neither, so
 * those documents still went to a proportional face. Every label now comes
 * from MONOSPACE_CLAIMS, whose members are checked one by one, and the rendered
 * sentence is checked for any category the face only partly draws
 * (`text-to-pdf-claim.test.tsx`). The title — the file name — shares the body
 * font, so it is named too.
 */
const MONOSPACE_CLAIM = `Paginated Letter-size PDF. ${monospaceClaimSentence()} Other characters, in the text or its file name, can move the whole document to a proportional Noto face.`;

/**
 * Two or more text files: the batch (batch plan P2), one PDF per file, its
 * own chunk, fetched only when they arrive — never with a visit to this page.
 */
const TextToPdfBatch = dynamic(
  () => import("./batch/text-to-pdf-batch").then((m) => m.TextToPdfBatch),
  {
    loading: () => (
      <div
        aria-hidden
        className="border-line bg-wash rounded-panel h-40 w-full border"
      />
    ),
  },
);

interface TextSource {
  name: string;
  text: string;
  /** How the picked file was decoded, when that was a guess worth checking. */
  readNote?: string | null;
}

export function TextToPdfRunner() {
  const handoff = useToolHandoff("text-to-pdf");
  const boxId = useId();
  const [source, setSource] = useState<TextSource>({
    name: "text.txt",
    text: "",
  });
  // Words typed before hydration survive it (pre-hydration-text.ts).
  usePreHydrationText(boxId, (text) =>
    setSource((current) => (current.text ? current : { ...current, text })),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const seededRef = useRef(false);
  // Two or more files, picked, dropped or handed over: the batch.
  const [many, setMany] = useState<File[] | null>(null);

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
    // Form feeds are kept: the converter starts a new page at each.
    const decoded = await decodeTextFile(file, { keepFormFeeds: true });
    setSource({
      name: file.name || "text.txt",
      text: decoded.text,
      readNote: describeDecoding(decoded),
    });
    setLoadError(null);
  }, []);

  useEffect(() => {
    if (seededRef.current) return;
    if (handoff.status === "ready" && handoff.files.length > 1) {
      seededRef.current = true;
      queueMicrotask(() => setMany(handoff.files));
    } else if (handoff.status === "ready" && handoff.files.length > 0) {
      seededRef.current = true;
      queueMicrotask(() => {
        void readTextFile(handoff.files[0]!);
      });
    }
  }, [handoff.status, handoff.files, readTextFile]);

  const resetMany = useCallback(() => setMany(null), []);
  // A Remove that leaves one file opens it in the editor, as a pick would.
  const narrowTo = useCallback(
    (file: File) => {
      setMany(null);
      void readTextFile(file);
    },
    [readTextFile],
  );

  if (handoff.status === "loading") return <HandoffLoading />;

  if (many)
    return (
      <TextToPdfBatch
        files={many}
        onReset={resetMany}
        onSingle={narrowTo}
        arrival={
          handoff.status === "ready"
            ? { origin: handoff.origin, skipped: handoff.skipped }
            : null
        }
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <HandoffProblem handoff={handoff} toolName="Text to PDF" />
      {handoff.status === "ready" && (
        <HandoffLoadedBadge
          origin={handoff.origin}
          count={1}
          skipped={handoff.skipped}
        />
      )}
      <TextToPdfEditor
        boxId={boxId}
        source={source}
        onSource={setSource}
        onFile={(files) =>
          files.length > 1
            ? setMany(files)
            : files[0] && void readTextFile(files[0])
        }
        loadError={loadError}
        onClearError={() => setLoadError(null)}
      />
    </div>
  );
}

function TextToPdfEditor({
  boxId,
  source,
  onSource,
  onFile,
  loadError,
  onClearError,
}: {
  boxId: string;
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
  // Pasted or typed text has no decoder note, so the converter's own count
  // stands in: the same characters it will drop (audit #34).
  const controlsNote = useMemo(() => {
    if (source.readNote) return null;
    const n = printablePlainText(source.text).removed;
    return n > 0
      ? `${n.toLocaleString()} control character${n === 1 ? " is" : "s are"} left out of the PDF — they have no printable shape.`
      : null;
  }, [source.readNote, source.text]);

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
        output={outputFile(result, filename)}
        onAdjust={reset}
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
        pageTarget
        busy={busy}
        onFiles={onFile}
        accept="text/plain,.txt"
        multiple
        title="Drop TXT files here, or"
        hint="One or more TXT files · plain text only, converted locally in your browser — several become one PDF each"
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
          id={boxId}
          value={source.text}
          onChange={(event) =>
            onSource({ ...source, text: event.target.value })
          }
          placeholder="Paste or type plain text here…"
          className="border-line text-fg focus:border-accent focus:ring-accent/50 bg-canvas rounded-panel [min-height:18rem] w-full resize-y border px-4 py-3 font-mono text-sm leading-6 transition outline-none focus:ring-2"
        />
        <TextSourceNotes
          readNote={source.readNote ?? controlsNote}
          text={source.text}
        />
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
            body="Load a .txt file or paste text directly."
          />
        </div>
      </RunnerSection>

      {loadError && <ErrorNote message={loadError} />}
      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton onClick={onRun} busy={busy} busyLabel="Creating PDF…">
            <FileText className="size-4" aria-hidden />
            Create PDF
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

/**
 * The file this runner opens: plain text by declared type or by name.
 * Exported so the hand-off gate can be held to it — a file carried here must
 * be one this check passes (`capability.test.ts`).
 */
export function isLikelyTextFile(file: Pick<File, "name" | "type">): boolean {
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
    <div className="border-line bg-wash rounded-panel border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
