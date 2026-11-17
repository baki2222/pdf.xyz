"use client";

import { usePickRefusal } from "@/components/tools/use-pick";
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
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import {
  MAX_REQUEST_FIELDS,
  MAX_REQUEST_MESSAGE_CHARS,
  MAX_REQUEST_SIGNERS,
  MAX_REQUEST_TITLE_CHARS,
  MAX_SIGNER_EMAIL_CHARS,
  MAX_SIGNER_NAME_CHARS,
  signatureBlockFields,
  signerRowProblem,
  type RequestSignatureRouting,
} from "@/lib/jobs/request-signatures";
import { readPdfFrames, type PdfFrames } from "@/lib/pdf/page-frame";
import { announceOutcome } from "@/components/a11y/live-region";
import {
  classifyPdfAccess,
  encryptedPdfMessage,
  probePdfEncryption,
} from "@/lib/pdf/encryption";
import {
  canRunRequestSignatures,
  requestSignaturesJobOptions,
  runWorkerRequestSignatures,
  type RequestSignaturesWorkerResult,
} from "@/lib/workers/request-signatures-client";
import { downloadBytes, readFileBytes } from "@/lib/pdf/browser";
import type { Tool } from "@/lib/tools/types";
import type { PickRefusal } from "@/lib/uploads/pick-check";
import { formatBytes } from "@/lib/utils";
import {
  DownloadCta,
  Dropzone,
  ErrorNote,
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
 * tallest state is now not-enabled, off 527.5/547px at 360 (Windows/Linux;
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

interface SignerDraft {
  /** Stable for the row's life: boxes are owned by it, never by a position. */
  id: number;
  name: string;
  email: string;
  /** Set once either input of the row loses focus; its problem shows then. */
  touched?: boolean;
}

/** Keep a requested page inside the document (or ≥ 1 while the count is unknown). */
export function clampSignaturePage(
  value: number,
  pageCount: number | null,
): number {
  const whole = Math.floor(Number.isFinite(value) ? value : 1);
  const upper = pageCount ?? Number.POSITIVE_INFINITY;
  return Math.min(upper, Math.max(1, whole));
}

/** The placement editor's chunk: fetched with the PDF read, never with the page. */
type EditorModule = typeof import("./request-field-editor");
type LayoutField = import("./request-field-editor").LayoutField;
const loadEditor = () => import("./request-field-editor");

const TOO_LONG =
  "This request is too long to send. Shorten the message or the labels, or remove some boxes.";

const tooManyBoxes = (count: number) =>
  `A request can hold up to ${MAX_REQUEST_FIELDS} boxes, and this one has ${count}. Remove ${count - MAX_REQUEST_FIELDS} to send it.`;

export function RequestSignaturesWorkerPanel({ tool }: { tool: Tool }) {
  const pickRefuse = usePickRefusal(tool);
  return (
    <WorkerPanelShell
      tool={tool}
      tone="accent"
      engine={{ label: "Signature request", icon: PenLine }}
      description="Our server adds real fillable fields for each signer and returns a signature-request package — the prepared PDF, a manifest, and an audit trail. It prepares and records the request; it never fabricates a signed document, and legally-binding delivery to external signers needs a configured e-signature provider."
      canRun={canRunRequestSignatures}
      specRows={[
        {
          icon: Download,
          label: "You get",
          value: "ZIP · prepared PDF + manifest",
        },
        {
          icon: Timer,
          label: "Your files",
          value: `Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`,
        },
        {
          icon: ShieldCheck,
          label: "Largest file",
          value: `${formatBytes(JOB_LIMITS.maxFileBytes)}/file`,
        },
      ]}
    >
      <RequestBuilder tool={tool} refuse={pickRefuse} />
    </WorkerPanelShell>
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

const RUN_LABEL = "Prepare signature request";

export function RequestBuilder({
  tool,
  refuse,
}: {
  tool: Tool;
  refuse: PickRefusal;
}) {
  const { available, status } = useWorkerPanel();
  const [file, setFile] = useState<File | null>(null);
  const [picked, setPicked] = useState<PickedPdf | null>(null);
  const nextSignerId = useRef(2);
  const [signers, setSigners] = useState<SignerDraft[]>([
    { id: 1, name: "", email: "" },
  ]);
  const [routing, setRouting] = useState<RequestSignatureRouting>("sequential");
  const [page, setPage] = useState(1);
  const [includeDate, setIncludeDate] = useState(true);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  // The placement editor (audit #21): its chunk, the reader's own layout
  // (null while it is still the starting block), the page shown, and one
  // level of undo for the two destructive changes.
  const [editor, setEditor] = useState<EditorModule | null>(null);
  const [custom, setCustom] = useState<LayoutField[] | null>(null);
  const [shownPage, setShownPage] = useState(1);
  // The undo slot. `signers` only when the change removed a signer row: a box
  // Remove or Start over never touched the rows, so Undo must not put back
  // rows edited since (review 2026-11-17: a corrected email was undone with
  // a box). `given` is the set as it stood, so Undo restores it with the
  // layout and a restored custom layout does not hand out a second box.
  const [undo, setUndo] = useState<{
    signers?: SignerDraft[];
    custom: LayoutField[] | null;
    given: Set<number>;
    note: string;
  } | null>(null);
  // Owners already given a box while customised: a signer who removed all of
  // theirs is not handed a new one behind their back.
  const given = useRef(new Set<number>());
  // A removed signer row takes its bin with it; focus goes to a bin that is
  // still there (the row before), never to <body>.
  const signerListRef = useRef<HTMLDivElement | null>(null);
  const focusSignerBin = useRef<number | null>(null);
  useEffect(() => {
    const index = focusSignerBin.current;
    if (index === null) return;
    focusSignerBin.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const bins = signerListRef.current?.querySelectorAll<HTMLButtonElement>(
      "button[data-signer-bin]",
    );
    if (!bins || bins.length === 0) return;
    bins[Math.min(index, bins.length - 1)]!.focus();
  });
  const job = useWorkerJob<RequestSignaturesWorkerResult>({
    tool: "request-signatures",
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: "request-signatures" }),
  });
  const { busy, outcome, setOutcome, run } = job;

  // Each row checked by the worker's own signer rule. A row left wholly
  // blank is not a signer; a row with anything in it either goes in the
  // request or blocks Prepare with its reason — never left out in silence,
  // which until 2026-11-06 (audit #18) sent "b@x,com"'s package one signer
  // short.
  const rowChecks = useMemo(
    () =>
      signers.map((s) => {
        const blank = s.name.trim().length === 0 && s.email.trim().length === 0;
        return { blank, problem: blank ? null : signerRowProblem(s) };
      }),
    [signers],
  );
  const invalidRows = rowChecks.some((row) => row.problem !== null);
  const sent = useMemo(
    () => signers.filter((_, i) => !rowChecks[i]!.blank),
    [signers, rowChecks],
  );
  const cleanSigners = useMemo(
    () => sent.map((s) => ({ name: s.name.trim(), email: s.email.trim() })),
    [sent],
  );
  const ownerIds = useMemo(() => sent.map((s) => s.id), [sent]);
  const ownerIndex = useMemo(
    () => new Map(ownerIds.map((id, i) => [id, i])),
    [ownerIds],
  );
  const rows = useMemo(
    () => signers.map((s, i) => ({ ...s, number: i + 1 })),
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
  // The exact layout the request will carry — the preview draws THIS, not a copy.
  // An invalid row is drawn too: it blocks the run until it is fixed, and is
  // then sent as drawn. Until the reader touches the layout it is literally
  // the starting block, so the default request is byte-identical to the one
  // sent before the editor existed; after, it is the reader's boxes.
  const fields = useMemo(
    () =>
      custom && editor
        ? editor.toRequestFields(custom, ownerIndex)
        : signatureBlockFields(cleanSigners.length, page, includeDate),
    [custom, editor, ownerIndex, cleanSigners.length, page, includeDate],
  );
  // The server refuses job settings over 8 KB at the web tier, after the
  // upload; ten signers, fifty labelled boxes and a long message do not fit.
  // So the EXACT object the client sends is measured here, first.
  const optionBytes = useMemo(
    () =>
      new TextEncoder().encode(
        JSON.stringify(
          requestSignaturesJobOptions({
            signers: cleanSigners,
            fields,
            routing,
            title,
            message,
          }),
        ),
      ).byteLength,
    [cleanSigners, fields, routing, title, message],
  );
  // The box count is checked here too, not only by the Add buttons: any
  // route that grows the layout (a signer's starter box) is held to the
  // worker's own limit before anything is uploaded.
  const blockedBy = invalidRows
    ? null
    : (fields.length > MAX_REQUEST_FIELDS
        ? tooManyBoxes(fields.length)
        : null) ||
      (custom && editor?.layoutProblem(custom, rows, ownerIndex)) ||
      (optionBytes > JOB_LIMITS.maxOptionsBytes ? TOO_LONG : null);
  const canRun =
    file != null &&
    cleanSigners.length > 0 &&
    !invalidRows &&
    !blockedBy &&
    !busy &&
    !reading &&
    !encrypted;

  /** Every layout change; Remove and Start over can be undone, once. */
  const changeLayout = (
    next: LayoutField[] | null,
    change: { say: string; undoable?: boolean },
    prior?: SignerDraft[],
  ) => {
    setUndo(
      change.undoable
        ? {
            ...(prior ? { signers: prior } : {}),
            custom,
            given: new Set(given.current),
            note: change.say,
          }
        : null,
    );
    if (next) for (const f of next) given.current.add(f.owner);
    else given.current.clear();
    setCustom(next);
    if (change.say) announceOutcome(change.say);
  };

  /** Undo the last undoable change: the rows only when it removed one. */
  const undoLast = () => {
    if (!undo) return;
    if (undo.signers) setSigners(undo.signers);
    given.current = new Set(undo.given);
    setCustom(undo.custom);
    setUndo(null);
    announceOutcome("Undone.");
  };

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
      setCustom(null);
      setUndo(null);
      given.current.clear();
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
        // The editor's chunk, requested WITH the read, not after it.
        loadEditor().then(setEditor, () => {});
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
          setShownPage(info.frames.length);
        } else {
          setPicked({ status: "unreadable", bytes, lock });
        }
      })();
    },
    [setOutcome],
  );
  const staged = useStagedHandoff(tool.slug, RUN_LABEL, (files) =>
    pickFile(files[0] ?? null),
  );

  const updateSigner = (index: number, patch: Partial<SignerDraft>) => {
    const next = signers.map((s, i) => (i === index ? { ...s, ...patch } : s));
    setSigners(next);
    // A signer completed while the layout is the reader's own gets one
    // signature box on the page shown, so nobody is sent without a box.
    const row = next[index]!;
    const frame =
      picked?.status === "read" ? picked.info.frames[shownPage - 1] : null;
    if (
      custom &&
      editor &&
      frame &&
      // Never past the worker's box limit: a full layout leaves the signer
      // with no box, which `layoutProblem` then blocks Prepare on in words.
      custom.length < MAX_REQUEST_FIELDS &&
      !given.current.has(row.id) &&
      (row.name.trim() || row.email.trim()) &&
      !signerRowProblem(row)
    )
      changeLayout(editor.addStarterField(custom, row.id, shownPage, frame), {
        say: `Added a Signature box for signer ${index + 1} on page ${shownPage}`,
      });
    // An edit to a row ends Undo's reach, so Undo can never take the edit
    // back with it (a blur that only marks the row touched changes nothing).
    else if ("name" in patch || "email" in patch) setUndo(null);
  };
  const addSigner = () => {
    if (signers.length >= MAX_REQUEST_SIGNERS) return;
    setSigners([
      ...signers,
      { id: nextSignerId.current++, name: "", email: "" },
    ]);
    setUndo(null);
  };
  const removeSigner = (index: number) => {
    if (signers.length <= 1) return;
    const gone = signers[index]!;
    setSigners(signers.filter((_, i) => i !== index));
    focusSignerBin.current = Math.max(0, index - 1);
    const theirs = custom?.filter((f) => f.owner === gone.id).length ?? 0;
    if (custom && theirs > 0)
      changeLayout(
        custom.filter((f) => f.owner !== gone.id),
        {
          say: `Removed signer ${index + 1} and ${theirs === 1 ? "their box" : `their ${theirs} boxes`}`,
          undoable: true,
        },
        signers,
      );
    else setUndo(null);
  };

  const start = useCallback(async () => {
    if (!file || cleanSigners.length === 0 || invalidRows || blockedBy) return;
    if (!available) return;
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
          // The builder trims both, turns control characters into spaces
          // and leaves out a blank one: the object measured above.
          title,
          message,
        },
        controls,
      );
      return result;
    });
  }, [
    file,
    picked,
    cleanSigners,
    invalidRows,
    blockedBy,
    fields,
    routing,
    title,
    message,
    run,
    available,
  ]);

  return (
    <div className="flex flex-col gap-4">
      {staged}
      {file ? (
        <ChosenFileTarget
          file={file}
          accept="application/pdf,.pdf"
          busy={busy}
          refuse={refuse}
          onReplace={(files) => {
            pickFile(files[0] ?? null);
          }}
        >
          <div className="border-line bg-wash text-fg rounded-ctl flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm">
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
                className="text-muted hover:text-fg tap tap-y font-medium transition"
              >
                Remove
              </button>
            </span>
          </div>
        </ChosenFileTarget>
      ) : (
        <Dropzone
          pageTarget
          refuse={refuse}
          onFiles={(files) => pickFile(files[0] ?? null)}
          accept="application/pdf,.pdf"
          multiple={false}
          compact
          title="Add your PDF, or"
          hint="PDF to prepare for signing"
        />
      )}

      {/* The verdict's own sentence; ErrorNote adds the link to Unlock PDF. */}
      {lock !== null && <ErrorNote message={lock} />}

      <div className="flex flex-col gap-2" ref={signerListRef}>
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
        {signers.map((signer, index) => {
          const problem = signer.touched ? rowChecks[index]!.problem : null;
          const errorId = `request-signer-${index + 1}-problem`;
          const fieldProps = (field: "name" | "email") =>
            problem?.field === field
              ? { "aria-invalid": true, "aria-describedby": errorId }
              : {};
          return (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <span className="bg-accent/10 text-accent rounded-tag grid size-6 shrink-0 place-items-center text-xs font-semibold">
                {index + 1}
              </span>
              <input
                type="text"
                value={signer.name}
                onChange={(e) => updateSigner(index, { name: e.target.value })}
                onBlur={() => updateSigner(index, { touched: true })}
                maxLength={MAX_SIGNER_NAME_CHARS}
                {...fieldProps("name")}
                placeholder="Full name"
                aria-label={`Signer ${index + 1} name`}
                className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent rounded-ctl min-w-[8rem] flex-1 border px-3 py-1.5 text-sm outline-none"
              />
              <input
                type="email"
                value={signer.email}
                onChange={(e) => updateSigner(index, { email: e.target.value })}
                onBlur={() => updateSigner(index, { touched: true })}
                maxLength={MAX_SIGNER_EMAIL_CHARS}
                {...fieldProps("email")}
                placeholder="email@company.com"
                aria-label={`Signer ${index + 1} email`}
                className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent rounded-ctl min-w-[10rem] flex-1 border px-3 py-1.5 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => removeSigner(index)}
                aria-disabled={signers.length <= 1 || undefined}
                aria-label={`Remove signer ${index + 1}`}
                data-signer-bin=""
                className="text-muted hover:text-err rounded-ctl tap shrink-0 p-1.5 transition aria-disabled:cursor-not-allowed aria-disabled:opacity-30"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
              {problem && (
                <p id={errorId} className="text-warn basis-full pl-8 text-xs">
                  Signer {index + 1}: {problem.message}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-muted flex flex-col gap-1 text-xs">
          Signing order
          <select
            value={routing}
            onChange={(e) =>
              setRouting(e.target.value as RequestSignatureRouting)
            }
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
          >
            <option value="sequential">Sequential — one at a time</option>
            <option value="parallel">Parallel — everyone at once</option>
          </select>
        </label>
        {/* Once the reader has moved or added boxes, these two would
            silently overwrite that work, so the editor says they no longer
            apply and offers Start over instead. */}
        {!custom && (
          <label className="text-muted flex flex-col gap-1 text-xs">
            {pageCount !== null
              ? `Signature page (of ${pageCount})`
              : "Signature page"}
            <input
              type="number"
              min={1}
              max={pageCount ?? undefined}
              value={page}
              onChange={(e) => {
                const next = clampSignaturePage(
                  Number(e.target.value),
                  pageCount,
                );
                setPage(next);
                setShownPage(next);
              }}
              className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
            />
          </label>
        )}
        <label className="text-muted flex flex-col gap-1 text-xs sm:col-span-2">
          Request title (optional)
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_REQUEST_TITLE_CHARS}
            placeholder="e.g. Master Services Agreement"
            className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
          />
        </label>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="text-muted flex flex-col gap-1 text-xs">
            Message to signers (optional)
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MAX_REQUEST_MESSAGE_CHARS}
              aria-describedby="request-message-hint"
              className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
            />
          </label>
          <p id="request-message-hint" className="text-muted text-xs">
            Written into README.txt and manifest.json. Nobody is emailed. Line
            breaks become spaces. {message.length.toLocaleString("en-US")} of{" "}
            {MAX_REQUEST_MESSAGE_CHARS.toLocaleString("en-US")} characters
          </p>
        </div>
        {!custom && (
          <label className="text-muted flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={includeDate}
              onChange={(e) => setIncludeDate(e.target.checked)}
              className="border-line-strong bg-wash rounded-ctl size-4"
            />
            Add a date field next to each signature
          </label>
        )}
      </div>

      {picked?.status === "read" &&
        !encrypted &&
        (() => {
          const frame = picked.info.frames[shownPage - 1];
          if (!frame) return null;
          if (!custom && cleanSigners.length === 0)
            return (
              <p className="text-muted text-center text-xs">
                Add a signer to preview where their fields go on page {page}.
              </p>
            );
          return editor ? (
            <editor.RequestFieldEditor
              bytes={picked.bytes}
              frames={picked.info.frames}
              signers={rows}
              ownerIds={ownerIds}
              page={page}
              includeDate={includeDate}
              custom={custom}
              onCustom={(next, change) => changeLayout(next, change)}
              shownPage={shownPage}
              onShownPage={setShownPage}
              note={undo?.note ?? null}
              onUndo={undo ? undoLast : null}
            />
          ) : (
            // Still, in the page's own shape, while the editor's chunk arrives.
            <div
              className="bg-wash rounded-sheet w-full self-center"
              style={{
                aspectRatio: `${frame.width} / ${frame.height}`,
                maxWidth: 420,
              }}
            />
          );
        })()}

      {blockedBy && <p className="text-warn text-xs">{blockedBy}</p>}

      <WorkerGate
        reserve={STATUS_SLOT}
        job={job}
        bytes={file?.size}
        run={(ready) => (
          <WorkerRunButton
            onClick={start}
            busy={busy}
            // `canRun` already folds in `!busy`; both go through one blocked branch.
            disabled={!ready || !canRun}
            busyLabel={jobBusyLabel(job.phase, "Preparing request…")}
            icon={PenLine}
          >
            {RUN_LABEL}
          </WorkerRunButton>
        )}
        jobStatus={<WorkerJobStatus job={job} />}
        note={
          <p className="text-accent flex items-start gap-1.5 text-xs leading-relaxed">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Your PDF uploads to a private secure-server job only when you press{" "}
            {RUN_LABEL}. Our server prepares the PDF with real fillable fields
            and packages the request — it does not collect or certify
            signatures.
          </p>
        }
        off={
          <>
            <p className="text-muted text-sm leading-relaxed">
              {status?.daemon.detail ??
                "Our secure server is not drainable here."}
            </p>
            <p className="text-muted text-xs leading-relaxed">
              {RUN_LABEL} stays off until our server is ready, so {tool.name}{" "}
              never pretends to prepare a request it cannot actually package.
            </p>
          </>
        }
      />
      {outcome?.ok === true && (
        <ResultCard
          announce="Your signature-request package is ready."
          output={workerOutput(outcome.output, outcome.artifact)}
          inputBytes={file?.size}
        >
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
