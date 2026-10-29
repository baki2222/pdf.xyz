"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Database,
  Loader2,
  RefreshCw,
  ScanText,
  Server,
  Sparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { WorkerStatus } from "@/lib/workers/status";
import { describeOcrLanguage } from "@/lib/jobs/ocr";
import { track } from "@/lib/telemetry/track";
import { canRunPdfSecurity } from "@/lib/workers/pdf-security-client";
import { canRunAiTool } from "@/lib/workers/ai-tool-availability";
import type { ProcessingMode } from "@/lib/tools/types";
import { ModeShape } from "@/components/tools/processing-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AssuranceNote,
  StatusBadge,
  StatusCard,
  RecoverableError,
  type StatusTone,
} from "./status-ui";

/** A live tool the browser can run entirely on-device (name + route slug). */
export interface LocalToolRef {
  slug: string;
  name: string;
}

type Phase = "loading" | "ready" | "error";

/**
 * The card's single verdict, derived from the observed pipeline summary and
 * only from it — never from the web process's in-process facet (`mode`/
 * `enabled`), which is what let a "Not enabled" headline sit above rows
 * reporting a live worker. Local-dev is the one deliberate exception: a
 * dev-only in-process mode, labeled as exactly that.
 */
function workerBadge(status: WorkerStatus): {
  tone: StatusTone;
  label: string;
  pulse: boolean;
} {
  if (status.mode === "local-dev") {
    return { tone: "warn", label: "Local-dev worker", pulse: true };
  }
  switch (status.pipeline.verdict) {
    case "live":
      return { tone: "ok", label: "Live", pulse: true };
    case "configured":
      return { tone: "info", label: "Configured", pulse: false };
    default:
      return { tone: "muted", label: "Not enabled", pulse: false };
  }
}

/**
 * One provider in the production pipeline (object storage, job queue, or the
 * processor). Presence-only: `ready` when it can serve requests now, `configured`
 * when the infrastructure is present but this build ships no client, otherwise
 * not wired. The `detail` never names a variable or a value.
 */
function ProviderRow({
  icon: Icon,
  label,
  ready,
  configured,
  detail,
  readyLabel = "Ready",
}: {
  icon: LucideIcon;
  label: string;
  ready: boolean;
  configured: boolean;
  detail: string;
  /** Badge shown when `ready` (default "Ready"); the daemon uses "Drainable" so
   *  it never implies a worker is actually running. */
  readyLabel?: string;
}) {
  const tone: StatusTone = ready ? "ok" : configured ? "info" : "muted";
  const badge = ready
    ? readyLabel
    : configured
      ? "Configured"
      : "Not configured";
  return (
    <div className="border-line bg-wash rounded-ctl flex flex-col gap-1.5 border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-fg inline-flex items-center gap-1.5 text-xs font-medium">
          <Icon className="text-faint size-3.5" aria-hidden />
          {label}
        </span>
        <StatusBadge tone={tone} label={badge} />
      </div>
      <p className="text-muted text-xs leading-relaxed">{detail}</p>
    </div>
  );
}

/** What the page says overall, from the same answers the cards give. */
type Overall = "loading" | "error" | "working" | "partial";

/**
 * The three verdicts a visitor reads, each the answer the TOOL PAGES give for
 * the same status: `canRunPdfSecurity` is every secure-server panel's base
 * predicate, `ocr.available` the OCR panel's, `canRunAiTool` the four AI
 * panels'. Never this page's own idea of "up" — `system-status.plain.test.tsx`
 * holds the cards to those predicates over statuses built by the real
 * derivation.
 */
function verdicts(status: WorkerStatus) {
  const server = canRunPdfSecurity(status);
  const ocr = status.ocr.available;
  const ai = canRunAiTool(status);
  return { server, ocr, ai, all: server && ocr && ai };
}

const OVERALL_COPY: Record<
  Overall,
  { title: string; line: string; tone: StatusTone; icon: LucideIcon }
> = {
  loading: {
    title: "Checking our tools…",
    line: "Tools that run in your browser work either way.",
    tone: "info",
    icon: Loader2,
  },
  error: {
    title: "We couldn’t check our server just now",
    line: "Tools that run in your browser are not affected.",
    tone: "muted",
    icon: AlertTriangle,
  },
  working: {
    title: "All systems working",
    line: "Every tool is available right now.",
    tone: "ok",
    icon: CheckCircle2,
  },
  partial: {
    title: "Some tools are offline",
    line: "Tools that run in your browser still work. The cards below say which tools are offline.",
    tone: "warn",
    icon: AlertTriangle,
  },
};

/** The overall box's border and wash, per tone; the text stays `text-fg`. */
const OVERALL_BOX: Record<StatusTone, string> = {
  ok: "border-ok/40 bg-ok/10",
  warn: "border-warn/40 bg-warn/10",
  danger: "border-err/40 bg-err/10",
  info: "border-info/40 bg-info/10",
  muted: "border-line bg-wash",
};

const OVERALL_ICON_INK: Record<StatusTone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-err",
  info: "text-info",
  muted: "text-muted",
};

/** A card's badge: the plain word for what it found. */
function verdictBadge(phase: Phase, ok: boolean | null) {
  if (phase === "loading")
    return <StatusBadge tone="info" label="Checking…" pulse />;
  if (phase === "error" || ok === null)
    return <StatusBadge tone="muted" label="Unknown" />;
  return ok ? (
    <StatusBadge tone="ok" label="Available" />
  ) : (
    <StatusBadge tone="warn" label="Offline" />
  );
}

/** One of the three plain cards: where the tools run, in the tool cards' words. */
function PlainCard({
  id,
  mode,
  title,
  verdict,
  badge,
  children,
}: {
  id: string;
  mode: ProcessingMode;
  title: string;
  verdict: string;
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      data-status-card={id}
      data-verdict={verdict}
      aria-labelledby={`status-card-${id}`}
      className="bg-panel border-line rounded-panel flex flex-col gap-3 border p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id={`status-card-${id}`}
          className="text-fg inline-flex items-center gap-2 text-base font-semibold"
        >
          <ModeShape mode={mode} className="size-2.5" />
          {title}
        </h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

/** A disclosure button and the region it opens (`hidden`, never unmounted). */
function Disclosure({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
        className="text-muted hover:text-fg inline-flex h-11 items-center gap-1.5 self-start text-sm font-medium underline-offset-4 transition hover:underline"
      >
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
          aria-hidden
        />
        {label}
      </button>
      <div id={id} hidden={!open} className="flex flex-col gap-4">
        {children}
      </div>
    </div>
  );
}

/**
 * The AI row's words in technical details. `status.ai.detail` names the
 * model ("…the openai provider (model gpt-5.6-luna)"), which nothing on this
 * page needs and no guard asked for — so a declared provider is described
 * without it, and only the not-declared and invalid-configuration details
 * (which name no model) pass through. `/api/worker/status` still serves it.
 */
function aiTechnicalDetail(status: WorkerStatus): string {
  if (!status.ai.ready) return status.ai.detail;
  return status.ai.configuredHere
    ? "An AI provider is declared for this deployment and configured in this process."
    : "An AI provider is declared for this deployment. The AI tools run on the secure worker, which holds the API key; whether that key is present is not observable from here, and a job without it fails instead of returning a made-up answer.";
}

/**
 * What pdf.xyz can do right now, for a VISITOR (owner, 2026-10-23): one
 * overall line, three plain cards — tools in your browser, on our secure
 * server, AI — with the OCR languages as a list, and every operator's row
 * (the pipeline, storage, queue, processor, daemon, and the operations
 * snapshot passed in as `operations`) one press away under "Technical
 * details". `children` sit between the cards and that press.
 *
 * WAS an operator's dashboard on the first screen: "liveness heartbeat",
 * "out-of-band secure worker", "Worker daemon · Drainable", the AI
 * provider's model name.
 *
 * The status is read live from `/api/worker/status` — the same
 * presence-only view the tool pages use. Reading it emits a privacy-safe
 * `worker_status_checked` event (mode + enabled flag only). A fetch failure
 * is recoverable, not a dead end.
 */
export function SystemStatus({
  localTools,
  operations,
  children,
}: {
  localTools: LocalToolRef[];
  /** The operator's snapshot, drawn inside "Technical details". */
  operations?: ReactNode;
  children?: ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    setPhase("loading");
    setNonce((n) => n + 1);
  }, []);

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
  }, [nonce]);

  const known = phase === "ready" && status ? verdicts(status) : null;
  const overall: Overall =
    phase === "loading"
      ? "loading"
      : !known
        ? "error"
        : known.all
          ? "working"
          : "partial";
  const copy = OVERALL_COPY[overall];
  const OverallIcon = copy.icon;
  const badge = status ? workerBadge(status) : null;
  const ocrLanguages =
    phase === "ready" &&
    status?.ocr.available &&
    status.ocr.languages.length > 0
      ? status.ocr.languages.map(describeOcrLanguage)
      : [];
  const verdictWord = (ok: boolean | undefined) =>
    phase === "loading"
      ? "checking"
      : ok === undefined
        ? "unknown"
        : ok
          ? "available"
          : "offline";

  return (
    <div className="flex flex-col gap-6">
      <div
        role="status"
        data-overall={overall}
        className={cn(
          "rounded-panel flex items-start gap-3 border p-4 sm:p-5",
          OVERALL_BOX[copy.tone],
        )}
      >
        <OverallIcon
          className={cn(
            "mt-0.5 size-5 shrink-0",
            OVERALL_ICON_INK[copy.tone],
            overall === "loading" && "animate-spin",
          )}
          aria-hidden
        />
        <div className="flex flex-col gap-1">
          <p className="text-fg text-lg font-semibold">{copy.title}</p>
          <p className="text-muted text-sm leading-relaxed">{copy.line}</p>
          {overall === "error" && (
            <button
              type="button"
              onClick={retry}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "mt-2 self-start",
              )}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Retry
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <PlainCard
          id="browser"
          mode="client"
          title="Tools that run in your browser"
          verdict="available"
          badge={<StatusBadge tone="ok" label="Available" />}
        >
          <p className="text-muted text-sm leading-relaxed">
            {localTools.length} tool{localTools.length === 1 ? "" : "s"} work
            right on your device. Your files never leave it.
          </p>
          {localTools.length > 0 && (
            <Disclosure label={`See all ${localTools.length}`}>
              <ul
                className="flex flex-wrap gap-1.5"
                aria-label="In-browser tools"
              >
                {localTools.map((tool) => (
                  <li
                    key={tool.slug}
                    className="border-line bg-wash text-fg rounded-tag border px-2.5 py-1 text-xs"
                  >
                    {tool.name}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </PlainCard>

        <PlainCard
          id="server"
          mode="server"
          title="Tools on our secure server"
          verdict={verdictWord(known?.server)}
          badge={verdictBadge(phase, known ? known.server : null)}
        >
          <p className="text-muted text-sm leading-relaxed">
            {known && !known.server
              ? "These tools are offline right now. Try again later."
              : "Office files, PDF/A, passwords and other heavy jobs. Your file is uploaded, processed, then deleted."}
          </p>
          <div className="border-line flex flex-col gap-2 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-fg inline-flex items-center gap-1.5 text-sm font-medium">
                <ScanText className="text-muted size-4" aria-hidden />
                Text recognition (OCR)
              </span>
              {verdictBadge(phase, known ? known.ocr : null)}
            </div>
            {ocrLanguages.length > 0 && (
              <ul
                aria-label="OCR languages"
                className="text-muted flex flex-wrap gap-x-3 gap-y-1 text-sm"
              >
                {ocrLanguages.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            )}
          </div>
        </PlainCard>

        <PlainCard
          id="ai"
          mode="ai"
          title="AI tools"
          verdict={verdictWord(known?.ai)}
          badge={verdictBadge(phase, known ? known.ai : null)}
        >
          <p className="text-muted text-sm leading-relaxed">
            {known && !known.ai
              ? "AI tools are offline right now. Try again later."
              : "Summarize, translate, chat with a PDF, and pull out data. These run on our secure server too."}
          </p>
        </PlainCard>
      </div>

      <AssuranceNote tone="privacy">
        pdf.xyz is browser-first: whenever a tool can run on your device, it
        does, and nothing is uploaded. A secure worker is only ever used for
        work the browser genuinely can&apos;t do — and only after it&apos;s
        clearly labeled.
      </AssuranceNote>

      {children}

      <Disclosure
        label="Technical details"
        className="border-line border-t pt-6"
      >
        {/* The operator's rows, unchanged in substance: the secure-worker
            card (one verdict, `system-status.consistency.test.tsx`) and the
            operations snapshot. */}
        <StatusCard
          title="Secure worker"
          icon={Cpu}
          badge={
            badge ? (
              <StatusBadge
                tone={badge.tone}
                label={badge.label}
                pulse={badge.pulse}
              />
            ) : undefined
          }
        >
          {phase === "loading" && (
            <p className="text-muted inline-flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Checking worker availability…
            </p>
          )}

          {phase === "error" && (
            <RecoverableError
              title="Couldn't reach the status endpoint"
              message="We couldn't confirm secure-worker availability just now. In-browser tools above are unaffected."
              onRetry={retry}
              retryLabel="Retry"
            />
          )}

          {phase === "ready" && status && (
            <div className="flex flex-col gap-3">
              {/* The lead and the badge share one source — the observed
                  pipeline summary — so this paragraph can never again deny
                  what a row below asserts. Local-dev keeps its in-process
                  detail: that string is about THIS machine, and it is true. */}
              <p className="text-muted text-sm leading-relaxed">
                {status.mode === "local-dev"
                  ? status.detail
                  : status.pipeline.detail}
              </p>
              <div className="border-line bg-wash rounded-ctl flex flex-col gap-1.5 border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg inline-flex items-center gap-1.5 text-xs font-medium">
                    <ScanText className="text-faint size-3.5" aria-hidden />
                    OCR
                  </span>
                  <StatusBadge
                    tone={status.ocr.available ? "ok" : "muted"}
                    label={status.ocr.available ? "Available" : "Not enabled"}
                  />
                </div>
                <p className="text-muted text-xs leading-relaxed">
                  {status.ocr.detail}
                </p>
                {/* The list the detail refers to ("The languages listed are
                    the recognition packs that worker actually has installed").
                    Until 2026-09-27 the sentence rendered and the list did not. */}
                {ocrLanguages.length > 0 && (
                  <p className="text-muted text-xs leading-relaxed">
                    <span className="text-fg font-medium">Languages:</span>{" "}
                    {ocrLanguages.join(", ")}
                  </p>
                )}
              </div>

              {/* AI reports its own readiness rather than being implied by the
                  worker's — without the model's name (`aiTechnicalDetail`). */}
              <div className="border-line bg-wash rounded-ctl flex flex-col gap-1.5 border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg inline-flex items-center gap-1.5 text-xs font-medium">
                    <Sparkles className="text-faint size-3.5" aria-hidden />
                    AI tools
                  </span>
                  <StatusBadge
                    tone={status.ai.ready ? "ok" : "muted"}
                    label={status.ai.ready ? "Declared" : "Not enabled"}
                  />
                </div>
                <p className="text-muted text-xs leading-relaxed">
                  {aiTechnicalDetail(status)}
                </p>
              </div>

              {/* The production pipeline, piece by piece: signed upload → queued
                  job → worker processing → signed download → deletion. */}
              <div className="flex flex-col gap-1.5">
                <span className="text-faint kicker">Production pipeline</span>
                <ProviderRow
                  icon={Database}
                  label="Object storage"
                  ready={status.providers.storage.ready}
                  configured={status.providers.storage.configured}
                  detail={status.providers.storage.detail}
                />
                <ProviderRow
                  icon={Workflow}
                  label="Job queue"
                  ready={status.providers.queue.ready}
                  configured={status.providers.queue.configured}
                  detail={status.providers.queue.detail}
                />
                <ProviderRow
                  icon={Server}
                  label="Processor"
                  ready={status.providers.processor.ready}
                  configured={status.providers.processor.configured}
                  detail={status.providers.processor.detail}
                />
                {/* "Drainable" means a separately deployed worker COULD claim +
                    run jobs here — never that one is actually running. */}
                <ProviderRow
                  icon={Cpu}
                  label="Worker daemon"
                  ready={status.daemon.drainable}
                  configured={
                    status.daemon.queueConfigured ||
                    status.daemon.storageConfigured
                  }
                  detail={status.daemon.detail}
                  readyLabel="Drainable"
                />
              </div>
            </div>
          )}
        </StatusCard>
        {operations}
      </Disclosure>
    </div>
  );
}
