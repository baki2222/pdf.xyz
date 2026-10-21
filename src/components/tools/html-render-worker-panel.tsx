"use client";

import { useCallback, useEffect, useId, useState } from "react";
import {
  Download,
  FileCode,
  Globe,
  Info,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import {
  canRunHtmlRender,
  runWorkerHtmlToPdf,
  runWorkerWebpageToPdf,
  type HtmlRenderWorkerResult,
} from "@/lib/workers/html-render-client";
import {
  findUnbundledAssetsInHtml,
  unbundledAssetsNote,
} from "@/lib/workers/html-render/unbundled-assets";
import { downloadBytes } from "@/lib/pdf/browser";
import { toolFileCeilingBytes } from "@/lib/tools/file-ceilings";
import type { Tool } from "@/lib/tools/types";
import { pickRefusal } from "@/lib/uploads/pick-check";
import { formatBytes } from "@/lib/utils";
import {
  DownloadCta,
  Dropzone,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { ChosenFileTarget } from "./chosen-file-target";
import { NotifyMe } from "./notify-me";
import { jobBusyLabel, useWorkerJob, WorkerJobStatus } from "./worker-job";
import { resumeSecurityJob } from "@/lib/workers/pdf-security-client";
import { decodeTextFile } from "@/lib/text/decode-text-file";
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
 * on 507b6383), is 527.5px at 360, 439.5px at 640, 457.5px at 1024;
 * x1.035, to the half rem, then up to a value another panel's slot already
 * uses, so the thirteen share a handful of classes. A first fit from
 * Windows alone (x1.06) left PowerPoint to PDF and PDF to PowerPoint
 * short on Linux at 360. The check: `e2e/tool-layout.mobile.spec.ts`.
 */
const STATUS_SLOT = "min-h-[35.5rem] sm:min-h-[29.5rem] lg:min-h-[30.5rem]";

type Mode = "html" | "url";

export function HtmlRenderWorkerPanel({ tool }: { tool: Tool }) {
  const mode: Mode = tool.slug === "webpage-to-pdf" ? "url" : "html";
  const Icon = mode === "url" ? Globe : FileCode;
  const ceilingBytes = toolFileCeilingBytes(tool);

  return (
    <WorkerPanelShell
      tool={tool}
      engine={{ label: "Chromium renderer", icon: Icon }}
      description={
        <>
          Chromium renders{" "}
          {mode === "url" ? "the public URL" : "your uploaded HTML file"} to a
          real print PDF on the isolated worker. It produces a PDF artifact or
          fails honestly — no screenshot placeholder and no browser-side fake.
        </>
      }
      canRun={canRunHtmlRender}
      specRows={[
        {
          icon: Icon,
          label: "Input",
          value: mode === "url" ? "One public URL" : "One HTML file",
        },
        { icon: Download, label: "Output", value: "PDF" },
        {
          icon: Timer,
          label: "Retention",
          value: `Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`,
        },
        // The per-file cap, only where there IS a file. This row stated
        // "100.0 MB/file" on `webpage-to-pdf` too — three rows under an
        // Input row correctly reading "One public URL", for a tool the API
        // refuses uploads for outright (`parseCreateUploadSessionRequest`
        // answers `unprocessable_entity` on any `files` for a url-input
        // tool). A per-file ceiling on a tool with no file input is not a
        // conservative claim, it is a meaningless one, and it was the only
        // size figure on that page.
        ...(ceilingBytes !== null
          ? [
              {
                icon: ShieldCheck,
                label: "Limit",
                value: `${formatBytes(ceilingBytes)}/file`,
              },
            ]
          : []),
      ]}
    >
      <HtmlRenderRunArea mode={mode} tool={tool} />
    </WorkerPanelShell>
  );
}

/**
 * The note for linked files this one-file upload will not carry, read from the
 * chosen file on this machine — nothing is uploaded to work it out. The worker
 * renders only the file itself, so a sibling `logo.png` or `style.css` comes
 * out as a broken image or an unstyled page while the job still succeeds.
 */
function useUnbundledAssetsNote(file: File | null): string | null {
  const [note, setNote] = useState<{ file: File; text: string | null } | null>(
    null,
  );
  useEffect(() => {
    if (!file) return;
    let active = true;
    // Decoded in the file's own encoding, as every read of a user's text file
    // is (`decodeTextFile`): Blob.text() would turn a Windows-1252 page's
    // accented link names into U+FFFD before they were looked for.
    decodeTextFile(file)
      .then(({ text: html }) => {
        if (active)
          setNote({
            file,
            text: unbundledAssetsNote(findUnbundledAssetsInHtml(html)),
          });
      })
      .catch(() => {
        // Unreadable here means unreadable for the upload too; the run
        // reports that. A note we cannot compute is simply not shown.
      });
    return () => {
      active = false;
    };
  }, [file]);
  // A note belongs to the file it was computed for, never to the next one.
  return note && note.file === file ? note.text : null;
}

const RUN_LABEL = "Render PDF";

function HtmlRenderRunArea({ mode, tool }: { mode: Mode; tool: Tool }) {
  const { available, status } = useWorkerPanel();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("https://");
  const urlId = useId();
  const job = useWorkerJob<HtmlRenderWorkerResult>({
    tool: mode === "url" ? "webpage-to-pdf" : "html-to-pdf",
    resume: (id, controls) =>
      resumeSecurityJob(id, {
        ...controls,
        tool: mode === "url" ? "webpage-to-pdf" : "html-to-pdf",
      }),
  });
  const { busy, outcome, setOutcome, run } = job;
  const assetsNote = useUnbundledAssetsNote(mode === "html" ? file : null);
  // A URL tool takes no file, so nothing can be carried to it: the hook
  // stays idle there (its capability is `none`).
  const staged = useStagedHandoff(tool.slug, RUN_LABEL, (files) => {
    setOutcome(null);
    setFile(files[0] ?? null);
  });

  const start = useCallback(async () => {
    if (!available) return;
    await run(async (controls) => {
      const result =
        mode === "url"
          ? await runWorkerWebpageToPdf(url.trim(), controls)
          : file
            ? await runWorkerHtmlToPdf(
                {
                  filename: file.name,
                  bytes: new Uint8Array(await file.arrayBuffer()),
                },
                controls,
              )
            : { ok: false as const, message: "Choose an HTML file first." };
      return result;
    });
  }, [file, mode, url, run, available]);

  const missing =
    mode === "html" ? !file : url.trim().length <= "https://".length;
  const detail =
    status?.daemon.detail ?? "The secure worker is not drainable here.";

  return (
    <div className="flex flex-col gap-4">
      {staged}
      {mode === "url" ? (
        // Named by a visible label: the placeholder used to be the field's
        // only name, and it vanishes on the first keystroke.
        <div className="flex flex-col gap-1.5">
          <label htmlFor={urlId} className="text-fg text-xs font-medium">
            Web address
          </label>
          <input
            id={urlId}
            type="url"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setOutcome(null);
            }}
            className="border-line text-fg placeholder:text-muted focus:border-accent/40 focus:ring-accent/50 bg-panel w-full rounded-[3px] border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
            placeholder="https://example.com"
          />
        </div>
      ) : file ? (
        <div className="flex flex-col gap-2">
          <ChosenFileTarget
            file={file}
            accept="text/html,.html,.htm"
            busy={busy}
            refuse={(file) => pickRefusal(tool, file)}
            onReplace={(files) => {
              setOutcome(null);
              setFile(files[0] ?? null);
            }}
          >
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
          </ChosenFileTarget>
          {/* Present, empty, from the moment a file is chosen: a live region
              created together with its text is not announced by several
              screen readers. The note arrives in it once the file is read. */}
          <div role="status">
            {assetsNote && (
              <p className="text-muted flex items-start gap-1.5 text-xs leading-relaxed">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{assetsNote}</span>
              </p>
            )}
          </div>
        </div>
      ) : (
        <Dropzone
          pageTarget
          refuse={(file) => pickRefusal(tool, file)}
          onFiles={(files) => {
            // An over-ceiling or non-HTML file never gets here: `refuse`
            // turned it away at the pick, before it was read or uploaded.
            setOutcome(null);
            setFile(files[0] ?? null);
          }}
          accept="text/html,.html,.htm"
          multiple={false}
          compact
          title="Add an HTML file, or"
          hint="HTML"
        />
      )}

      <WorkerGate
        reserve={STATUS_SLOT}
        job={job}
        bytes={mode === "html" ? file?.size : undefined}
        run={(ready) => (
          <WorkerRunButton
            onClick={start}
            busy={busy}
            disabled={!ready || missing}
            busyLabel={jobBusyLabel(job.phase, "Rendering PDF…")}
            icon={FileCode}
          >
            {RUN_LABEL}
          </WorkerRunButton>
        )}
        jobStatus={<WorkerJobStatus job={job} />}
        note={
          <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {mode === "url"
              ? `Pressing ${RUN_LABEL} starts a private secure-worker job. Only public http(s) URLs are accepted; private/localhost targets are rejected.`
              : `Your HTML uploads to a private secure-worker job only when you press ${RUN_LABEL}. It is stored only for the short worker lifecycle and wiped after processing. Only the file itself is uploaded, so embed its images and stylesheets or link them with full https:// addresses.`}
          </p>
        }
        off={
          <>
            <p className="text-muted text-sm leading-relaxed">{detail}</p>
            <p className="text-muted text-xs leading-relaxed">
              {RUN_LABEL} stays off until the worker is ready, so {tool.name}{" "}
              never pretends to process input it cannot actually render.
            </p>
            <NotifyMe
              toolName={tool.name}
              toolSlug={tool.slug}
              checking={false}
            />
          </>
        }
      />
      {outcome?.ok === true && (
        <ResultCard
          announce="Your PDF is ready."
          output={workerOutput(outcome.output, outcome.artifact)}
          inputBytes={mode === "html" ? file?.size : undefined}
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
