"use client";

import { useCallback, useState } from "react";
import { Download, FileCode, Globe, ShieldCheck, Timer } from "lucide-react";
import { pipelineStagesForStatus } from "@/lib/jobs/pipeline-pending";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  canRunHtmlRender,
  runWorkerHtmlToPdf,
  runWorkerWebpageToPdf,
  type HtmlRenderWorkerResult,
} from "@/lib/workers/html-render-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { toolFileCeilingBytes } from "@/lib/tools/file-ceilings";
import type { Tool } from "@/lib/tools/types";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import {
  DownloadCta,
  Dropzone,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";
import { jobBusyLabel, useWorkerJob, WorkerJobStatus } from "./worker-job";
import { resumeSecurityJob } from "@/lib/workers/pdf-security-client";
import {
  useWorkerStatus,
  WorkerStatusPending,
  type WorkerPhase,
} from "./worker-status";

type Phase = WorkerPhase;
type Mode = "html" | "url";

function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading") {
    return { tone: "info", label: "Checking…", pulse: true };
  }
  if (phase === "error" || !status) {
    return { tone: "muted", label: "Status unknown", pulse: false };
  }
  return canRunHtmlRender(status)
    ? { tone: "ok", label: "Secure worker", pulse: false }
    : { tone: "muted", label: "Not enabled", pulse: false };
}

function SpecRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileCode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-muted inline-flex items-center gap-2 text-sm">
        <Icon className="text-muted size-4" aria-hidden />
        {label}
      </span>
      <span className="text-fg text-right text-sm font-medium">{value}</span>
    </div>
  );
}

export function HtmlRenderWorkerPanel({ tool }: { tool: Tool }) {
  const mode: Mode = tool.slug === "webpage-to-pdf" ? "url" : "html";
  const Icon = mode === "url" ? Globe : FileCode;
  const ceilingBytes = toolFileCeilingBytes(tool);
  const { phase, status, retry } = useWorkerStatus();

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunHtmlRender(status);

  return (
    <div className="">
      <div className="border-line bg-panel flex flex-col gap-6 rounded-[4px] border p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="border-info/40 bg-info/10 text-info inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
              <Icon className="size-3" aria-hidden />
              Chromium renderer
            </span>
            <StatusBadge
              tone={badge.tone}
              label={badge.label}
              pulse={badge.pulse}
            />
          </div>
          <h2 className="text-fg text-lg font-semibold">
            {tool.name} runs on an encrypted secure worker
          </h2>
          <p className="text-muted text-sm leading-relaxed">
            Chromium renders{" "}
            {mode === "url" ? "the public URL" : "your uploaded HTML file"} to a
            real print PDF on the isolated worker. It produces a PDF artifact or
            fails honestly — no screenshot placeholder and no browser-side fake.
          </p>
        </div>

        {available ? (
          <HtmlRenderRunArea mode={mode} />
        ) : (
          <HtmlRenderUnavailable
            onRetry={retry}
            phase={phase}
            status={status}
            toolName={tool.name}
            toolSlug={tool.slug}
          />
        )}

        <div className="flex flex-col gap-3">
          <h3 className="text-faint font-mono text-xs font-medium tracking-[0.18em] uppercase">
            What happens
          </h3>
          <ol className="flex flex-col gap-1">
            {pipelineStagesForStatus(status?.scan.active).map(
              (stage, index, all) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <div className="flex flex-col items-center self-stretch">
                    <span className="border-line bg-wash text-muted grid size-8 shrink-0 place-items-center rounded-full border">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    {index < all.length - 1 && (
                      <span className="bg-wash my-1 w-px flex-1" aria-hidden />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 pb-3">
                    <span className="text-fg text-sm font-medium">
                      {index + 1}. {stage.title}
                    </span>
                    <span className="text-muted text-xs leading-relaxed">
                      {stage.description}
                    </span>
                  </div>
                </li>
              ),
            )}
          </ol>
        </div>

        <div className="bg-panel border-line divide-y divide-white/5 rounded-[4px] border px-4 py-1">
          <SpecRow
            icon={mode === "url" ? Globe : FileCode}
            label="Input"
            value={mode === "url" ? "One public URL" : "One HTML file"}
          />
          <SpecRow icon={Download} label="Output" value="PDF" />
          <SpecRow
            icon={Timer}
            label="Retention"
            value={`Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`}
          />
          {/* The per-file cap, only where there IS a file. This row stated
              "100.0 MB/file" on `webpage-to-pdf` too — three rows under an
              Input row correctly reading "One public URL", for a tool the API
              refuses uploads for outright (`parseCreateUploadSessionRequest`
              answers `unprocessable_entity` on any `files` for a url-input
              tool). A per-file ceiling on a tool with no file input is not a
              conservative claim, it is a meaningless one, and it was the only
              size figure on that page. */}
          {ceilingBytes !== null && (
            <SpecRow
              icon={ShieldCheck}
              label="Limit"
              value={`${formatBytes(ceilingBytes)}/file`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function HtmlRenderUnavailable({
  phase,
  onRetry,
  status,
  toolName,
  toolSlug,
}: {
  phase: Phase;
  onRetry: () => void;
  status: WorkerStatus | null;
  toolName: string;
  toolSlug: string;
}) {
  // Until the status is KNOWN this box says nothing about the tool: the
  // server renders the loading phase, and "Notify me when this ships" there
  // told search engines that live tools had not shipped. A failed status
  // check gets a retry, not a notify button.
  if (phase !== "ready")
    return <WorkerStatusPending phase={phase} onRetry={onRetry} />;
  const detail =
    status?.daemon.detail ?? "The secure worker is not drainable here.";

  return (
    <div className="border-line bg-wash flex flex-col gap-3 rounded-[4px] border p-4">
      <p className="text-muted text-sm leading-relaxed">{detail}</p>
      <p className="text-muted text-xs leading-relaxed">
        No runner is shown until the worker is ready, so {toolName} never
        pretends to process input it cannot actually render.
      </p>
      <NotifyMe toolName={toolName} toolSlug={toolSlug} />
    </div>
  );
}

function HtmlRenderRunArea({ mode }: { mode: Mode }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("https://");
  const job = useWorkerJob<HtmlRenderWorkerResult>({
    tool: mode === "url" ? "webpage-to-pdf" : "html-to-pdf",
    resume: (id, controls) =>
      resumeSecurityJob(id, {
        ...controls,
        tool: mode === "url" ? "webpage-to-pdf" : "html-to-pdf",
      }),
  });
  const { busy, outcome, setOutcome, run } = job;

  const start = useCallback(async () => {
    await run(async (controls) => {
      const result =
        mode === "url"
          ? await runWorkerWebpageToPdf(url.trim(), controls)
          : file
            ? await runWorkerHtmlToPdf(
                {
                  filename: file.name,
                  bytes: new Uint8Array(await file.arrayBuffer()),
                },
                controls,
              )
            : { ok: false as const, message: "Choose an HTML file first." };
      return result;
    });
  }, [file, mode, url, run]);

  const disabled =
    busy || (mode === "html" ? !file : url.trim().length <= "https://".length);

  return (
    <div className="border-info/40 bg-info/10 flex flex-col gap-4 rounded-[4px] border p-4">
      <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job.{" "}
        {mode === "url"
          ? "Only public http(s) URLs are accepted; private/localhost targets are rejected."
          : "The uploaded HTML is stored only for the short worker lifecycle and wiped after processing."}
      </p>

      {mode === "url" ? (
        <input
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setOutcome(null);
          }}
          className="border-line text-fg placeholder:text-muted focus:border-info/40 rounded-[3px] border bg-slate-950/70 px-3 py-2 text-sm transition outline-none"
          placeholder="https://example.com"
        />
      ) : file ? (
        <div className="border-line bg-wash text-fg flex flex-wrap items-center justify-between gap-2 rounded-[3px] border px-3 py-2 text-sm">
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setOutcome(null);
            }}
            className="text-muted hover:text-fg shrink-0 text-xs font-medium transition"
          >
            Remove
          </button>
        </div>
      ) : (
        <Dropzone
          onFiles={(files) => setFile(files[0] ?? null)}
          accept="text/html,.html,.htm"
          multiple={false}
          compact
          title="Add an HTML file, or"
          hint="HTML"
        />
      )}

      <WorkerRunButton
        onClick={start}
        busy={busy}
        // `disabled` already folds in `busy`; both go through one blocked branch.
        disabled={disabled}
        busyLabel={jobBusyLabel(job.phase, "Rendering PDF…")}
        icon={FileCode}
      >
        Render PDF
      </WorkerRunButton>

      <WorkerJobStatus job={job} />
      {outcome?.ok === true && (
        <ResultCard announce="Your PDF is ready.">
          <p className="text-ok text-sm">Your PDF is ready.</p>
          <DownloadCta
            onClick={() =>
              downloadBytes(outcome.output, outcome.artifact.filename)
            }
          >
            Download {outcome.artifact.filename}
          </DownloadCta>
        </ResultCard>
      )}
    </div>
  );
}
