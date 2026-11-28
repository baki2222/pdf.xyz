"use client";

import { useCallback, useState } from "react";
import { SETTINGS_BATCH_TOOLS } from "@/lib/batch/tools";
import {
  metadataOutputName,
  readPdfMetadata,
  writePdfMetadata,
  type PdfMetadata,
} from "@/lib/pdf/metadata";
import type { SinglePdfBatch } from "../single-pdf-runner";
import { SegmentedControl, TextField } from "../stamp-controls";
import {
  SettingsBatchRunner,
  type BatchFileOutput,
} from "./settings-batch-runner";
import type { OpenedPdf } from "./open-for-batch";

/** The fields a batch sets: the four a person shares a set of files by. */
export const METADATA_BATCH_FIELDS = [
  { id: "title", label: "Title" },
  { id: "author", label: "Author" },
  { id: "subject", label: "Subject" },
  { id: "keywords", label: "Keywords" },
] as const satisfies readonly { id: keyof PdfMetadata; label: string }[];

type BatchField = (typeof METADATA_BATCH_FIELDS)[number]["id"];
export type MetadataBatchValues = Record<BatchField, string>;

/** What the batch does to every file. */
export type MetadataBatchChange =
  { kind: "set"; values: MetadataBatchValues } | { kind: "remove-all" };

/** Said beside the fields: a blank one is not a blank value. */
export const METADATA_BATCH_BLANK_KEEPS =
  "A field left blank keeps each file's own value.";

/**
 * Change one file: the typed fields replace the file's own, every other
 * value (and both dates) is read from the file and written back as it was;
 * or every entry removed, as the single-file editor removes them.
 */
export async function metadataOneFile(
  { file, bytes }: OpenedPdf,
  change: MetadataBatchChange,
): Promise<BatchFileOutput> {
  if (change.kind === "remove-all") {
    const result = await writePdfMetadata(bytes, { kind: "remove-all" });
    return {
      name: metadataOutputName(file.name),
      bytes: result.bytes,
      detail: "Metadata removed",
    };
  }
  const own = await readPdfMetadata(bytes);
  const typed = METADATA_BATCH_FIELDS.filter(
    ({ id }) => change.values[id].trim() !== "",
  );
  const values: PdfMetadata = {
    title: own.title,
    author: own.author,
    subject: own.subject,
    keywords: own.keywords,
    creator: own.creator,
    producer: own.producer,
    creationDate: own.creationDate,
    modificationDate: own.modificationDate,
  };
  for (const { id } of typed) values[id] = change.values[id].trim();
  const result = await writePdfMetadata(bytes, { kind: "edit", values });
  return {
    name: metadataOutputName(file.name),
    bytes: result.bytes,
    detail: `${typed.map((f) => f.label).join(", ")} set`,
  };
}

const EMPTY: MetadataBatchValues = {
  title: "",
  author: "",
  subject: "",
  keywords: "",
};

/** Edit PDF Metadata's batch: one set of values, or Remove all, for every file. */
export function MetadataBatch(props: SinglePdfBatch) {
  const [action, setAction] = useState<"set" | "remove-all">("set");
  const [values, setValues] = useState<MetadataBatchValues>(EMPTY);
  const nothingTyped = METADATA_BATCH_FIELDS.every(
    ({ id }) => values[id].trim() === "",
  );
  const process = useCallback(
    (opened: OpenedPdf) =>
      metadataOneFile(
        opened,
        action === "remove-all"
          ? { kind: "remove-all" }
          : { kind: "set", values },
      ),
    [action, values],
  );
  return (
    <SettingsBatchRunner
      {...props}
      toolName="Edit PDF Metadata"
      verb="Update"
      runningLabel="Updating…"
      zipName={SETTINGS_BATCH_TOOLS["edit-pdf-metadata"].zipName}
      appliesNote={
        action === "remove-all"
          ? "Every file loses its document information, XMP metadata and page thumbnails; the pages are kept."
          : `The values you type go into every file. ${METADATA_BATCH_BLANK_KEEPS}`
      }
      runBlocked={
        action === "set" && nothingTyped
          ? "Type at least one value, or choose Remove all metadata."
          : null
      }
      process={process}
      settings={
        <>
          <SegmentedControl
            label="What to do"
            value={action}
            onChange={setAction}
            options={[
              { value: "set", label: "Set values" },
              { value: "remove-all", label: "Remove all metadata" },
            ]}
          />
          {action === "set" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {METADATA_BATCH_FIELDS.map(({ id, label }) => (
                <TextField
                  key={id}
                  label={label}
                  value={values[id]}
                  onChange={(next) => setValues((v) => ({ ...v, [id]: next }))}
                  placeholder="Keep each file's own"
                />
              ))}
            </div>
          )}
        </>
      }
    />
  );
}
