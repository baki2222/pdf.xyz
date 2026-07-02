"use client";

import { useCallback, useEffect, useState } from "react";
import { Cpu, FileText, Languages, Loader2, ScanLine } from "lucide-react";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  RecoverableError,
  StatusBadge,
  type StatusTone,
} from "@/components/status/status-ui";

/**
 * OCR-specific capability panel for the `ocr-pdf` tool page. It sits alongside the
 * generic secure-worker flow preview and does one honest job the generic preview
 * can't: it makes crystal clear that OCR is NOT a browser trick — turning a scan
 * into real, selectable text needs a trained recognition engine (OCRmyPDF /
 * Tesseract) on a secure worker — and it reads the live `/api/worker/status`
 * endpoint so that, in a local-dev environment, it states whether a native OCR
 * engine is actually installed. It never offers a run it can't honor and never
 * uploads anything on its own.
 */

type Phase = "loading" | "ready" | "error";

interface Availability {
  tone: StatusTone;
  label: string;
  detail: string;
}

/** Turn the live status into an honest OCR availability line + badge. */
function ocrAvailability(status: WorkerStatus): Availability {
  if (status.mode === "local-dev") {
    if (status.ocr.pdf) {
      const engine = status.ocr.engines[0] ?? "OCRmyPDF";
      return {
        tone: "ok",
        label: "OCR ready (local-dev)",
        detail: `A native OCR engine (${engine}) is installed on this machine, so searchable-PDF and text OCR run on the local-dev worker — your file is processed here, not sent to any third party.`,
      };
    }
    if (status.ocr.image) {
      return {
        tone: "warn",
        label: "Image OCR only",
        detail:
          "Only Tesseract is installed, so JPG/PNG OCR can run — but OCR of PDF documents needs OCRmyPDF. Install it to enable PDF OCR.",
      };
    }
    return {
      tone: "warn",
      label: "No OCR engine",
      detail:
        "The local-dev worker is enabled, but no native OCR engine (OCRmyPDF or Tesseract) is installed here, so OCR can't run. Install OCRmyPDF to enable it — nothing is faked in the meantime.",
    };
  }

  if (status.mode === "remote-configured") {
    return {
      tone: "info",
      label: "Configured",
      detail:
        "A worker backend is configured, but this build ships no OCR pipeline yet. Nothing is uploaded.",
    };
  }

  return {
    tone: "muted",
    label: "Not enabled",
    detail:
      "OCR runs on a secure worker with a native OCR engine — it isn't enabled in this environment, so nothing is uploaded here.",
  };
}

const CAPABILITY_CHIPS: { icon: typeof Cpu; label: string }[] = [
  { icon: FileText, label: "Searchable PDF or text sidecar" },
  { icon: Languages, label: "Multi-language recognition" },
  { icon: ScanLine, label: "Deskew · auto-rotate · clean · page ranges" },
];

export function OcrPreview() {
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
      })
      .catch(() => {
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  const availability = status ? ocrAvailability(status) : null;

  return (
    <div className="gradient-border">
      <div className="glass flex flex-col gap-5 rounded-3xl p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/30 bg-blue-400/10 px-2.5 py-1 text-[11px] font-medium text-blue-200">
              <Cpu className="size-3" aria-hidden />
              Native OCR
            </span>
            {availability && (
              <StatusBadge
                tone={availability.tone}
                label={availability.label}
                pulse={availability.tone === "ok"}
              />
            )}
          </div>
          <h2 className="text-lg font-semibold text-white">
            OCR isn&apos;t a browser trick
          </h2>
          <p className="text-sm leading-relaxed text-slate-400">
            Turning a scanned page into real, selectable text needs a trained
            recognition engine (OCRmyPDF / Tesseract) running on a secure worker —
            it can&apos;t be faked in your browser, so we don&apos;t pretend to. Your
            file is only uploaded when you run OCR, then processed in isolation and
            auto-deleted.
          </p>
        </div>

        <ul className="flex flex-col gap-2">
          {CAPABILITY_CHIPS.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="flex items-center gap-2.5 text-sm text-slate-300"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300">
                <Icon className="size-3.5" aria-hidden />
              </span>
              {label}
            </li>
          ))}
        </ul>

        <div className="rounded-2xl border border-white/10 bg-surface-2 p-4">
          {phase === "loading" && (
            <p
              className="inline-flex items-center gap-2 text-xs text-slate-400"
              role="status"
            >
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Checking whether an OCR engine is available…
            </p>
          )}

          {phase === "error" && (
            <RecoverableError
              title="Couldn't check OCR availability"
              message="We couldn't reach the worker status endpoint just now. This page never uploads your file on its own."
              onRetry={retry}
              retryLabel="Retry"
            />
          )}

          {phase === "ready" && availability && (
            <p className="text-xs leading-relaxed text-slate-400">
              {availability.detail}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
