"use client";

import { useEffect, useState } from "react";
import { Download, Layers, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  DYNAMIC_XFA_MESSAGE,
  flattenDownloadName,
  flattenPdf,
  inspectForm,
  type FlattenResult,
  type FormInspection,
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
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { PrivacyLine } from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * Said before the run AND after it. Any re-save breaks a digital signature —
 * every pdf-lib tool rewrites the file — so this names the save, not
 * flattening, as the cause.
 */
export const SIGNED_PDF_WARNING =
  "This PDF is digitally signed. Saving any change to it here, including flattening, means the signature will no longer verify.";

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

export function FlattenEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const { busy, error, result, run, reset } = useAsyncRun<FlattenResult>();
  const [inspection, setInspection] = useState<FormInspection | null>(null);
  const [countError, setCountError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    inspectForm(pdf.bytes)
      .then((found) => {
        if (alive) setInspection(found);
      })
      .catch(() => {
        if (alive)
          setCountError(
            "We couldn't inspect the form fields, but you can still try flattening the PDF.",
          );
      });
    return () => {
      alive = false;
    };
  }, [pdf.bytes]);

  const onRun = () => {
    void run(() => flattenPdf(pdf.bytes));
  };

  if (result) {
    const flattened = result.flattenedFields > 0;
    const size = formatBytes(result.bytes.byteLength);
    const plural = (n: number) => (n === 1 ? "" : "s");
    return (
      <ResultPanel
        title={flattened ? "Form fields flattened" : "PDF re-saved"}
        tone={flattened ? "ok" : "neutral"}
        summary={
          !result.hadForm
            ? `No fillable form fields found · ${size}`
            : result.flattenedFields === result.totalFields
              ? `${result.flattenedFields} form field${plural(result.flattenedFields)} flattened · ${size}`
              : `Flattened ${result.flattenedFields} of ${result.totalFields} form field${plural(result.totalFields)} · ${size}`
        }
        onReset={onReset}
        output={outputFile(
          result.bytes,
          flattenDownloadName(pdf.file.name, result),
        )}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        <div className="flex flex-col gap-3">
          {!result.hadForm && (
            <p className="border-warn/40 bg-warn/10 text-warn rounded-panel max-w-2xl border px-4 py-3 text-sm">
              This PDF did not contain AcroForm fields to flatten, so nothing in
              it was flattened. Comments, markup annotations, and
              optional-content layers are not flattened by this browser tool.
            </p>
          )}
          {result.skipped.length > 0 && (
            <div className="border-line bg-wash rounded-panel max-w-2xl border px-4 py-3 text-sm">
              <p className="text-fg font-medium">
                Left as-is, still interactive:
              </p>
              <ul className="text-muted mt-1 list-disc pl-5">
                {result.skipped.map((skip, index) => (
                  // Field names repeat in malformed forms; the index keeps
                  // every row distinct.
                  <li key={`${index}:${skip.name}`}>
                    {skip.name} ({skip.reason})
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.droppedXfa && (
            <p className="text-muted max-w-2xl text-sm">
              This form also carried an XFA layer. It was removed; the download
              holds the flattened AcroForm.
            </p>
          )}
          {result.signed && (
            <p className="text-warn max-w-2xl text-sm">{SIGNED_PDF_WARNING}</p>
          )}
          <button
            type="button"
            onClick={() =>
              downloadBytes(
                result.bytes,
                flattenDownloadName(pdf.file.name, result),
              )
            }
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            <Download className="size-4" aria-hidden />
            {flattened ? "Download flattened PDF" : "Download PDF"}
          </button>
        </div>
      </ResultPanel>
    );
  }

  const fillable = inspection
    ? inspection.fields - inspection.signatureFields
    : null;
  const blocked = inspection?.dynamicXfa === true;

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
            body="This does not flatten comments, ink annotations, optional-content layers, or signature fields. Those stay as-is."
          />
        </div>
      </RunnerSection>

      <RunnerSection title="Detected form fields">
        {inspection === null && !countError ? (
          <p className="text-muted inline-flex items-center gap-2 text-sm">
            <Spinner className="size-4" /> Inspecting PDF…
          </p>
        ) : countError || !inspection ? (
          <p className="text-warn text-sm">{countError}</p>
        ) : blocked ? (
          <p className="text-warn text-sm">{DYNAMIC_XFA_MESSAGE}</p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            {fillable === 0 ? (
              <p className="text-warn">
                No fillable AcroForm fields were detected, so there is nothing
                for this tool to flatten. You can still re-save the PDF, but its
                content will not change.
              </p>
            ) : (
              <p className="text-muted">
                Found {fillable} fillable form field{fillable === 1 ? "" : "s"}.
              </p>
            )}
            {inspection.signatureFields > 0 && (
              <p className="text-muted">
                {inspection.signatureFields} signature field
                {inspection.signatureFields === 1 ? "" : "s"} will be left
                as-is.
              </p>
            )}
            {inspection.xfa && (
              <p className="text-muted">
                This form also carries an XFA layer, which will be removed. Its
                AcroForm fields are what get flattened.
              </p>
            )}
            {inspection.signed && (
              <p className="text-warn">{SIGNED_PDF_WARNING}</p>
            )}
          </div>
        )}
      </RunnerSection>

      <PrivacyLine>
        Flattening happens on your device — the PDF never leaves your browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton
            onClick={onRun}
            busy={busy}
            disabled={blocked}
            busyLabel={fillable === 0 ? "Saving…" : "Flattening…"}
          >
            <Layers className="size-4" aria-hidden />
            {fillable === 0 ? "Re-save PDF" : "Flatten form fields"}
          </RunButton>
        </div>
      </RunBar>
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
    <div className="border-line bg-wash rounded-panel border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
