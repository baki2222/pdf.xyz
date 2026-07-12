"use client";

import { useEffect, useState } from "react";
import { Download, Layers, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  countFormFields,
  flattenedOutputName,
  flattenPdf,
  type FlattenResult,
} from "@/lib/pdf/flatten";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  Spinner,
  useAsyncRun,
} from "./runner-kit";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { PrivacyLine } from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

export function FlattenRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · fillable form fields flattened locally in your browser"
      handoffSlug="flatten-pdf"
      toolName="Flatten PDF"
    >
      {(pdf, reset) => <FlattenEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function FlattenEditor({ pdf, onReset }: { pdf: LoadedPdf; onReset: () => void }) {
  const { busy, error, result, run } = useAsyncRun<FlattenResult>();
  const [fieldCount, setFieldCount] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    countFormFields(pdf.bytes)
      .then((count) => {
        if (alive) setFieldCount(count);
      })
      .catch(() => {
        if (alive) setCountError("We couldn't inspect the form fields, but you can still try flattening the PDF.");
      });
    return () => {
      alive = false;
    };
  }, [pdf.bytes]);

  const onRun = () => {
    void run(() => flattenPdf(pdf.bytes));
  };

  if (result) {
    return (
      <ResultPanel
        title={result.hadForm ? "Form fields flattened" : "PDF re-saved"}
        summary={
          result.hadForm
            ? `${result.flattenedFields} form field${result.flattenedFields === 1 ? "" : "s"} flattened · ${formatBytes(result.bytes.byteLength)}`
            : `No fillable form fields found · ${formatBytes(result.bytes.byteLength)}`
        }
        onReset={onReset}
      >
        <div className="flex flex-col gap-3">
          {!result.hadForm && (
            <p className="max-w-2xl rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
              This PDF did not contain AcroForm fields to flatten. Comments,
              markup annotations, and optional-content layers are not flattened by
              this browser tool.
            </p>
          )}
          <button
            type="button"
            onClick={() => downloadBytes(result.bytes, flattenedOutputName(pdf.file.name))}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            <Download className="size-4" aria-hidden />
            Download flattened PDF
          </button>
        </div>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection title="What this flattens">
        <div className="grid gap-3 md:grid-cols-3">
          <InfoTile
            icon={ShieldCheck}
            title="Real form flattening"
            body="Fillable AcroForm fields are rendered into static page content and removed from the interactive form."
          />
          <InfoTile
            icon={Layers}
            title="Local only"
            body="The PDF is processed in your browser with pdf-lib — no upload and no server job."
          />
          <InfoTile
            icon={TriangleAlert}
            title="Honest scope"
            body="This does not flatten every comment, ink annotation, or optional-content layer. Those stay as-is."
          />
        </div>
      </RunnerSection>

      <RunnerSection title="Detected form fields">
        {fieldCount === null && !countError ? (
          <p className="inline-flex items-center gap-2 text-sm text-slate-400">
            <Spinner className="size-4" /> Inspecting PDF…
          </p>
        ) : countError ? (
          <p className="text-sm text-amber-200">{countError}</p>
        ) : fieldCount === 0 ? (
          <p className="text-sm text-amber-100/90">
            No fillable AcroForm fields were detected. You can still re-save the
            PDF, but there may be nothing interactive for this tool to flatten.
          </p>
        ) : (
          <p className="text-sm text-slate-300">
            Found {fieldCount} fillable form field{fieldCount === 1 ? "" : "s"}.
          </p>
        )}
      </RunnerSection>

      <PrivacyLine>
        Flattening happens on your device — the PDF never leaves your browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton onClick={onRun} busy={busy} busyLabel="Flattening…">
          <Layers className="size-4" aria-hidden />
          Flatten form fields
        </RunButton>
      </div>
    </div>
  );
}

function InfoTile({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof ShieldCheck;
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
