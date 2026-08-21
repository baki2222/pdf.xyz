/**
 * Turn an observed refusal from `POST /api/uploads` into a report that names
 * only causes it observed.
 *
 * WHY THIS EXISTS
 * The upload-length probe used to translate EVERY non-2xx reservation into
 * "storage is probably not configured" — a cause it never observed. On
 * 2026-08-20 it printed that sentence about a 429 that `pnpm verify:rate-limit`
 * had just manufactured on purpose (that script proves throttling by exhausting
 * the same `/api/uploads` budget), sending the reader to check storage
 * credentials that were never the problem. That is this product's most-repeated
 * defect — a claim detached from what was measured — sitting in the tooling
 * that checks the product for it.
 *
 * THE PROPERTY
 * A probe may not report a cause it did not observe. Every cause a report
 * below names is licensed by something in the observation: the status code,
 * the typed `error.code` the API contract puts in every error body
 * (`src/lib/jobs/responses.ts`), or a header the server sent. Where nothing
 * licenses a cause, the report states what was observed, says what to do,
 * and declines to guess. `reservation-refusal.test.ts` holds that as a
 * predicate over a corpus, not as per-case copy.
 */

/** Everything the probe actually saw. No field here is inferred. */
export interface ObservedRefusal {
  status: number;
  /** Raw response body text; may be empty or non-JSON (platform pages, proxies). */
  bodyText: string;
  /** The `Retry-After` header, verbatim, if the server sent one. */
  retryAfter: string | null;
}

/**
 * One entry per branch of the classifier. Exported as a value (not only a
 * type) so the test can DISCOVER the branches instead of retyping them —
 * a corpus that stops covering a kind fails loudly rather than shrinking
 * silently.
 */
export const REFUSAL_KINDS = [
  "rate-limited",
  "backend-not-configured",
  "backend-unavailable",
  "auth-refused",
  "request-rejected",
  "server-error",
  "no-slot",
  "unrecognized",
] as const;

export type RefusalKind = (typeof REFUSAL_KINDS)[number];

export interface RefusalReport {
  kind: RefusalKind;
  /** Observed facts first, then the action. Never a cause the input does not license. */
  message: string;
}

/** The typed error body every API error carries: `{ error: { code, message } }`. */
function typedError(
  bodyText: string,
): { code: string; message: string } | null {
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { code?: unknown; message?: unknown };
    };
    if (typeof parsed?.error?.code !== "string") return null;
    return {
      code: parsed.error.code,
      message:
        typeof parsed.error.message === "string" ? parsed.error.message : "",
    };
  } catch {
    return null;
  }
}

/** A short, whitespace-collapsed quote of the body — observed text, never a summary of it. */
function excerpt(bodyText: string): string {
  const collapsed = bodyText.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "(empty body)";
  return collapsed.length > 200 ? `${collapsed.slice(0, 200)}…` : collapsed;
}

/**
 * Render a `Retry-After` value for humans. Delta-seconds get a minutes
 * approximation; an HTTP-date (also legal) is passed through verbatim rather
 * than parsed into a claim the parse could get wrong.
 */
function describeRetryAfter(retryAfter: string): string {
  if (/^\d+$/.test(retryAfter)) {
    const seconds = Number(retryAfter);
    const minutes = Math.ceil(seconds / 60);
    return `${seconds}s (~${minutes} min)`;
  }
  return retryAfter;
}

/**
 * Explain a `POST /api/uploads` response the probe cannot proceed from: any
 * non-2xx status, or a 2xx whose body carried no upload slot (pass such a 2xx
 * here only in that case).
 */
export function explainReservationRefusal(
  observed: ObservedRefusal,
): RefusalReport {
  const typed = typedError(observed.bodyText);
  const observedLine =
    `POST /api/uploads returned ${observed.status}` +
    (typed ? ` with error code "${typed.code}"` : "") +
    `.`;

  // A 2xx reaches this function only when the body had no slot: the acceptance
  // was observed, the slot's absence was observed, and nothing else is known.
  if (observed.status >= 200 && observed.status < 300) {
    return {
      kind: "no-slot",
      message:
        `${observedLine} The request was accepted but the body carried no upload slot ` +
        `in the shape this probe understands ({ slots: [...] }). The response contract ` +
        `has changed; update the probe before trusting anything it prints. ` +
        `Body: ${excerpt(observed.bodyText)}`,
    };
  }

  if (observed.status === 429 || typed?.code === "rate_limited") {
    const wait = observed.retryAfter
      ? `The server says to wait ${describeRetryAfter(observed.retryAfter)} (Retry-After) before this client's budget refills.`
      : `The server sent no Retry-After; the uploads window is an hour, so allow up to that.`;
    return {
      kind: "rate-limited",
      message:
        `${observedLine} This client is rate-limited, so there is nothing to measure ` +
        `right now — the refusal is the limiter refusing this client, and says nothing ` +
        `about anything downstream of it.\n${wait}\n` +
        `Likeliest source: \`pnpm verify:rate-limit\` proves throttling by deliberately ` +
        `exhausting this same /api/uploads budget (up to 65 requests). If it ran recently ` +
        `against this BASE, this refusal is its exhaust. Run the length probe before the ` +
        `rate-limit probe next time, or wait the interval out — this script does not ` +
        `retry on its own.`,
    };
  }

  // The API reserves this code for "no backend wired up at all" — the one case
  // where "not configured" is the server's own statement, not this probe's guess.
  if (typed?.code === "worker_not_configured") {
    return {
      kind: "backend-not-configured",
      message:
        `${observedLine} The server itself reports that no worker/storage backend is ` +
        `configured for this BASE — its words: "${typed.message}" There is nothing to ` +
        `measure; wire up the backend or point BASE at a deployment that has one.`,
    };
  }

  // Distinct from the above by the API's own contract: an upstream is configured
  // and was reached, but failed transiently.
  if (typed?.code === "service_unavailable") {
    return {
      kind: "backend-unavailable",
      message:
        `${observedLine} A configured upstream was reached but failed transiently — the ` +
        `API reserves this code for exactly that, distinct from "worker_not_configured". ` +
        `Retryable: run again shortly. Server message: "${typed.message}"`,
    };
  }

  if (observed.status === 401 || observed.status === 403) {
    return {
      kind: "auth-refused",
      message:
        `${observedLine} The reservation was refused as unauthorized/forbidden. This ` +
        `probe sends nothing to authenticate with, so an auth or access gate in front ` +
        `of this BASE (deployment protection, an edge rule) is answering before the ` +
        `endpoint does. Body: ${excerpt(observed.bodyText)}`,
    };
  }

  if (observed.status >= 400 && observed.status < 500) {
    return {
      kind: "request-rejected",
      message:
        `${observedLine} The endpoint rejected this probe's request itself` +
        (typed
          ? ` — server message: "${typed.message}". `
          : `. Body: ${excerpt(observed.bodyText)}. `) +
        `Likeliest: the request contract changed and the probe's body no longer ` +
        `matches it. Update the probe; nothing was measured.`,
    };
  }

  if (observed.status >= 500) {
    return {
      kind: "server-error",
      message:
        `${observedLine} The server failed while handling the reservation` +
        (typed
          ? ` — its message: "${typed.message}". `
          : `. Body: ${excerpt(observed.bodyText)}. `) +
        `That is a fault at BASE to read from its own logs, and it is not evidence ` +
        `about the size binding either way.`,
    };
  }

  return {
    kind: "unrecognized",
    message:
      `${observedLine} This probe does not recognize that response and will not guess ` +
      `at a cause. Investigate the response itself. Body: ${excerpt(observed.bodyText)}`,
  };
}
