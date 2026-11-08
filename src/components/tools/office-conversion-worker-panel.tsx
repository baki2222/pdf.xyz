"use client";

import { Fragment, useCallback, useId, useState } from "react";
import { Download, FileText, ShieldCheck, Timer } from "lucide-react";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import {
  EXTENSIONS_BY_FORMAT,
  MIME_BY_FORMAT,
} from "@/lib/jobs/mime-by-format";
import {
  canRunOfficeConversion,
  runWorkerOfficeToPdf,
  type OfficeConversionWorkerResult,
} from "@/lib/workers/office-conversion-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { toolFileCeilingBytes } from "@/lib/tools/file-ceilings";
import type { Tool } from "@/lib/tools/types";
import { pickRefusal } from "@/lib/uploads/pick-check";
import { formatBytes } from "@/lib/utils";
import { OFFICE_CONVERSION_RUN_LABEL } from "@/lib/tools/office-run-label";
import {
  DOCUMENT_NOUNS,
  type OfficeToPdfTool,
} from "@/lib/workers/office-conversion/tools";
import {
  FIT_COLUMNS_TO_WIDTH_OPTION,
  ONE_PAGE_PER_SHEET_OPTION,
  ORIENTATION_LABEL,
  PAGE_SETUP_XLSX_ONLY_NOTE,
  SHEET_LAYOUT_CHECKBOXES,
  SHEET_ORIENTATIONS,
  acceptsPageSetup,
  type SheetOrientation,
} from "@/lib/workers/office-conversion/sheet-layout";
import {
  DownloadCta,
  Dropzone,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { ChosenFileTarget } from "./chosen-file-target";
import { jobBusyLabel, useWorkerJob, WorkerJobStatus } from "./worker-job";
import { resumeSecurityJob } from "@/lib/workers/pdf-security-client";
import { useStagedHandoff } from "./use-staged-handoff";
import {
  useWorkerPanel,
  WorkerGate,
  WorkerPanelShell,
  workerOutput,
} from "./worker-panel-shell";

/**
 * The status slot's reserved height (see `WorkerStatusSlot` and
 * `WorkerGate`): the tallest state it shows — checking, a failed check,
 * not enabled, ready — at the narrowest width of each breakpoint.
 *
 * Refitted 2026-10-21 (WP-10), when the slot came to hold Run, the docket
 * and what the check said, the drop zone having moved out of it: the
 * tallest state, the larger of Windows and Linux (CI's SLOT_NATURAL lines
 * on 507b6383), is 547px at 360, 439.5px at 640, 457.5px at 1024;
 * x1.035, to the half rem, then up to a value another panel's slot already
 * uses, so the thirteen share a handful of classes. A first fit from
 * Windows alone (x1.06) left PowerPoint to PDF and PDF to PowerPoint
 * short on Linux at 360. The check: `e2e/tool-layout.mobile.spec.ts`.
 *
 * Refitted 2026-10-23, when the stage list stopped being drawn before a
 * job (one "What happens to your file" press stands in for it): the
 * tallest state is now not-enabled, off 508/547px at 360 (Windows/Linux;
 * Linux from CI's SLOT_NATURAL lines on 0504da27, a state this change
 * did not touch), x1.035 to the half rem, then up to a value another
 * panel already uses.
 *
 * Refitted 2026-10-24, when the not-enabled box became one sentence,
 * Why?, Try again and Notify me (the reason one press away): the
 * tallest state, Windows / Linux (CI's SLOT_NATURAL lines on
 * 28af68e1), is 338/357.5px at 360-390, 225.5/225.5px at 640,
 * 230.5/230.5px at 1024; the larger x1.035, to the half rem.
 */
const STATUS_SLOT = "min-h-[23.5rem] sm:min-h-[15rem] lg:min-h-[15rem]";

type OfficeTool = OfficeToPdfTool;

function isOfficeTool(slug: string): slug is OfficeTool {
  return (
    slug === "word-to-pdf" ||
    slug === "excel-to-pdf" ||
    slug === "powerpoint-to-pdf"
  );
}

/**
 * The file picker's `accept`: each catalogue format's extensions and MIME
 * types, from the tables the server validates with. Typed per tool until
 * 2026-11-04, when ODT, RTF, ODS and ODP joined the catalogue rows and the
 * typed lists would have hidden them in the picker.
 */
function acceptFor(tool: Tool): string {
  const tokens = tool.accept.flatMap((format) => [
    ...(EXTENSIONS_BY_FORMAT[format] ?? []).map((ext) => `.${ext}`),
    ...(MIME_BY_FORMAT[format] ?? []),
  ]);
  return [...new Set(tokens)].join(",");
}

/**
 * The drop zone's hint: the catalogue row's formats, "XLSX, XLS, CSV or ODS
 * file". It read "Office document" on all three pages, a deck page included
 * (audits excel-to-pdf#5, powerpoint-to-pdf#7).
 */
function formatsHint(tool: Tool): string {
  const formats = tool.accept;
  const listed =
    formats.length <= 1
      ? formats.join("")
      : `${formats.slice(0, -1).join(", ")} or ${formats[formats.length - 1]}`;
  return `${listed} file`;
}

export function OfficeConversionWorkerPanel({ tool }: { tool: Tool }) {
  const ceilingBytes = toolFileCeilingBytes(tool);
  const officeTool: OfficeTool = isOfficeTool(tool.slug)
    ? tool.slug
    : "word-to-pdf";

  return (
    <WorkerPanelShell
      tool={tool}
      engine={{ label: "Office conversion", icon: FileText }}
      description={`LibreOffice turns your ${DOCUMENT_NOUNS[officeTool]} into a PDF on our secure server. If it cannot, you will see why.`}
      canRun={(status) =>
        canRunOfficeConversion(status) && isOfficeTool(tool.slug)
      }
      specRows={[
        { icon: Download, label: "You get", value: "PDF" },
        {
          icon: Timer,
          label: "Your files",
          value: `Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`,
        },
        // LibreOffice's own gate, not the worker's global one. This row
        // read `JOB_LIMITS.maxFileBytes` — "100.0 MB/file" — on three
        // pages whose engine refuses above 50 MB.
        ...(ceilingBytes !== null
          ? [
              {
                icon: ShieldCheck,
                label: "Largest file",
                value: `${formatBytes(ceilingBytes)}/file`,
              },
            ]
          : []),
      ]}
    >
      <OfficeRunArea
        tool={officeTool}
        catalogTool={tool}
        accept={acceptFor(tool)}
      />
    </WorkerPanelShell>
  );
}

const RUN_LABEL = OFFICE_CONVERSION_RUN_LABEL;

function OfficeRunArea({
  tool,
  catalogTool,
  accept,
}: {
  tool: OfficeTool;
  catalogTool: Tool;
  accept: string;
}) {
  const { available } = useWorkerPanel();
  const [file, setFile] = useState<File | null>(null);
  // Excel to PDF only (audit excel-to-pdf#1): each checkbox's state keyed by
  // its own option, and the orientation select (null keeps the file's).
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [orientation, setOrientation] = useState<SheetOrientation | null>(null);
  const layoutId = useId();
  const onePagePerSheet = checked[ONE_PAGE_PER_SHEET_OPTION] === true;
  const job = useWorkerJob<OfficeConversionWorkerResult>({
    tool: tool,
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: tool }),
  });
  const { busy, outcome, setOutcome, run } = job;
  const staged = useStagedHandoff(catalogTool.slug, RUN_LABEL, (files) => {
    setOutcome(null);
    setFile(files[0] ?? null);
  });
  const start = useCallback(async () => {
    if (!file || !available) return;
    await run(async (controls) => {
      const result = await runWorkerOfficeToPdf(
        {
          tool,
          filename: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          layout: {
            onePagePerSheet,
            orientation,
            fitColumnsToWidth: checked[FIT_COLUMNS_TO_WIDTH_OPTION] === true,
          },
        },
        controls,
      );
      return result;
    });
  }, [file, tool, run, available, onePagePerSheet, orientation, checked]);

  const orientationId = `${layoutId}-orientation`;
  // Page setup does nothing beside one page per sheet, and the worker can
  // rewrite it only in an .xlsx (`sheet-layout.ts`).
  const pageSetupShown = !onePagePerSheet;
  const pageSetupFits = !file || acceptsPageSetup(file.name);

  return (
    <div className="flex flex-col gap-4">
      {staged}
      {file ? (
        <ChosenFileTarget
          file={file}
          accept={accept}
          busy={busy}
          refuse={(file) => pickRefusal(catalogTool, file)}
          onReplace={(files) => {
            setOutcome(null);
            setFile(files[0] ?? null);
          }}
        >
          <div className="border-line bg-wash text-fg rounded-ctl flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm">
            <span className="truncate">{file.name}</span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setOutcome(null);
              }}
              className="text-muted hover:text-fg tap-y shrink-0 text-sm font-medium transition"
            >
              Remove
            </button>
          </div>
        </ChosenFileTarget>
      ) : (
        <Dropzone
          pageTarget
          refuse={(file) => pickRefusal(catalogTool, file)}
          onFiles={(files) => {
            // An over-ceiling or wrong-format file never gets here: `refuse`
            // turned it away at the pick, before it was read or uploaded.
            setOutcome(null);
            setFile(files[0] ?? null);
          }}
          accept={accept}
          multiple={false}
          compact
          title={`Add your ${DOCUMENT_NOUNS[tool]}, or`}
          hint={formatsHint(catalogTool)}
        />
      )}
      {tool === "excel-to-pdf" &&
        SHEET_LAYOUT_CHECKBOXES.map((choice) => {
          const isPageSetup = choice.option === FIT_COLUMNS_TO_WIDTH_OPTION;
          if (isPageSetup && !pageSetupShown) return null;
          if (isPageSetup && !pageSetupFits)
            return (
              <p
                key={choice.option}
                className="text-muted text-xs leading-relaxed"
              >
                {PAGE_SETUP_XLSX_ONLY_NOTE}
              </p>
            );
          const hintId = `${layoutId}-${choice.option}-hint`;
          return (
            <Fragment key={choice.option}>
              {isPageSetup && (
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={orientationId}
                    className="text-fg text-sm font-medium"
                  >
                    {ORIENTATION_LABEL}
                  </label>
                  <select
                    id={orientationId}
                    value={orientation ?? ""}
                    aria-disabled={busy}
                    onChange={(e) => {
                      // Locked while a job runs, but kept in the focus order.
                      if (busy) return;
                      setOutcome(null);
                      setOrientation(
                        e.target.value === ""
                          ? null
                          : (e.target.value as SheetOrientation),
                      );
                    }}
                    className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl min-h-11 border px-3 py-1.5 text-sm outline-none"
                  >
                    {SHEET_ORIENTATIONS.map((o) => (
                      <option key={o.label} value={o.value ?? ""}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-fg flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked[choice.option] === true}
                    aria-disabled={busy}
                    aria-describedby={hintId}
                    onChange={(e) => {
                      // Locked while a job runs, but kept in the focus order.
                      if (busy) return;
                      setOutcome(null);
                      const value = e.target.checked;
                      setChecked((prev) => ({
                        ...prev,
                        [choice.option]: value,
                      }));
                    }}
                    className="accent-accent size-4"
                  />
                  {choice.label}
                </label>
                <p id={hintId} className="text-muted text-xs leading-relaxed">
                  {choice.hint}
                </p>
              </div>
            </Fragment>
          );
        })}
      <WorkerGate
        reserve={STATUS_SLOT}
        job={job}
        bytes={file?.size}
        run={(ready) => (
          <WorkerRunButton
            onClick={start}
            busy={busy}
            disabled={!ready || !file}
            busyLabel={jobBusyLabel(job.phase, "Converting to PDF…")}
            icon={FileText}
          >
            {RUN_LABEL}
          </WorkerRunButton>
        )}
        jobStatus={<WorkerJobStatus job={job} />}
        note={
          <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Your document uploads to our secure server only when you press{" "}
            {RUN_LABEL}. It is stored only for the short server lifecycle and
            wiped after processing.
          </p>
        }
        off={
          <>
            {/* Plain words (audit word-to-pdf#5): this read the daemon's
                account of queues and object storage, or "not drainable". */}
            <p className="text-muted text-sm leading-relaxed">
              Conversion is unavailable right now.
            </p>
            <p className="text-muted text-xs leading-relaxed">
              {RUN_LABEL} stays off until our server is ready.
            </p>
          </>
        }
      />
      {outcome?.ok === true && (
        <ResultCard
          announce="Your PDF is ready."
          output={workerOutput(outcome.output, outcome.artifact)}
          inputBytes={file?.size}
        >
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
