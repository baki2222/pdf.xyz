import type { ApiError } from "@/lib/jobs/responses";

/**
 * The ONE reader of a failed worker-API response, shared by every browser job
 * client (compression, OCR, the security/Office/HTML/AI runner, and the HTML
 * renderer's own driver). There used to be four copies, and each passed the
 * server's message straight to the UI.
 *
 * THE 429 CASE is why this is shared. The rate-limit and AI-allowance bodies
 * told the user to "retry after the interval in the Retry-After header" and
 * to "See docs/SECURITY.md", while none of the four clients read that header:
 * their response type did not even declare one. A throttled user got
 * developer copy and never the actual wait. The server's sentences are now
 * written for people, and the wait is read HERE, from the header the server
 * already sends, and said in words.
 *
 * The wait is only ever derived from `Retry-After`. It never says "midnight"
 * or "tomorrow": the window is fixed from its first hit, not the calendar.
 */

/** The slice of a response this reader needs. `headers` is optional so test stubs need not carry one. */
export interface ErrorResponseLike {
  status: number;
  json: () => Promise<unknown>;
  headers?: { get(name: string): string | null };
}

export interface WorkerErrorFailure {
  ok: false;
  message: string;
  code?: string;
  /** Present on a 429 that carried a readable `Retry-After`. */
  retryAfterSeconds?: number;
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object" &&
    (value as { error: unknown }).error !== null
  );
}

/** `Retry-After` as whole delta-seconds, or undefined when absent/unreadable. */
export function retryAfterSeconds(res: ErrorResponseLike): number | undefined {
  const raw = res.headers?.get("retry-after")?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * A wait in words, ROUNDED UP so it never tells someone to come back before
 * the limiter will let them: 40 → "about 40 seconds", 125 → "about 3
 * minutes", 11400 → "about 3 h 10 min".
 */
export function describeWait(seconds: number): string {
  if (seconds < 60)
    return `about ${plural(Math.max(1, seconds), "second", "seconds")}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `about ${plural(minutes, "minute", "minutes")}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes - hours * 60;
  return rest === 0
    ? `about ${plural(hours, "hour", "hours")}`
    : `about ${hours} h ${rest} min`;
}

/** Pull an honest message + code out of a non-OK response. */
export async function readWorkerError(
  res: ErrorResponseLike,
  fallback: string,
): Promise<WorkerErrorFailure> {
  let failure: WorkerErrorFailure = { ok: false, message: fallback };
  try {
    const body = await res.json();
    if (isApiError(body)) {
      failure = {
        ok: false,
        message: body.error.message,
        code: body.error.code,
      };
    }
  } catch {
    // Non-JSON error body — keep the fallback.
  }
  if (res.status === 429) {
    const wait = retryAfterSeconds(res);
    if (wait !== undefined) {
      failure = {
        ...failure,
        message: `${failure.message} Try again in ${describeWait(wait)}.`,
        retryAfterSeconds: wait,
      };
    }
  }
  return failure;
}
