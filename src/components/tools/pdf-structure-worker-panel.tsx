"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileDown,
  FileUp,
  ShieldCheck,
  Timer,
  Wrench,
  Zap,
} from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  canRunPdfStructure,
  runWorkerOptimizeWeb,
  runWorkerRepairPdf,
  type PdfStructureWorkerResult,
} from "@/lib/workers/pdf-structure-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { track } from "@/lib/telemetry/track";
import type { Tool } from "@/lib/tools/types";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import {
  DownloadCta,
  Dropzone,
  ErrorNote,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";
import { RepairWarnings } from "./repair-warnings";

type Phase = "loading" | "error" | "ready";
type Mode = "repair" | "optimize";

function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading")
    return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status)
    return { tone: "muted", label: "Status unknown", pulse: false };
  if (canRunPdfStructure(status)) {
    return status.mode === "local-dev"
      ? { tone: "warn", label: "Local-dev worker", pulse: true }
      : { tone: "ok", label: "Secure worker", pulse: false };
  }
  return { tone: "muted", label: "Not enabled", pulse: false };
}

function SpecRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileUp;
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

const COPY: Record<
  Mode,
  {
    icon: typeof Wrench;
    badge: string;
    blurb: string;
    cta: string;
    running: string;
    done: string;
  }
> = {
  repair: {
    icon: Wrench,
    badge: "Secure-worker repair",
    blurb:
      "Repair rewrites the PDF through qpdf's parser/writer on an isolated secure worker, recovering readable structure when possible. It never fabricates pages or content: if qpdf cannot produce a valid PDF, the job fails honestly.",
    cta: "Repair on the worker",
    running: "Repairing on the worker…",
    done: "Your repaired PDF is ready.",
  },
  optimize: {
    icon: Zap,
    badge: "Fast-web optimization",
    blurb:
      "Optimize for Web linearizes the PDF with qpdf so browsers can start rendering before the whole file downloads. The worker produces a real fast-web-view PDF or fails honestly.",
    cta: "Optimize on the worker",
    running: "Optimizing on the worker…",
    done: "Your web-optimized PDF is ready.",
  },
};

export function PdfStructureWorkerPanel({ tool }: { tool: Tool }) {
  const mode: Mode = tool.slug === "repair-pdf" ? "repair" : "optimize";
  const copy = COPY[mode];
  const HeaderIcon = copy.icon;
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<WorkerStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/worker/status", { headers: { accept: "application/json" } })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<WorkerStatus>)
          : Promise.reject(new Error("unreachable")),
      )
      .then((s) => {
        if (!active) return;
        setStatus(s);
        setPhase("ready");
        track({
          name: "worker_status_checked",
          mode: s.mode,
          enabled: s.enabled,
        });
      })
      .catch(() => {
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunPdfStructure(status);

  return (
    <div className="">
      <div className="border-line bg-panel flex flex-col gap-6 rounded-[4px] border p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="border-info/40 bg-info/10 text-info inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
              <HeaderIcon className="size-3" aria-hidden />
              {copy.badge}
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
          <p className="text-muted text-sm leading-relaxed">{copy.blurb}</p>
        </div>

        {available && status ? (
          <StructureRunArea mode={mode} localDevOnly={status.localDevOnly} />
        ) : (
          <StructureUnavailable
            phase={phase}
            status={status}
            toolName={tool.name}
            toolSlug={tool.slug}
          />
        )}

        <div className="flex flex-col gap-3">
          <h3 className="text-faint font-mono text-xs font-medium tracking-[0.18em] uppercase">
            What happens to your file
          </h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status ? status.scan.active : null, tool).map(
              (stage, i, all) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <div className="flex flex-col items-center self-stretch">
                    <span className="border-line bg-wash text-muted grid size-8 shrink-0 place-items-center rounded-full border">
                      {stage.id === "process" ? (
                        <HeaderIcon className="size-4" aria-hidden />
                      ) : (
                        <FileUp className="size-4" aria-hidden />
                      )}
                    </span>
                    {i < all.length - 1 && (
                      <span className="bg-wash my-1 w-px flex-1" aria-hidden />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 pb-3">
                    <span className="text-fg text-sm font-medium">
                      {i + 1}. {stage.title}
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
          <SpecRow icon={FileUp} label="Input" value="One PDF" />
          <SpecRow icon={FileDown} label="Output" value="PDF" />
          <SpecRow
            icon={Timer}
            label="Retention"
            value={`Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`}
          />
          <SpecRow
            icon={ShieldCheck}
            label="Limit"
            value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file`}
          />
        </div>
      </div>
    </div>
  );
}

function StructureUnavailable({
  phase,
  status,
  toolName,
  toolSlug,
}: {
  phase: Phase;
  status: WorkerStatus | null;
  toolName: string;
  toolSlug: string;
}) {
  const detail =
    phase === "loading"
      ? "Checking whether a secure worker is available…"
      : phase === "error"
        ? "The worker status endpoint could not be reached right now."
        : (status?.security.detail ??
          "This qpdf-backed worker path is not enabled here.");
  return (
    <div className="border-line bg-wash flex flex-col gap-3 rounded-[4px] border p-4">
      <p className="text-muted text-sm leading-relaxed">{detail}</p>
      <p className="text-muted text-xs leading-relaxed">
        No uploader is shown until the worker is ready, so {toolName} never
        pretends to process a file it cannot actually run.
      </p>
      <NotifyMe toolName={toolName} toolSlug={toolSlug} />
    </div>
  );
}

function StructureRunArea({
  mode,
  localDevOnly,
}: {
  mode: Mode;
  localDevOnly: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PdfStructureWorkerResult | null>(null);
  const copy = COPY[mode];

  const start = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    try {
      setOutcome(null);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result =
        mode === "repair"
          ? await runWorkerRepairPdf({ filename: file.name, bytes })
          : await runWorkerOptimizeWeb({ filename: file.name, bytes });
      setOutcome(result);
    } catch {
      // A rejected fetch — offline, DNS failure, a reset connection, CORS — or a
      // file that could not be read. None of these produce a response to inspect,
      // so there is nothing honest to say beyond what happened.
      setOutcome({
        ok: false,
        message:
          "Lost the connection before the job finished. Check your network and try again.",
      });
    } finally {
      setBusy(false);
    }
  }, [file, mode]);

  return (
    <div className="border-info/40 bg-info/10 flex flex-col gap-4 rounded-[4px] border p-4">
      <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {localDevOnly
          ? "This runs on your local-dev worker on this machine."
          : "Running this uploads your file to the encrypted secure worker, processes it with qpdf, and wipes the input after processing."}
      </p>

      {file ? (
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
          accept="application/pdf"
          multiple={false}
          compact
          title="Add a PDF, or"
          hint="PDF"
        />
      )}

      <WorkerRunButton
        onClick={start}
        busy={busy}
        disabled={!file}
        busyLabel={copy.running}
        icon={copy.icon}
      >
        {copy.cta}
      </WorkerRunButton>

      {outcome?.ok === false && <ErrorNote message={outcome.message} />}
      {outcome?.ok === true && (
        <ResultCard announce={copy.done}>
          {/* Before the download button: a user who clicks and leaves is
              exactly the user this is for. */}
          <RepairWarnings job={outcome.job} />
          <p className="text-ok text-sm">{copy.done}</p>
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
