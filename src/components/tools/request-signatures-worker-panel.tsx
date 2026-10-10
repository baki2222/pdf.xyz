"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  PenLine,
  Plus,
  ShieldCheck,
  Timer,
  Trash2,
  Users,
} from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import {
  MAX_REQUEST_SIGNERS,
  signatureBlockFields,
  type RequestSignatureField,
  type RequestSignatureRouting,
} from "@/lib/jobs/request-signatures";
import {
  readPdfFrames,
  type PdfFrames,
  type VisiblePageFrame,
} from "@/lib/pdf/page-frame";
import {
  createThumbnailRenderer,
  type ThumbnailRenderer,
} from "@/lib/pdf/render";
import { clampPixelRatio } from "@/lib/pdf/render-utils";
import {
  classifyPdfAccess,
  encryptedPdfMessage,
  probePdfEncryption,
} from "@/lib/pdf/encryption";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  canRunRequestSignatures,
  runWorkerRequestSignatures,
  type RequestSignaturesWorkerResult,
} from "@/lib/workers/request-signatures-client";
import { downloadBytes, readFileBytes } from "@/lib/pdf/browser";
import type { Tool } from "@/lib/tools/types";
import { pickRefusal, type PickRefusal } from "@/lib/uploads/pick-check";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import {
  DownloadCta,
  Dropzone,
  ErrorNote,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";
import { jobBusyLabel, useWorkerJob, WorkerJobStatus } from "./worker-job";
import { resumeSecurityJob } from "@/lib/workers/pdf-security-client";
import {
  useWorkerStatus,
  WorkerStatusPending,
  type WorkerPhase,
  WorkerStatusSlot,
  workerSlotState,
} from "./worker-status";

/**
 * The status slot's reserved height (see `WorkerStatusSlot`): the tallest
 * state it shows at the narrowest width of each breakpoint, measured
 * 2026-10-10 — phone at 360px 717.5px, `sm` at 640px 530.5px, `lg` at 1024px
 * 530.5px — plus 4px, to the half rem.
 */
const STATUS_SLOT = "min-h-[46.5rem] sm:min-h-[33.5rem] lg:min-h-[33.5rem]";

type Phase = WorkerPhase;

interface SignerDraft {
  name: string;
  email: string;
}

function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading")
    return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status)
    return { tone: "muted", label: "Status unknown", pulse: false };
  return canRunRequestSignatures(status)
    ? { tone: "ok", label: "Secure worker", pulse: false }
    : { tone: "muted", label: "Not enabled", pulse: false };
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Keep a requested page inside the document (or ≥ 1 while the count is unknown). */
export function clampSignaturePage(
  value: number,
  pageCount: number | null,
): number {
  const whole = Math.floor(Number.isFinite(value) ? value : 1);
  const upper = pageCount ?? Number.POSITIVE_INFINITY;
  return Math.min(upper, Math.max(1, whole));
}

const FIELD_SHORT_LABEL: Record<RequestSignatureField["type"], string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date",
  text: "Text",
};

/**
 * The target page as the reader sees it, with the planned fields drawn on top.
 *
 * The request places fields blind — fractions of a page the user never looks at
 * — so without this the first time anyone saw where the boxes went was in the
 * downloaded PDF. The page is rendered in its DISPLAYED orientation (its own
 * `/Rotate` applied) and sized to the visible frame, the same frame the worker
 * resolves the fractions against, so a box drawn here is where the field lands.
 * A render failure keeps a blank sheet: the overlay is still true.
 */
function SignaturePagePreview({
  bytes,
  frame,
  page,
  fields,
}: {
  bytes: Uint8Array;
  frame: VisiblePageFrame;
  page: number;
  fields: RequestSignatureField[];
}) {
  const [thumb, setThumb] = useState<{ page: number; url: string } | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    let renderer: ThumbnailRenderer | null = null;
    (async () => {
      try {
        renderer = await createThumbnailRenderer(bytes, {
          orientation: "displayed",
          pixelRatio: clampPixelRatio(window.devicePixelRatio || 1),
          targetWidth: 280,
        });
        const rendered = await renderer.renderPage(page - 1);
        if (!rendered) return;
        if (!active) {
          URL.revokeObjectURL(rendered.url);
          return;
        }
        url = rendered.url;
        setThumb({ page, url: rendered.url });
      } catch {
        // No preview image; the blank sheet and the overlay still render.
      } finally {
        await renderer?.destroy();
      }
    })();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [bytes, page]);

  const image = thumb?.page === page ? thumb.url : null;
  return (
    <figure className="flex flex-col items-center gap-2">
      <div
        data-testid="signature-page-preview"
        className="relative w-full max-w-[220px] overflow-hidden rounded-[2px] bg-white shadow-md ring-1 ring-black/10"
        style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
      >
        {image && (
          // eslint-disable-next-line @next/next/no-img-element -- a blob: URL of a local render
          <img
            src={image}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full"
          />
        )}
        {fields.map((field, index) => (
          <span
            key={index}
            data-field-box=""
            className="border-accent bg-accent/15 text-accent absolute flex items-start overflow-hidden rounded-[2px] border border-dashed px-0.5 text-[8px] leading-tight font-semibold"
            style={{
              left: `${field.x * 100}%`,
              bottom: `${field.y * 100}%`,
              width: `${field.width * 100}%`,
              height: `${field.height * 100}%`,
            }}
            aria-hidden
          >
            {field.signer + 1} · {FIELD_SHORT_LABEL[field.type]}
          </span>
        ))}
      </div>
      <figcaption className="text-muted text-center text-xs">
        Page {page} — where each signer&apos;s fields will be added.
      </figcaption>
    </figure>
  );
}

export function RequestSignaturesWorkerPanel({ tool }: { tool: Tool }) {
  const { phase, status, retry } = useWorkerStatus();

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunRequestSignatures(status);
  // Read only once the status is known: the loading and error phases
  // render <WorkerStatusPending>, which claims nothing about the tool.
  const unavailableDetail =
    status?.daemon.detail ?? "The secure worker is not drainable here.";

  return (
    <div className="">
      <div className="border-line bg-panel flex flex-col gap-6 rounded-[4px] border p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="border-accent/40 bg-accent/10 text-accent inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
              <PenLine className="size-3" aria-hidden />
              Signature request
            </span>
            <StatusBadge
              tone={badge.tone}
              label={badge.label}
              pulse={badge.pulse}
            />
          </div>
          <h2 className="text-fg text-lg font-semibold">
            {tool.name} runs on a secure worker
          </h2>
          <p className="text-muted text-sm leading-relaxed">
            The worker adds real fillable fields for each signer and returns a
            signature-request package — the prepared PDF, a manifest, and an
            audit trail. It prepares and records the request; it never
            fabricates a signed document, and legally-binding delivery to
            external signers needs a configured e-signature provider.
          </p>
        </div>

        <WorkerStatusSlot
          state={workerSlotState(phase, available)}
          reserve={STATUS_SLOT}
        >
          {available ? (
            <RequestBuilder refuse={(file) => pickRefusal(tool, file)} />
          ) : phase === "ready" ? (
            <div className="border-line bg-wash flex flex-col gap-3 rounded-[4px] border p-4">
              <p className="text-muted text-sm leading-relaxed">
                {unavailableDetail}
              </p>
              <p className="text-muted text-xs leading-relaxed">
                No builder is shown until the worker is ready, so {tool.name}{" "}
                never pretends to prepare a request it cannot actually package.
              </p>
              <NotifyMe
                toolName={tool.name}
                toolSlug={tool.slug}
                checking={false}
              />
            </div>
          ) : (
            <WorkerStatusPending phase={phase} onRetry={retry} />
          )}
        </WorkerStatusSlot>

        <div className="flex flex-col gap-3">
          <h3 className="text-faint kicker">What happens</h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status ? status.scan.active : null, tool).map(
              (stage, index, all) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <div className="flex flex-col items-center self-stretch">
                    <span className="border-line bg-wash text-muted grid size-8 shrink-0 place-items-center rounded-full border">
                      <PenLine className="size-4" aria-hidden />
                    </span>
                    {index < all.length - 1 && (
                      <span className="bg-wash my-1 w-px flex-1" aria-hidden />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 pb-3">
                    <span className="text-fg text-sm font-medium">
                      {index + 1}. {stage.title}
                    </span>
                    <span className="text-muted text-xs leading-relaxed">
                      {stage.description}
                    </span>
                  </div>
                </li>
              ),
            )}
          </ol>
        </div>

        <div className="bg-panel border-line divide-line divide-y rounded-[4px] border px-4 py-1">
          <SpecRow
            icon={Download}
            label="Output"
            value="ZIP · prepared PDF + manifest"
          />
          <SpecRow
            icon={Timer}
            label="Retention"
            value={`Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`}
          />
          <SpecRow
            icon={ShieldCheck}
            label="Limit"
            value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file`}
          />
        </div>
      </div>
    </div>
  );
}

function SpecRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Download;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-muted inline-flex items-center gap-2 text-sm">
        <Icon className="text-muted size-4" aria-hidden />
        {label}
      </span>
      <span className="text-fg text-right text-sm font-medium">{value}</span>
    </div>
  );
}

/**
 * What the browser learned about the picked PDF, or why it could not.
 *
 * `lock` is what to tell the person when the file is encrypted, `null` when it
 * is not. pdf-lib's `isEncrypted` (`info.encrypted`) is true of ANY /Encrypt
 * entry, so it only says THAT there is a lock; which lock — a password needed
 * to open it, or only its author's editing restrictions — is asked of the same
 * pdf.js probe every in-browser loader uses, and the sentence is that verdict's.
 * This notice used to call every encrypted file "password-protected", while
 * the loader called the same bytes restricted.
 *
 * An UNREADABLE pick carries `lock` too. `readPdfFrames` reads past
 * encryption with pdf-lib, which cannot decrypt, so when the page tree sits in
 * an encrypted object stream — how Acrobat, Word and most PDF 1.5+ writers
 * save an encrypted file — it returns null and never reports the lock. Until
 * 2026-10-08 that pick showed nothing and stayed runnable, so the file was
 * uploaded and refused by the worker, while the page promised the stop came
 * "before anything is uploaded". Such a pick is now asked of pdf.js
 * ({@link lockOfUnreadable}), which does decrypt.
 */
type PickedPdf =
  | { status: "reading" }
  | {
      status: "read";
      bytes: Uint8Array;
      info: PdfFrames;
      lock: string | null;
    }
  | { status: "unreadable"; bytes: Uint8Array | null; lock: string | null };

/** The `/Encrypt` key, as a trailer or an /XRef stream dictionary spells it. */
const ENCRYPT_KEY = new TextEncoder().encode("/Encrypt");

/** Whether `bytes` contain `/Encrypt` ending as a name (not /EncryptMetadata). */
function mentionsEncrypt(bytes: Uint8Array): boolean {
  const last = bytes.length - ENCRYPT_KEY.length;
  outer: for (let i = 0; i <= last; i += 1) {
    for (let k = 0; k < ENCRYPT_KEY.length; k += 1)
      if (bytes[i + k] !== ENCRYPT_KEY[k]) continue outer;
    const next = bytes[i + ENCRYPT_KEY.length];
    if (next === undefined || !/[A-Za-z0-9]/.test(String.fromCharCode(next)))
      return true;
  }
  return false;
}

/**
 * The lock on a PDF pdf-lib could not read, asked of pdf.js: its sentence for
 * a file that needs a password or opens only with restrictions. A file pdf.js
 * cannot open either but whose trailer names /Encrypt (a handler no browser
 * reader decrypts, such as a certificate lock) gets the sentence true of both
 * kinds. `null` for an unencrypted or damaged file, left to the worker, which
 * says what is wrong.
 */
async function lockOfUnreadable(bytes: Uint8Array): Promise<string | null> {
  const access = await classifyPdfAccess(bytes);
  if (access.kind === "password-required")
    return encryptedPdfMessage("needs-password");
  if (access.kind === "restricted")
    return encryptedPdfMessage("opens-without-password");
  if (access.kind === "unreadable" && mentionsEncrypt(bytes))
    return encryptedPdfMessage(null);
  return null;
}

export function RequestBuilder({ refuse }: { refuse: PickRefusal }) {
  const [file, setFile] = useState<File | null>(null);
  const [picked, setPicked] = useState<PickedPdf | null>(null);
  const [signers, setSigners] = useState<SignerDraft[]>([
    { name: "", email: "" },
  ]);
  const [routing, setRouting] = useState<RequestSignatureRouting>("sequential");
  const [page, setPage] = useState(1);
  const [includeDate, setIncludeDate] = useState(true);
  const [title, setTitle] = useState("");
  const job = useWorkerJob<RequestSignaturesWorkerResult>({
    tool: "request-signatures",
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: "request-signatures" }),
  });
  const { busy, outcome, setOutcome, run } = job;

  const cleanSigners = useMemo(
    () =>
      signers
        .map((s) => ({ name: s.name.trim(), email: s.email.trim() }))
        .filter((s) => s.name.length > 0 && EMAIL_SHAPE.test(s.email)),
    [signers],
  );
  const pageCount =
    picked?.status === "read" ? picked.info.frames.length : null;
  const lock =
    picked?.status === "read" || picked?.status === "unreadable"
      ? picked.lock
      : null;
  const encrypted = lock !== null;
  const reading = picked?.status === "reading";
  // An encrypted PDF is refused by the worker (it cannot add fields to a locked
  // file), so the run is blocked here and the unlock route offered instead.
  const canRun =
    file != null && cleanSigners.length > 0 && !busy && !reading && !encrypted;
  // The exact layout the request will carry — the preview draws THIS, not a copy.
  const fields = useMemo(
    () => signatureBlockFields(cleanSigners.length, page, includeDate),
    [cleanSigners.length, page, includeDate],
  );

  // Read the picked PDF in the browser (nothing is uploaded) for its page count
  // and each page's visible frame. The signature page defaults to the LAST page —
  // where a contract's signature block is — instead of the cover. A token drops
  // a slow read that a newer pick has already replaced.
  const pickToken = useRef(0);
  const pickFile = useCallback(
    (next: File | null) => {
      pickToken.current += 1;
      const token = pickToken.current;
      setFile(next);
      setOutcome(null);
      if (!next) {
        setPicked(null);
        return;
      }
      setPicked({ status: "reading" });
      void (async () => {
        let bytes: Uint8Array | null = null;
        try {
          bytes = await readFileBytes(next);
        } catch {
          bytes = null;
        }
        const info = bytes ? await readPdfFrames(bytes) : null;
        const lock = !bytes
          ? null
          : info
            ? info.encrypted
              ? encryptedPdfMessage(await probePdfEncryption(bytes))
              : null
            : await lockOfUnreadable(bytes);
        if (token !== pickToken.current) return;
        if (bytes && info) {
          setPicked({ status: "read", bytes, info, lock });
          setPage(info.frames.length);
        } else {
          setPicked({ status: "unreadable", bytes, lock });
        }
      })();
    },
    [setOutcome],
  );

  const updateSigner = useCallback(
    (index: number, patch: Partial<SignerDraft>) => {
      setSigners((prev) =>
        prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
      );
    },
    [],
  );
  const addSigner = useCallback(() => {
    setSigners((prev) =>
      prev.length >= MAX_REQUEST_SIGNERS
        ? prev
        : [...prev, { name: "", email: "" }],
    );
  }, []);
  const removeSigner = useCallback((index: number) => {
    setSigners((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );
  }, []);

  const start = useCallback(async () => {
    if (!file || cleanSigners.length === 0) return;
    await run(async (controls) => {
      const result = await runWorkerRequestSignatures(
        {
          filename: file.name,
          // The bytes the preview was drawn from, when the pick read them.
          bytes:
            picked?.status === "read"
              ? picked.bytes
              : new Uint8Array(await file.arrayBuffer()),
          signers: cleanSigners,
          // The exact layout the preview draws (`fields` above).
          fields,
          routing,
          ...(title.trim() ? { title: title.trim() } : {}),
        },
        controls,
      );
      return result;
    });
  }, [file, picked, cleanSigners, fields, routing, title, run]);

  return (
    <div className="border-accent/40 bg-accent/10 flex flex-col gap-4 rounded-[4px] border p-4">
      <p className="text-accent flex items-start gap-1.5 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. The worker prepares the
        PDF with real fillable fields and packages the request — it does not
        collect or certify signatures.
      </p>

      {file ? (
        <div className="border-line bg-wash text-fg flex flex-wrap items-center justify-between gap-2 rounded-[3px] border px-3 py-2 text-sm">
          <span className="truncate">{file.name}</span>
          <span className="text-muted flex shrink-0 items-center gap-3 text-xs">
            {reading
              ? "Reading…"
              : pageCount !== null
                ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}`
                : null}
            <button
              type="button"
              onClick={() => pickFile(null)}
              className="text-muted hover:text-fg font-medium transition"
            >
              Remove
            </button>
          </span>
        </div>
      ) : (
        <Dropzone
          refuse={refuse}
          onFiles={(files) => pickFile(files[0] ?? null)}
          accept="application/pdf,.pdf"
          multiple={false}
          compact
          title="Add your PDF, or"
          hint="PDF to send for signature"
        />
      )}

      {/* The verdict's own sentence; ErrorNote adds the link to Unlock PDF. */}
      {lock !== null && <ErrorNote message={lock} />}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-faint kicker inline-flex items-center gap-1.5">
            <Users className="size-3.5" aria-hidden />
            Signers
          </span>
          <button
            type="button"
            onClick={addSigner}
            aria-disabled={signers.length >= MAX_REQUEST_SIGNERS || undefined}
            className="text-accent hover:text-accent inline-flex items-center gap-1 text-xs font-medium transition aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            <Plus className="size-3.5" aria-hidden />
            Add signer
          </button>
        </div>
        {signers.map((signer, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <span className="bg-accent/10 text-accent grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold">
              {index + 1}
            </span>
            <input
              type="text"
              value={signer.name}
              onChange={(e) => updateSigner(index, { name: e.target.value })}
              placeholder="Full name"
              aria-label={`Signer ${index + 1} name`}
              className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent min-w-[8rem] flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
            />
            <input
              type="email"
              value={signer.email}
              onChange={(e) => updateSigner(index, { email: e.target.value })}
              placeholder="email@company.com"
              aria-label={`Signer ${index + 1} email`}
              className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent min-w-[10rem] flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => removeSigner(index)}
              aria-disabled={signers.length <= 1 || undefined}
              aria-label={`Remove signer ${index + 1}`}
              className="text-muted hover:text-err shrink-0 rounded-lg p-1.5 transition aria-disabled:cursor-not-allowed aria-disabled:opacity-30"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-muted flex flex-col gap-1 text-xs">
          Signing order
          <select
            value={routing}
            onChange={(e) =>
              setRouting(e.target.value as RequestSignatureRouting)
            }
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-lg border px-3 py-1.5 text-sm outline-none"
          >
            <option value="sequential">Sequential — one at a time</option>
            <option value="parallel">Parallel — everyone at once</option>
          </select>
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs">
          {pageCount !== null
            ? `Signature page (of ${pageCount})`
            : "Signature page"}
          <input
            type="number"
            min={1}
            max={pageCount ?? undefined}
            value={page}
            onChange={(e) =>
              setPage(clampSignaturePage(Number(e.target.value), pageCount))
            }
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-lg border px-3 py-1.5 text-sm outline-none"
          />
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs sm:col-span-2">
          Request title (optional)
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Master Services Agreement"
            className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-lg border px-3 py-1.5 text-sm outline-none"
          />
        </label>
        <label className="text-muted flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={includeDate}
            onChange={(e) => setIncludeDate(e.target.checked)}
            className="border-line-strong bg-wash size-4 rounded"
          />
          Add a date field next to each signature
        </label>
      </div>

      {picked?.status === "read" &&
        !encrypted &&
        (() => {
          const frame = picked.info.frames[page - 1];
          if (!frame) return null;
          return cleanSigners.length > 0 ? (
            <SignaturePagePreview
              bytes={picked.bytes}
              frame={frame}
              page={page}
              fields={fields}
            />
          ) : (
            <p className="text-muted text-center text-xs">
              Add a signer to preview where their fields go on page {page}.
            </p>
          );
        })()}

      <WorkerRunButton
        onClick={start}
        busy={busy}
        // `canRun` already folds in `!busy`; both go through one blocked branch.
        disabled={!canRun}
        busyLabel={jobBusyLabel(job.phase, "Preparing request…")}
        icon={PenLine}
        tone="violet"
      >
        Prepare signature request
      </WorkerRunButton>

      <WorkerJobStatus job={job} />
      {outcome?.ok === true && (
        <ResultCard announce="Your signature-request package is ready.">
          <p className="text-ok text-sm">
            Your signature-request package is ready — the prepared PDF with
            fillable fields, a manifest, and an audit trail.
          </p>
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
