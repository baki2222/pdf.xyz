/**
 * The property under test: a probe may not report a cause it did not observe.
 *
 * INVERTED, NOT DELETED — the shipped sentence this file exists to prevent:
 *
 *   "POST /api/uploads returned 429. Storage is probably not configured for
 *    this BASE, so there is nothing to measure."
 *
 * printed by `scripts/verify-upload-length-binding.ts` about a production 429
 * on 2026-08-20 (TASK-70). The 429 was real and structural: `pnpm
 * verify:rate-limit` had just proved throttling by exhausting the same
 * `/api/uploads` budget, so running the two probes in the obvious order
 * guaranteed the second printed the wrong cause and sent the reader to check
 * storage credentials that were never the problem. The old message named one
 * cause for every status alike; the tests below hold the replacement to the
 * property itself, not to per-case copy.
 *
 * The corpus's error bodies are built with the API's own `apiError` builder —
 * the same function the route serializes (`src/app/api/_lib/http.ts`) — so the
 * corpus tracks the real contract rather than a hand-typed imitation of it.
 *
 * The corpus caught this rewrite's author on its first run, as the house style
 * predicts: the 403 report originally said the probe "sends no credentials",
 * and /credential/ is a storage-cause claim a 403 does not license. The
 * message was reworded; the pattern was not loosened.
 */

import { describe, expect, it } from "vitest";
import { apiError, WORKER_NOT_CONFIGURED_MESSAGE } from "@/lib/jobs";
import {
  explainReservationRefusal,
  REFUSAL_KINDS,
  type ObservedRefusal,
  type RefusalKind,
} from "./reservation-refusal";

/** Serialize an `apiError` exactly the way `respond()` puts it on the wire. */
function wire(
  ...args: Parameters<typeof apiError>
): Pick<ObservedRefusal, "status" | "bodyText"> {
  const result = apiError(...args);
  return { status: result.status, bodyText: JSON.stringify(result.body) };
}

interface Case {
  name: string;
  observed: ObservedRefusal;
  expectKind: RefusalKind;
}

const CORPUS: Case[] = [
  {
    // The production observation of 2026-08-20, verbatim numbers.
    name: "429 rate_limited with Retry-After 2328 (verify:rate-limit exhaust)",
    observed: {
      ...wire("rate_limited", "Too many requests. Try again later."),
      retryAfter: "2328",
    },
    expectKind: "rate-limited",
  },
  {
    name: "429 with an empty body and no Retry-After (a limiter in front of the app)",
    observed: { status: 429, bodyText: "", retryAfter: null },
    expectKind: "rate-limited",
  },
  {
    name: "429 with an HTTP-date Retry-After",
    observed: {
      status: 429,
      bodyText: "",
      retryAfter: "Wed, 20 Aug 2026 12:00:00 GMT",
    },
    expectKind: "rate-limited",
  },
  {
    name: "503 worker_not_configured (the server names the missing backend itself)",
    observed: {
      ...wire("worker_not_configured", WORKER_NOT_CONFIGURED_MESSAGE),
      retryAfter: null,
    },
    expectKind: "backend-not-configured",
  },
  {
    name: "503 service_unavailable (configured upstream failed transiently)",
    observed: {
      ...wire("service_unavailable", "Upstream temporarily unavailable."),
      retryAfter: null,
    },
    expectKind: "backend-unavailable",
  },
  {
    // The uploads path maps a reachable-but-failing storage backend to a typed
    // internal_error 500 (`src/lib/workers/storage/errors.ts`), not to
    // service_unavailable — so a typed 5xx must land here too.
    name: "500 internal_error with a typed body (reachable backend errored)",
    observed: {
      ...wire("internal_error", "Unexpected error reserving the upload."),
      retryAfter: null,
    },
    expectKind: "server-error",
  },
  {
    name: "403 with an HTML body (an access gate in front of the endpoint)",
    observed: {
      status: 403,
      bodyText: "<html><body>Authentication Required</body></html>",
      retryAfter: null,
    },
    expectKind: "auth-refused",
  },
  {
    name: "401 with an empty body",
    observed: { status: 401, bodyText: "", retryAfter: null },
    expectKind: "auth-refused",
  },
  {
    name: "400 invalid_request (the probe's body no longer matches the contract)",
    observed: {
      ...wire("invalid_request", "Request body must be valid JSON."),
      retryAfter: null,
    },
    expectKind: "request-rejected",
  },
  {
    name: "500 with a platform HTML page (no typed body at all)",
    observed: {
      status: 500,
      bodyText: "<html>Internal Server Error</html>",
      retryAfter: null,
    },
    expectKind: "server-error",
  },
  {
    name: "200 whose body carries no slot (the response shape changed)",
    observed: {
      status: 200,
      bodyText: JSON.stringify({ ok: true }),
      retryAfter: null,
    },
    expectKind: "no-slot",
  },
  {
    name: "302 redirect (nothing this probe recognizes)",
    observed: { status: 302, bodyText: "", retryAfter: null },
    expectKind: "unrecognized",
  },
];

/** The typed `error.code`, when the observation carries one — what a report may cite. */
function codeOf(observed: ObservedRefusal): string | null {
  try {
    const parsed = JSON.parse(observed.bodyText) as {
      error?: { code?: unknown };
    };
    return typeof parsed?.error?.code === "string" ? parsed.error.code : null;
  } catch {
    return null;
  }
}

/**
 * Each entry is a cause a report could send a reader to chase, with the
 * predicate that licenses naming it. A report may match a pattern only when
 * its input licenses that cause — and every pattern must fire on at least one
 * corpus case, or the pattern is decoration (a ban list needs a corpus in
 * both directions).
 */
const CAUSE_CLAIMS: Array<{
  cause: string;
  pattern: RegExp;
  licensed: (observed: ObservedRefusal) => boolean;
}> = [
  {
    cause: "something is not configured",
    pattern: /configur/i,
    licensed: (o) =>
      codeOf(o) === "worker_not_configured" ||
      codeOf(o) === "service_unavailable",
  },
  {
    cause: "storage or its credentials are implicated",
    pattern: /storage|credential|\bR2\b/i,
    licensed: (o) => codeOf(o) === "worker_not_configured",
  },
  {
    cause: "the client is rate-limited",
    pattern: /rate.?limit|retry-after|throttl/i,
    licensed: (o) => o.status === 429 || codeOf(o) === "rate_limited",
  },
  {
    cause: "auth or an access gate refused it",
    pattern: /unauthoriz|forbidden|auth/i,
    licensed: (o) => o.status === 401 || o.status === 403,
  },
  {
    cause: "the server itself failed",
    pattern: /server failed|its own logs/i,
    licensed: (o) =>
      o.status >= 500 &&
      codeOf(o) !== "worker_not_configured" &&
      codeOf(o) !== "service_unavailable",
  },
];

describe("explainReservationRefusal", () => {
  // Corpus health: every branch the classifier can take is exercised, so a
  // branch nothing reaches cannot hide, and the corpus cannot silently shrink
  // below the classifier it is supposed to cover.
  it("exercises every refusal kind (positive control for the corpus)", () => {
    const covered = new Set(CORPUS.map((c) => c.expectKind));
    expect([...covered].sort()).toEqual([...REFUSAL_KINDS].sort());
    expect(CORPUS.length).toBeGreaterThanOrEqual(REFUSAL_KINDS.length);
  });

  it.each(CORPUS)("classifies: $name", ({ observed, expectKind }) => {
    const report = explainReservationRefusal(observed);
    expect(report.kind).toBe(expectKind);
    // Every report leads with the observed fact, not with an interpretation.
    expect(report.message).toMatch(
      new RegExp(`^POST /api/uploads returned ${observed.status}`),
    );
  });

  // THE PROPERTY. Direction one: no report names a cause its input does not
  // license. Direction two: every licensed cause pattern fires somewhere, so
  // none of these regexes is decoration.
  it("never names a cause the observation does not license", () => {
    for (const { name, observed } of CORPUS) {
      const { message } = explainReservationRefusal(observed);
      for (const claim of CAUSE_CLAIMS) {
        if (claim.pattern.test(message)) {
          expect(
            claim.licensed(observed),
            `case "${name}" claims "${claim.cause}" without observing it:\n${message}`,
          ).toBe(true);
        }
      }
    }
  });

  it("each cause pattern fires on at least one corpus case", () => {
    for (const claim of CAUSE_CLAIMS) {
      const fired = CORPUS.some((c) =>
        claim.pattern.test(explainReservationRefusal(c.observed).message),
      );
      expect(fired, `pattern for "${claim.cause}" catches nothing`).toBe(true);
    }
  });

  // The pinned defect, inverted: a 429 licenses no claim about storage or
  // configuration, in either direction — "storage is fine" is as unobserved
  // as "storage is broken".
  it("never blames storage or configuration for a 429", () => {
    for (const c of CORPUS.filter((c) => c.observed.status === 429)) {
      const { message } = explainReservationRefusal(c.observed);
      expect(message).not.toMatch(/storag|configur|credential/i);
      expect(message).toMatch(/rate.?limit/i);
    }
  });

  it("surfaces the observed Retry-After and the structural source of a 429", () => {
    // Found by its distinguishing observation, not by position: the corpus
    // case carrying the production Retry-After of 2026-08-20.
    const production = CORPUS.find((c) => c.observed.retryAfter === "2328");
    expect(production).toBeDefined();
    const { message } = explainReservationRefusal(production!.observed);
    // Surfacing a number is a new claim: the observed 2328 must appear, with
    // the minutes rendering derived from it (ceil(2328 / 60) = 39).
    expect(message).toContain("2328s (~39 min)");
    // The structural cause the reader must know: the sibling probe exhausts
    // this same budget by design, and this script will not retry on its own.
    expect(message).toContain("verify:rate-limit");
    expect(message).toMatch(/does not retry/i);
  });

  it("passes an HTTP-date Retry-After through verbatim instead of parsing it", () => {
    const httpDate = CORPUS.find(
      (c) => c.observed.retryAfter === "Wed, 20 Aug 2026 12:00:00 GMT",
    );
    expect(httpDate).toBeDefined();
    const { message } = explainReservationRefusal(httpDate!.observed);
    expect(message).toContain("Wed, 20 Aug 2026 12:00:00 GMT");
  });

  it("quotes the server's own message when the body carries one", () => {
    const typed = explainReservationRefusal({
      ...wire("invalid_request", "Request body must be valid JSON."),
      retryAfter: null,
    });
    expect(typed.message).toContain("Request body must be valid JSON.");
  });

  it("reports the server's own words for worker_not_configured", () => {
    const report = explainReservationRefusal({
      ...wire("worker_not_configured", WORKER_NOT_CONFIGURED_MESSAGE),
      retryAfter: null,
    });
    expect(report.message).toContain(WORKER_NOT_CONFIGURED_MESSAGE);
  });
});
