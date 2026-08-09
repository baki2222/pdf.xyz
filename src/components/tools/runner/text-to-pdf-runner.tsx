"use client";

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
import { HandoffLoadedBadge, HandoffLoading, HandoffProblem } from "./handoff-notice";
import { useToolHandoff } from "./use-tool-handoff";

/** One owner for the in-browser source cap: the check and the copy both derive. */
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_MB = MAX_SOURCE_BYTES / (1024 * 1024);

interface TextSource {
  name: string;
  text: string;
}

export function TextToPdfRunner() {
  const handoff = useToolHandoff("text-to-pdf");
  const [source, setSource] = useState<TextSource>({ name: "text.txt", text: "" });
  const [loadError, setLoadError] = useState<string | null>(null);
  const seededRef = useRef(false);

  const readTextFile = useCallback(async (file: File) => {
    if (!isLikelyTextFile(file)) {
      setLoadError(`"${file.name}" isn't a plain text file — choose a .txt file.`);
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setLoadError(`"${file.name}" is too large for in-browser conversion (max ${MAX_SOURCE_MB} MB).`);
      return;
    }
    const text = await file.text();
    setSource({ name: file.name || "text.txt", text });
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
      {handoff.status === "ready" && <HandoffLoadedBadge count={1} skipped={handoff.skipped} />}
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
}: {
  source: TextSource;
  onSource: (source: TextSource) => void;
  onFile: (files: File[]) => void;
  loadError: string | null;
  onClearError: () => void;
}) {
  const { busy, error, result, run } = useAsyncRun<Uint8Array>();
  const characterCount = source.text.length;
  const byteCount = new TextEncoder().encode(source.text).byteLength;
  const filename = textPdfOutputName(source.name);

  const onRun = () =>
    run(() => textToPdf(source.text, { title: source.name.replace(/\.[^/.]+$/, "") }));

  if (result) {
    return (
      <ResultPanel
        title="PDF created"
        summary={`${formatBytes(result.byteLength)} · ${characterCount.toLocaleString()} characters converted`}
        onReset={() => onSource({ ...source, text: "" })}
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
        aside={<span className="text-xs text-slate-400">{characterCount.toLocaleString()} chars · {formatBytes(byteCount)}</span>}
      >
        <textarea
          value={source.text}
          onChange={(event) => onSource({ name: source.name, text: event.target.value })}
          placeholder="Paste or type plain text here…"
          className="min-h-72 w-full resize-y rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-sm leading-6 text-slate-100 outline-none transition focus:border-violet-400/50 focus:ring-2 focus:ring-violet-400/20"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <InfoTile icon={ShieldCheck} title="Private" body="The text never leaves your browser." />
          <InfoTile icon={Type} title="Formatted" body="Paginated Letter-size PDF with readable monospace typography." />
          <InfoTile icon={Keyboard} title="Flexible" body="Upload a .txt file or paste text directly." />
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <Icon className="size-4 text-violet-300" aria-hidden />
        {title}
      </div>
      <p className="text-xs leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}
