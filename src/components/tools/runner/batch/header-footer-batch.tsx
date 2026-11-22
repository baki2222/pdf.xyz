"use client";

import { useCallback, useState } from "react";
import { BatchSkip } from "@/lib/batch";
import { SETTINGS_BATCH_TOOLS } from "@/lib/batch/tools";
import { getPageRotations } from "@/lib/pdf/engine";
import {
  addHeaderFooter,
  headerFooterOutputName,
  headerFooterPlan,
  NO_PAGE_STAMPED,
  resolveStampDate,
} from "@/lib/pdf/header-footer";
import type { HAlign } from "@/lib/pdf/stamp";
import type { SinglePdfBatch } from "../single-pdf-runner";
import { SegmentedControl, TextField } from "../stamp-controls";
import {
  SettingsBatchRunner,
  type BatchFileOutput,
} from "./settings-batch-runner";
import type { OpenedPdf } from "./open-for-batch";

/** The options every file of a batch is stamped with. */
export interface HeaderFooterBatchOptions {
  header: string;
  footer: string;
  /** The box each line sits in, across the band. */
  align: HAlign;
}

/** The fields the batch's lines may hold, as the single-file editor names them. */
export const HEADER_FOOTER_BATCH_FIELDS = "{n}, {total} and {date}";

/**
 * Stamp one file with the batch's header and footer, counted from its own
 * first page; font, size, margin and colour are the single-file editor's
 * starting values (the engine's defaults).
 */
export async function headerFooterOneFile(
  { file, bytes }: OpenedPdf,
  options: HeaderFooterBatchOptions,
): Promise<BatchFileOutput> {
  const pageCount = (await getPageRotations(bytes)).length;
  const stamped = headerFooterPlan(pageCount).stamps.length;
  if (stamped === 0) throw new BatchSkip(NO_PAGE_STAMPED);
  const header = options.header.trim();
  const footer = options.footer.trim();
  const date = await resolveStampDate([header, footer]);
  const out = await addHeaderFooter(bytes, {
    header: header ? { [options.align]: header } : undefined,
    footer: footer ? { [options.align]: footer } : undefined,
    date,
  });
  return {
    name: headerFooterOutputName(file.name),
    bytes: out,
    detail: `${stamped} page${stamped === 1 ? "" : "s"} stamped`,
  };
}

/** PDF Header & Footer's batch: one header and footer for every file. */
export function HeaderFooterBatch(props: SinglePdfBatch) {
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("Page {n} of {total}");
  const [align, setAlign] = useState<HAlign>("center");
  const process = useCallback(
    (opened: OpenedPdf) =>
      headerFooterOneFile(opened, { header, footer, align }),
    [header, footer, align],
  );
  return (
    <SettingsBatchRunner
      {...props}
      toolName="PDF Header & Footer"
      verb="Stamp"
      runningLabel="Stamping…"
      zipName={SETTINGS_BATCH_TOOLS["header-footer"].zipName}
      appliesNote={`Page numbers restart in each file. ${HEADER_FOOTER_BATCH_FIELDS} work as in the single-file editor; font, size, margin and colour are its defaults.`}
      runBlocked={
        header.trim() || footer.trim()
          ? null
          : "Type a header or a footer first."
      }
      process={process}
      settings={
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Header"
              value={header}
              onChange={setHeader}
              placeholder="e.g. Annual report"
            />
            <TextField
              label="Footer"
              value={footer}
              onChange={setFooter}
              placeholder="e.g. Page {n} of {total}"
            />
          </div>
          <SegmentedControl
            label="Position across the page"
            value={align}
            onChange={setAlign}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" },
            ]}
          />
        </>
      }
    />
  );
}
