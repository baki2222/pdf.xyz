"use client";

import { useEffect, useId, useState } from "react";
import { Download, Eraser, Tags } from "lucide-react";
import {
  METADATA_DATE_FIELDS,
  METADATA_TEXT_FIELDS,
  fromLocalInputValue,
  metadataOutputName,
  readPdfMetadata,
  toLocalInputValue,
  writePdfMetadata,
  type MetadataReading,
  type MetadataResult,
  type PdfMetadata,
} from "@/lib/pdf/metadata";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  Spinner,
  errorMessage,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { PrivacyLine, SegmentedControl, TextField } from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/** The two things a run can do — exported so the page's steps quote them. */
export const METADATA_ACTIONS = [
  { value: "edit", label: "Edit values" },
  { value: "remove", label: "Remove all metadata" },
] as const;

type Action = (typeof METADATA_ACTIONS)[number]["value"];

/** The run button's label for each action. */
export const METADATA_RUN_LABELS: Record<Action, string> = {
  edit: "Save metadata",
  remove: "Remove metadata",
};

export function MetadataRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · metadata read and changed locally in your browser"
      handoffSlug="edit-pdf-metadata"
      toolName="Edit PDF Metadata"
    >
      {(pdf, reset) => <MetadataEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

type Draft = Record<keyof PdfMetadata, string>;

function toDraft(reading: MetadataReading): Draft {
  return {
    title: reading.title,
    author: reading.author,
    subject: reading.subject,
    keywords: reading.keywords,
    creator: reading.creator,
    producer: reading.producer,
    creationDate: toLocalInputValue(reading.creationDate),
    modificationDate: toLocalInputValue(reading.modificationDate),
  };
}

function fromDraft(draft: Draft): PdfMetadata {
  return {
    title: draft.title,
    author: draft.author,
    subject: draft.subject,
    keywords: draft.keywords,
    creator: draft.creator,
    producer: draft.producer,
    creationDate: fromLocalInputValue(draft.creationDate),
    modificationDate: fromLocalInputValue(draft.modificationDate),
  };
}

export function MetadataEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [reading, setReading] = useState<MetadataReading | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [action, setAction] = useState<Action>("edit");
  const { busy, error, result, run, reset } = useAsyncRun<MetadataResult>();

  useEffect(() => {
    let alive = true;
    readPdfMetadata(pdf.bytes)
      .then((found) => {
        if (!alive) return;
        setReading(found);
        setDraft(toDraft(found));
      })
      .catch((err) => {
        if (alive) setReadError(errorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [pdf.bytes]);

  const set = (id: keyof PdfMetadata, value: string) =>
    setDraft((prev) => (prev ? { ...prev, [id]: value } : prev));

  const onRun = () => {
    if (!draft) return;
    void run(() =>
      writePdfMetadata(
        pdf.bytes,
        action === "remove"
          ? { kind: "remove-all" }
          : { kind: "edit", values: fromDraft(draft) },
      ),
    );
  };

  if (result) {
    const name = metadataOutputName(pdf.file.name);
    const removed = action === "remove";
    const kept = METADATA_TEXT_FIELDS.filter((f) => result.saved[f.id]).length;
    return (
      <ResultPanel
        title={removed ? "Metadata removed" : "Metadata saved"}
        summary={
          removed
            ? `No document information left · ${formatBytes(result.bytes.byteLength)}`
            : `${kept} of ${METADATA_TEXT_FIELDS.length} text fields set · ${formatBytes(result.bytes.byteLength)}`
        }
        onReset={onReset}
        output={outputFile(result.bytes, name)}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        <div className="flex flex-col gap-3">
          {!removed && (
            <dl
              data-metadata-saved=""
              className="border-line bg-wash rounded-panel grid max-w-2xl grid-cols-[1fr_3fr] gap-x-4 gap-y-1 border px-4 py-3 text-sm"
            >
              {METADATA_TEXT_FIELDS.map((field) => (
                <div key={field.id} className="contents">
                  <dt className="text-muted">{field.label}</dt>
                  <dd className="text-fg min-w-0 wrap-anywhere">
                    {result.saved[field.id] || "—"}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {result.replacedXmp && (
            <p className="text-muted max-w-2xl text-sm">
              This PDF also carried XMP metadata. It was replaced with the
              values above, so readers that show XMP agree with them; anything
              else it held was not kept.
            </p>
          )}
          {result.removedXmp && (
            <p className="text-muted max-w-2xl text-sm">
              Its XMP metadata was removed as well.
            </p>
          )}
          <button
            type="button"
            onClick={() => downloadBytes(result.bytes, name)}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            <Download className="size-4" aria-hidden />
            Download PDF
          </button>
        </div>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection title="What to do">
        <SegmentedControl
          label="Metadata action"
          value={action}
          onChange={setAction}
          options={METADATA_ACTIONS.map((a) => ({
            value: a.value,
            label: a.label,
          }))}
        />
      </RunnerSection>

      {readError ? (
        <ErrorNote message={readError} />
      ) : !draft || !reading ? (
        <p className="text-muted inline-flex items-center gap-2 text-sm">
          <Spinner /> Reading metadata…
        </p>
      ) : action === "remove" ? (
        <RunnerSection title="Remove all metadata">
          <p className="text-muted max-w-2xl text-sm">
            The copy keeps every page but drops its document information —
            title, author, subject, keywords, creator, producer and both dates
            {reading.hasXmp ? ", and its XMP metadata" : ""}.
          </p>
        </RunnerSection>
      ) : (
        <RunnerSection
          title="Document properties"
          aside={
            reading.hasXmp ? (
              <span className="text-muted text-xs">
                Has XMP metadata — it will be rewritten to match
              </span>
            ) : undefined
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {METADATA_TEXT_FIELDS.map((field) => (
              <TextField
                key={field.id}
                label={field.label}
                value={draft[field.id]}
                onChange={(value) => set(field.id, value)}
                placeholder="Not set"
              />
            ))}
            {METADATA_DATE_FIELDS.map((field) => (
              <DateField
                key={field.id}
                label={field.label}
                value={draft[field.id]}
                onChange={(value) => set(field.id, value)}
              />
            ))}
          </div>
          <p className="text-muted text-xs">
            Leave a field empty to remove it. Dates use your device&apos;s time
            zone.
          </p>
        </RunnerSection>
      )}

      <PrivacyLine>
        The PDF is read and saved on your device — nothing is uploaded.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton
            onClick={onRun}
            busy={busy}
            disabled={!draft}
            busyLabel="Saving…"
          >
            {action === "remove" ? (
              <Eraser className="size-4" aria-hidden />
            ) : (
              <Tags className="size-4" aria-hidden />
            )}
            {METADATA_RUN_LABELS[action]}
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-muted text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-line text-fg focus:border-accent/40 focus:ring-accent/50 bg-canvas rounded-ctl w-full min-w-0 border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
      />
    </div>
  );
}
