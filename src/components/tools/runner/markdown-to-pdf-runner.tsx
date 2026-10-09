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
import { TextSourceNotes } from "./text-source-notes";
import { decodeTextFile, describeDecoding } from "@/lib/text/decode-text-file";

/** One owner for the in-browser source cap: the check and the copy both derive. */

interface MarkdownSource {
  name: string;
  text: string;
  /** How the picked file was decoded, when that was a guess worth checking. */
  readNote?: string | null;
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
    // Not `file.text()`, which is UTF-8 or nothing — see decode-text-file.ts.
    const decoded = await decodeTextFile(file);
    setSource({
      name: file.name || "document.md",
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
        onClearError={() => setLoadError(null)}
      />
    </div>
  );
}

function MarkdownToPdfEditor({
  source,
  onSource,
  onFile,
  loadError,
  onClearError,
}: {
  source: MarkdownSource;
  onSource: (source: MarkdownSource) => void;
  onFile: (files: File[]) => void;
  loadError: string | null;
  onClearError: () => void;
}) {
  const { busy, error, result, run, reset } = useAsyncRun<Uint8Array>();
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
        onReset={() => {
          reset();
          onSource({ name: "document.md", text: "" });
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
        accept="text/markdown,text/x-markdown,.md,.markdown,.mdown"
        multiple={false}
        title="Drop a Markdown file here, or"
        hint="Markdown is rendered locally in your browser"
      />

      <RunnerSection
        title="Markdown content"
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
          placeholder="# Title\n\nWrite or paste Markdown here…"
          className="border-line text-fg focus:border-accent focus:ring-accent/50 bg-canvas [min-height:18rem] w-full resize-y rounded-[4px] border px-4 py-3 font-mono text-sm leading-6 transition outline-none focus:ring-2"
        />
        <TextSourceNotes readNote={source.readNote} text={source.text} />
        <div className="grid gap-3 sm:grid-cols-3">
          <InfoTile
            icon={ShieldCheck}
            title="Private"
            body="Your Markdown stays in the browser; no upload is needed."
          />
          <InfoTile
            icon={Hash}
            title="Structured"
            body="Headings, nested lists, tables, quotes, rules, and code blocks keep their structure in the PDF."
          />
          <InfoTile
            icon={ListChecks}
            title="Honest"
            body="Bold and italic print as plain text, links print as the label with its URL, and images as their alt text and URL. Not an HTML/CSS engine."
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

/**
 * The file this runner opens: Markdown by declared type or by name. Exported
 * so the hand-off gate can be held to it — a file carried here must be one
 * this check passes (`capability.test.ts`).
 */
export function isLikelyMarkdownFile(
  file: Pick<File, "name" | "type">,
): boolean {
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
    <div className="border-line bg-wash rounded-[4px] border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
