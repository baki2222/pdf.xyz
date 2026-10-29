/**
 * The ONE browser upload of a file to the secure worker: reserve a slot, PUT
 * the bytes to it, and come back with the slot that holds them.
 *
 * WHY THIS EXISTS (production, 2026-10-29). Compression, OCR and the
 * security/Office runner each carried a copy of a bare
 * `fetchImpl(slot.url, …)`: no timeout, no retry, and on failure
 * `readWorkerError(res, "Uploading the file to the worker failed.")`. The slot
 * is a presigned object-storage URL, and storage refuses in XML, not in our
 * JSON error shape — so the reader got only the fallback: no status, no
 * reason, no next step, and one transient 503 ended the run. A phone audit hit
 * it on PDF to Word and Unlock PDF; thirty scripted uploads did not, so the
 * failure is intermittent and a retry is the right first answer.
 *
 * WHAT IT DOES
 *  - Each PUT is bounded by {@link uploadTimeoutMs} (60 s plus time for the
 *    bytes on a slow uplink) and aborted when it runs over.
 *  - A transient outcome — no answer (network), a timeout, or HTTP 408, 429,
 *    500, 502, 503, 504 — is retried ONCE, to the same slot with the same
 *    bytes. That is safe because a PUT is idempotent: the second write
 *    replaces the first. A 429 waits for its `Retry-After` when that is at
 *    most {@link RETRY_AFTER_CAP_SECONDS}; a longer wait is not sat through,
 *    it is reported, with the wait in words.
 *  - A 403 looks like an expired or spent slot: a FRESH slot is reserved once
 *    and the bytes go there. The caller must create its job from the slot this
 *    returns, which is why it returns one.
 *  - Any other refusal (400 and the rest) is final.
 *  - Every failed attempt sends `upload_attempt_failed` — tool, status,
 *    attempt, whether it is retrying, and bucketed size and time. Never the
 *    URL (it is signed), the filename, or a raw number.
 *
 * The caller's own abort is passed through as the AbortError it is: it is
 * not a timeout and is never retried.
 */

import type { UploadSession, UploadSlot } from "@/lib/jobs/types";
import { markUploadStarted } from "@/lib/uploads/session-uploads";
import {
  describeWait,
  readWorkerError,
  retryAfterSeconds,
  type WorkerErrorFailure,
} from "./read-error";
import {
  track,
  uploadAttemptFailedEvent,
  type UploadAttemptStatus,
} from "@/lib/telemetry/track";

/** The slice of `fetch` this needs; every worker client's `FetchLike` fits it. */
export type SlotFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: ArrayBuffer;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers?: { get(name: string): string | null };
}>;

export interface SlotUploadInput {
  /** Tool slug: the upload session is reserved for it, and telemetry names it. */
  tool: string;
  filename: string;
  /** The declared type the server validates the slot against. */
  contentType: string;
  bytes: Uint8Array;
  fetchImpl: SlotFetch;
  signal?: AbortSignal;
  /** Called once, just before the first byte is sent. */
  onUploading?: () => void;
  /** Injectable delay, so a back-off is instant under test. */
  sleep?: (ms: number) => Promise<void>;
  /** Overrides {@link uploadTimeoutMs} for every attempt (tests). */
  timeoutMs?: number;
}

export type SlotUploadResult =
  { ok: true; slot: UploadSlot } | WorkerErrorFailure;

/** Statuses worth one more try: the storage service, not the request, was at fault. */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([
  408, 429, 500, 502, 503, 504,
]);

/** The longest `Retry-After` this waits through before its one retry. */
export const RETRY_AFTER_CAP_SECONDS = 5;

/** The pause before a retry when the answer named no wait. */
const RETRY_DELAY_MS = 1_000;

/** Every PUT gets at least this long. */
const BASE_TIMEOUT_MS = 60_000;

/**
 * The slowest uplink the allowance plans for: 128 KiB/s, about 1 Mbit/s — a
 * weak mobile connection. A 10 MiB file gets 60 s + 80 s.
 */
const SLOW_UPLINK_BYTES_PER_SECOND = 128 * 1024;

/** How long one PUT of `bytes` may take before it is aborted. */
export function uploadTimeoutMs(bytes: number): number {
  return (
    BASE_TIMEOUT_MS +
    Math.ceil(Math.max(0, bytes) / SLOW_UPLINK_BYTES_PER_SECOND) * 1_000
  );
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Copy bytes into a standalone ArrayBuffer — a concrete, portable request body. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

const NOTHING_PROCESSED = "Nothing was processed";

/** The words for a final failure — the kind, the status number, the next step. Never the URL. */
function failureFor(
  status: UploadAttemptStatus,
  wait: number | undefined,
): WorkerErrorFailure {
  if (status === "network") {
    return {
      ok: false,
      code: "network",
      message: `The upload was interrupted — check your connection and try again. ${NOTHING_PROCESSED}.`,
    };
  }
  if (status === "timeout") {
    return {
      ok: false,
      code: "timeout",
      message: `The upload took too long and was stopped — check your connection and try again. ${NOTHING_PROCESSED}.`,
    };
  }
  const lead = `We couldn't upload your file to our secure server (the storage service answered ${status}). ${NOTHING_PROCESSED}`;
  if (status === 429) {
    return {
      ok: false,
      code: "rate_limited",
      message: `${lead} — please try again in ${wait !== undefined ? describeWait(wait) : "a minute"}.`,
      ...(wait !== undefined ? { retryAfterSeconds: wait } : {}),
    };
  }
  if (TRANSIENT_STATUSES.has(status)) {
    return {
      ok: false,
      code: "service_unavailable",
      message: `${lead} — please try again in a minute.`,
    };
  }
  // A refusal of the slot itself (expired, spent, or not what storage
  // expected). A new run reserves a new slot, so trying again is the step.
  return {
    ok: false,
    code: "internal_error",
    message: `${lead} — please try again. If it happens again, reload the page first.`,
  };
}

/** Reserve one slot for exactly this file. */
async function reserveSlot(
  input: SlotUploadInput,
): Promise<{ ok: true; slot: UploadSlot } | WorkerErrorFailure> {
  const body = new TextEncoder().encode(
    JSON.stringify({
      tool: input.tool,
      files: [
        {
          filename: input.filename,
          contentType: input.contentType,
          bytes: input.bytes.byteLength,
        },
      ],
    }),
  );
  const res = await input.fetchImpl("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: toArrayBuffer(body),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!res.ok)
    return readWorkerError(res, "Could not start an upload session.");
  const session = (await res.json()) as UploadSession;
  const slot = session.slots?.[0];
  if (!slot) {
    return { ok: false, message: "The worker did not return an upload slot." };
  }
  return { ok: true, slot };
}

type Attempt =
  | { ok: true }
  | {
      ok: false;
      status: UploadAttemptStatus;
      retryAfter: number | undefined;
    };

/** One PUT, bounded by a timeout. Rethrows only the caller's own abort. */
async function putOnce(
  input: SlotUploadInput,
  slot: UploadSlot,
  body: ArrayBuffer,
): Promise<Attempt> {
  const { signal } = input;
  if (signal?.aborted) throw abortError(signal);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    input.timeoutMs ?? uploadTimeoutMs(input.bytes.byteLength),
  );
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  try {
    const res = await input.fetchImpl(slot.url, {
      method: slot.method,
      headers: slot.headers,
      body,
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    return {
      ok: false,
      status: res.status,
      retryAfter: res.status === 429 ? retryAfterSeconds(res) : undefined,
    };
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    return {
      ok: false,
      status: timedOut ? "timeout" : "network",
      retryAfter: undefined,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

/**
 * Reserve a slot, upload `bytes` to it, and return the slot that holds them —
 * or an honest failure that names the kind of failure and the next step.
 */
export async function uploadToWorkerSlot(
  input: SlotUploadInput,
): Promise<SlotUploadResult> {
  const sleep = input.sleep ?? defaultSleep;
  const reserved = await reserveSlot(input);
  if (!reserved.ok) return reserved;
  let slot = reserved.slot;

  // Flag it before the request, not after: once bytes are on the wire a crash
  // fallback can no longer honestly claim the file never left the device.
  markUploadStarted();
  input.onUploading?.();

  // One body for every attempt: the retry sends exactly the bytes the first
  // attempt sent.
  const body = toArrayBuffer(input.bytes);
  let retried = false;
  let renewed = false;
  for (let attempt = 1; ; attempt += 1) {
    const started = Date.now();
    const result = await putOnce(input, slot, body);
    if (result.ok) return { ok: true, slot };

    const { status, retryAfter } = result;
    const renew = status === 403 && !renewed;
    const transient =
      status === "network" ||
      status === "timeout" ||
      TRANSIENT_STATUSES.has(status);
    const waitTooLong =
      retryAfter !== undefined && retryAfter > RETRY_AFTER_CAP_SECONDS;
    const retry = !renew && transient && !retried && !waitTooLong;

    track(
      uploadAttemptFailedEvent({
        toolSlug: input.tool,
        status,
        attempt,
        retrying: renew || retry,
        bytes: input.bytes.byteLength,
        elapsedMs: Date.now() - started,
      }),
    );

    if (renew) {
      renewed = true;
      const fresh = await reserveSlot(input);
      if (!fresh.ok) return fresh;
      slot = fresh.slot;
      continue;
    }
    if (retry) {
      retried = true;
      await sleep(
        retryAfter !== undefined ? retryAfter * 1_000 : RETRY_DELAY_MS,
      );
      if (input.signal?.aborted) throw abortError(input.signal);
      continue;
    }
    return failureFor(status, retryAfter);
  }
}
