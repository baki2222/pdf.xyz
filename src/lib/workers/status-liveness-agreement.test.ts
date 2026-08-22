// @vitest-environment node
/**
 * ONE payload may not answer "is a worker alive?" two different ways.
 *
 * `/api/worker/status` shipped a `daemon.detail` ending "whether a worker daemon
 * is actually running is out-of-band and not observable here" while, two fields
 * above it in the same JSON, `ocr.available` and `scan.active` were derived from
 * an observed liveness heartbeat. Measured on production, both in one response:
 *
 *   "ocr":{"available":true,"detail":"... reports it enabled in its liveness heartbeat"}
 *   "daemon":{"detail":"... is out-of-band and not observable here"}
 *
 * Neither sentence is wrong on its own. The sentence was true when it was
 * written — heartbeats did not exist yet — and went false underneath when they
 * shipped. That is this product's most-repeated defect, and no test of either
 * field could catch it, because the falsehood lives in the DISAGREEMENT.
 *
 * `workerObserved` was on the line above the call that needed it and was not
 * passed: a capability present everywhere except where it was consumed.
 *
 * So this asserts the relationship, in both directions, over a payload built by
 * the real builder rather than a fixture.
 */
import { describe, expect, it } from "vitest";
import { buildWorkerStatus } from "./status";
import { resolveWorkerMode } from "./mode";
import { REDIS_QUEUE_ENV, REDIS_PROVIDER_VALUES } from "./queue/redis-config";
import { S3_ENV, S3_PROVIDER_VALUE } from "./storage/s3-config";

/**
 * A production-shaped environment, with the variable NAMES derived from the
 * config modules rather than typed here.
 *
 * They were typed the first time, and two of them were wrong — the queue reads
 * PDFXYZ_REDIS_REST_URL, not UPSTASH_REDIS_REST_URL — so `drainable` was false,
 * `describe()` never reached the branch under test, and the rule below passed
 * VACUOUSLY on the one field it exists for. The mutation proved it: restoring
 * the defective sentence left every assertion green.
 */
const DRAINABLE: Record<string, string> = {
  [REDIS_QUEUE_ENV.provider]: REDIS_PROVIDER_VALUES[0],
  [REDIS_QUEUE_ENV.restUrl]: "https://example.upstash.io",
  // Shaped like the real thing, and obviously not one: the parsers reject a
  // short placeholder with "Malformed REST token", which silently un-drains the
  // fixture.
  [REDIS_QUEUE_ENV.restToken]: "A".repeat(64),
  [S3_ENV.provider]: S3_PROVIDER_VALUE,
  [S3_ENV.endpoint]: "https://example.r2.cloudflarestorage.com",
  [S3_ENV.region]: "auto",
  [S3_ENV.bucket]: "bucket",
  [S3_ENV.accessKeyId]: "EXAMPLEACCESSKEYID00",
  [S3_ENV.secretAccessKey]: "B".repeat(40),
};

/** Phrases that assert liveness cannot be seen from here. Shapes, not one spelling. */
const DENIES_OBSERVABILITY = [
  // The historical sentence: liveness CANNOT be seen from here.
  /not observable here/i,
  /cannot (?:see|observe|tell) whether a worker/i,
  /no way to (?:see|observe|know) whether a worker/i,
  // And the sentence that replaced it, which is a different claim with the same
  // failure mode: liveness IS observable and nothing is alive. Wrong in a
  // payload whose other fields are reporting a live heartbeat.
  //
  // This second family was missing on the first pass, and a mutation neutering
  // the affirmative branch stayed GREEN because of it — the guard only knew the
  // one spelling the bug happened to arrive in. One spelling of a shape is not
  // the shape.
  /\bno worker daemon(?:'s)? (?:liveness heartbeat )?is (?:being )?(?:observed|reporting)/i,
  /no worker daemon is (?:currently )?(?:alive|running|observed)/i,
];

/**
 * Phrases that assert liveness IS being seen.
 *
 * Anchored to the AFFIRMATIVE article on purpose. The first draft matched the
 * bare phrase "liveness heartbeat is being observed", which also matches "NO
 * worker daemon's liveness heartbeat is being observed" — the sentence that says
 * the opposite. A phrase match cannot see a negation in front of it, so the
 * article carries the polarity here and the two real sentences differ by exactly
 * that word.
 */
const CLAIMS_OBSERVED = [
  /\ba worker daemon's liveness heartbeat is being observed/i,
  /which reports it enabled in its liveness heartbeat/i,
];

function status(observed: boolean) {
  // The mode is DERIVED from the same env the payload is built from, not
  // typed. Typing it produced "secure-worker", which is not a WorkerMode at all
  // — the union is disabled | remote-configured | local-dev — and only tsc saw
  // it; every assertion here ran happily against the invented value.
  return buildWorkerStatus(
    resolveWorkerMode(DRAINABLE),
    undefined,
    undefined,
    { ...DRAINABLE },
    undefined,
    observed,
    /* workerOcr */ observed,
    /* workerScan */ observed,
  );
}

/** Every string the payload puts in front of a reader, discovered not listed. */
function sentences(
  value: unknown,
  path = "$",
): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value))
    return value.flatMap((v, i) => sentences(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) =>
      sentences(v, `${path}.${k}`),
    );
  return [];
}

describe("one payload, one answer about worker liveness", () => {
  it("the payload carries enough prose for the rule to mean anything", () => {
    // Every assertion below filters this list. An empty or collapsed payload
    // satisfies all of them vacuously and reports the strongest possible pass.
    const observed = sentences(status(true));
    const dark = sentences(status(false));
    // THE precondition this whole file rests on: the daemon block must actually
    // be in its drainable branch. Without it `describe()` returns "neither the
    // queue nor object storage is configured" and the rule below inspects a
    // sentence that cannot contain the defect. This assertion is the one that
    // was missing when a mutation restoring the defect left every test green.
    expect(
      status(true).daemon.drainable,
      "fixture is not drainable, so the rule below is vacuous",
    ).toBe(true);
    expect(status(false).daemon.drainable).toBe(true);
    expect(observed.length).toBeGreaterThanOrEqual(8);
    expect(dark.length).toBeGreaterThanOrEqual(8);
    // Positive control on the predicates themselves: the "no worker observed"
    // payload MUST contain at least one sentence the observed one does not, or
    // the two branches are indistinguishable and the rule below is empty.
    const observedText = observed.map((s) => s.text).join("\n");
    const darkText = dark.map((s) => s.text).join("\n");
    expect(observedText).not.toEqual(darkText);
  });

  it("does not deny observability while another field reports an observed heartbeat", () => {
    const all = sentences(status(true));
    const denies = all.filter((s) =>
      DENIES_OBSERVABILITY.some((re) => re.test(s.text)),
    );
    const claims = all.filter((s) =>
      CLAIMS_OBSERVED.some((re) => re.test(s.text)),
    );
    // The premise: something in this payload really is reporting an observed
    // heartbeat. Without it the check below is vacuous.
    expect(
      claims.map((c) => c.path),
      `no field claims an observed heartbeat, so this rule proves nothing`,
    ).not.toEqual([]);
    expect(
      denies.map((d) => `${d.path}: ${d.text}`),
      `these fields deny observability while ${claims.map((c) => c.path).join(", ")} report it`,
    ).toEqual([]);
  });

  it("does not report a capability as available when no heartbeat was observed", () => {
    const dark = status(false);
    expect(dark.ocr.available).toBe(false);
    expect(dark.scan.active).toBe(false);
    // And the daemon must say so rather than implying a running worker.
    const all = sentences(dark);
    const claims = all.filter((s) =>
      CLAIMS_OBSERVED.some((re) => re.test(s.text)),
    );
    expect(
      claims.map((c) => `${c.path}: ${c.text}`),
      "no heartbeat was observed, so nothing may claim one is",
    ).toEqual([]);
  });
});
