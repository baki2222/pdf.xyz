"use client";

import { MAX_SOURCE_BYTES, MAX_SOURCE_MB } from "@/lib/tools/tool-facts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FileText,
  Hash,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import {
  markdownPdfOutputName,
  markdownToPdf,
} from "@/lib/pdf/markdown-to-pdf";
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

/** One owner for the in-browser source cap: the check and the copy both derive. */

interface MarkdownSource {
  name: string;
  text: string;
}

export function MarkdownToPdfRunner() {
  const handoff = useToolHandoff("markdown-to-pdf");
  const [source, setSource] = useState<MarkdownSource>({
    name: "document.md",
    text: "",
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const seededRef = useRef(false);

  const readMarkdownFile = useCallback(async (file: File) => {
    if (!isLikelyMarkdownFile(file)) {
      setLoadError(
        `"${file.name}" isn't a Markdown file — choose a .md or .markdown file.`,
      );
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setLoadError(
        `"${file.name}" is too large for in-browser conversion (max ${MAX_SOURCE_MB} MB).`,
      );
      return;
    }
    const text = await file.text();
    setSource({ name: file.name || "document.md", text });
    setLoadError(null);
  }, []);

  useEffect(() => {
    if (seededRef.current) return;
    if (handoff.status === "ready" && handoff.files.length > 0) {
      seededRef.current = true;
      queueMicrotask(() => {
        void readMarkdownFile(handoff.files[0]!);
      });
    }
  }, [handoff.status, handoff.files, readMarkdownFile]);

  if (handoff.status === "loading") return <HandoffLoading />;

  return (
    <div className="flex flex-col gap-4">
      <HandoffProblem handoff={handoff} toolName="Markdown to PDF" />
      {handoff.status === "ready" && (
        <HandoffLoadedBadge count={1} skipped={handoff.skipped} />
      )}
      <MarkdownToPdfEditor
        source={source}
        onSource={setSource}
        onFile={(files) => files[0] && void readMarkdownFile(files[0])}
        loadError={loadError}
      />
    </div>
  );
}

function MarkdownToPdfEditor({
  source,
  onSource,
  onFile,
  loadError,
}: {
  source: MarkdownSource;
  onSource: (source: MarkdownSource) => void;
  onFile: (files: File[]) => void;
  loadError: string | null;
}) {
  const { busy, error, result, run } = useAsyncRun<Uint8Array>();
  const characterCount = source.text.length;
  const byteCount = new TextEncoder().encode(source.text).byteLength;
  const filename = markdownPdfOutputName(source.name);

  const onRun = () =>
    run(() =>
      markdownToPdf(source.text, {
        title: source.name.replace(/\.[^/.]+$/, ""),
      }),
    );

  if (result) {
    return (
      <ResultPanel
        title="PDF created"
        summary={`${formatBytes(result.byteLength)} · ${characterCount.toLocaleString()} Markdown characters converted locally`}
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
        accept="text/markdown,text/x-markdown,.md,.markdown,.mdown"
        multiple={false}
        title="Drop a Markdown file here, or"
        hint="Markdown is rendered locally in your browser"
      />

      <RunnerSection
        title="Markdown content"
        aside={
          <span className="text-xs text-slate-400">
            {characterCount.toLocaleString()} chars · {formatBytes(byteCount)}
          </span>
        }
      >
        <textarea
          value={source.text}
          onChange={(event) =>
            onSource({ name: source.name, text: event.target.value })
          }
          placeholder="# Title\n\nWrite or paste Markdown here…"
          className="min-h-72 w-full resize-y rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-sm leading-6 text-slate-100 transition outline-none focus:border-violet-400/50 focus:ring-2 focus:ring-violet-400/20"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <InfoTile
            icon={ShieldCheck}
            title="Private"
            body="Your Markdown stays in the browser; no upload is needed."
          />
          <InfoTile
            icon={Hash}
            title="Structured"
            body="Headings, lists, blockquotes, links, and code fences are rendered into a readable PDF."
          />
          <InfoTile
            icon={ListChecks}
            title="Honest"
            body="This is a clean document renderer, not a full HTML/CSS publishing engine."
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

function isLikelyMarkdownFile(file: File): boolean {
  return (
    file.type === "text/markdown" ||
    file.type === "text/x-markdown" ||
    /\.(md|markdown|mdown)$/i.test(file.name)
  );
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
