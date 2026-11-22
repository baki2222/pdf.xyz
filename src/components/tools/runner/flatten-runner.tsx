"use client";

import dynamic from "next/dynamic";
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
import {
  FileHeader,
  SinglePdfRunner,
  type SinglePdfBatch,
} from "./single-pdf-runner";
import { CheckboxField, PrivacyLine } from "./stamp-controls";
import {
  FLATTEN_MARKUP_HINT,
  FLATTEN_MARKUP_LABEL,
  markupCount,
} from "./flatten-markup-copy";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * Said before the run AND after it. Any re-save breaks a digital signature —
 * every pdf-lib tool rewrites the file — so this names the save, not
 * flattening, as the cause.
 */
export const SIGNED_PDF_WARNING =
  "This PDF is digitally signed. Saving any change to it here, including flattening, means the signature will no longer verify.";

/**
 * Two or more PDFs: the batch (batch plan P1), its own chunk, fetched only
 * when they arrive — never with a visit to this page.
 */
const FlattenBatch = dynamic(
  () => import("./batch/flatten-batch").then((m) => m.FlattenBatch),
  {
    loading: () => (
      <div
        aria-hidden
        className="border-line bg-wash rounded-panel h-40 w-full border"
      />
    ),
  },
);
const batch = (props: SinglePdfBatch) => <FlattenBatch {...props} />;

export function FlattenRunner() {
  return (
    <SinglePdfRunner
      hint="One or more PDFs · fillable form fields flattened locally in your browser"
      batch={batch}
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
  // Off by default (audit flatten-pdf#3): fields only, as the page has
  // always said; ticked, comments and markup are drawn in too.
  const [markup, setMarkup] = useState(false);

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
    void run(() => flattenPdf(pdf.bytes, { annotations: markup }));
  };

  if (result) {
    const flattened =
      result.flattenedFields > 0 || result.flattenedAnnotations > 0;
    const markupDone =
      result.flattenedAnnotations > 0
        ? ` · ${markupCount(result.flattenedAnnotations)} flattened`
        : "";
    const leftAsIs = [...result.skipped, ...result.annotationsLeft];
    const size = formatBytes(result.bytes.byteLength);
    const plural = (n: number) => (n === 1 ? "" : "s");
    return (
      <ResultPanel
        title={
          result.flattenedAnnotations > 0
            ? "Flattened"
            : flattened
              ? "Form fields flattened"
              : "PDF re-saved"
        }
        tone={flattened ? "ok" : "neutral"}
        summary={
          !result.hadForm
            ? `No fillable form fields found${markupDone} · ${size}`
            : result.flattenedFields === result.totalFields
              ? `${result.flattenedFields} form field${plural(result.flattenedFields)} flattened${markupDone} · ${size}`
              : `Flattened ${result.flattenedFields} of ${result.totalFields} form field${plural(result.totalFields)}${markupDone} · ${size}`
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
          {!flattened && (
            <p className="border-warn/40 bg-warn/10 text-warn rounded-panel max-w-2xl border px-4 py-3 text-sm">
              {result.hadForm
                ? "None of this PDF's form fields could be flattened, so nothing in it was flattened."
                : "This PDF did not contain AcroForm fields to flatten, so nothing in it was flattened."}{" "}
              {result.annotationsLeft.length > 0 || markup
                ? "Optional-content layers are not flattened by this browser tool."
                : `Optional-content layers are not flattened by this browser tool, and comments and markup are flattened only when "${FLATTEN_MARKUP_LABEL}" is ticked.`}
            </p>
          )}
          {leftAsIs.length > 0 && (
            <div className="border-line bg-wash rounded-panel max-w-2xl border px-4 py-3 text-sm">
              <p className="text-fg font-medium">
                Left as-is, still interactive:
              </p>
              <ul className="text-muted mt-1 list-disc pl-5">
                {leftAsIs.map((skip, index) => (
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
  // Nothing this run would draw: no fields, and no markup it was asked for.
  const resaveOnly =
    fillable === 0 && !(markup && (inspection?.annotations ?? 0) > 0);

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
            body={`Optional-content layers and signature fields stay as-is. Comments, highlights, ink and stamps stay too, unless "${FLATTEN_MARKUP_LABEL}" is ticked; links always stay clickable.`}
          />
        </div>
      </RunnerSection>

      <RunnerSection title="Detected form fields">
        {inspection === null && !countError ? (
          <p className="text-muted inline-flex items-center gap-2 text-sm">
            <Spinner /> Inspecting PDF…
          </p>
        ) : countError || !inspection ? (
          <p className="text-warn text-sm">{countError}</p>
        ) : blocked ? (
          <p className="text-warn text-sm">{DYNAMIC_XFA_MESSAGE}</p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            {fillable === 0 && inspection.annotations > 0 ? (
              <p className="text-warn">
                No fillable AcroForm fields were detected. Tick &ldquo;
                {FLATTEN_MARKUP_LABEL}&rdquo; to draw the comments and markup
                into the page; otherwise the PDF is only re-saved and its
                content will not change.
              </p>
            ) : fillable === 0 ? (
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
            {inspection.annotations > 0 && (
              <p className="text-muted">
                Found {markupCount(inspection.annotations)}.
              </p>
            )}
          </div>
        )}
      </RunnerSection>

      <CheckboxField
        label="Also flatten comments and markup"
        checked={markup}
        onChange={setMarkup}
        hint={FLATTEN_MARKUP_HINT}
      />

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
            busyLabel={resaveOnly ? "Saving…" : "Flattening…"}
          >
            <Layers className="size-4" aria-hidden />
            {resaveOnly
              ? "Re-save PDF"
              : markup && (inspection?.annotations ?? 0) > 0
                ? fillable === 0
                  ? "Flatten comments and markup"
                  : "Flatten fields and markup"
                : "Flatten form fields"}
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
