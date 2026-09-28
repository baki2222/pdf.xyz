// @vitest-environment node
/**
 * The acceptance condition: this must fail on the state we were actually in.
 *
 * On 2026-08-21, `main` was at `f0c2c13`, the running worker image had been
 * built on 2026-08-12, and the FAQ advertised chunked translation the worker
 * could not do. Every subsystem read green for nine days. **A guard that
 * classifies a hypothetical is worth nothing here; it has to classify THAT.**
 *
 * ── THE SUBJECT IS THE REAL OLD RECORD, NOT A HAND-TYPED ONE ────────────────
 *
 * The 2026-08-12 image was built from `a7a49a5`, whose `serializeHeartbeat`
 * emits exactly five capability keys and has no idea the two advertised ones
 * exist. That key set is not invented here — it is read out of that commit
 * whenever git has the history, and the vendored copy below is what the
 * derivation produced.
 *
 * ── WHY A VENDORED COPY AT ALL ──────────────────────────────────────────────
 *
 * `actions/checkout@v4` clones to depth 1 and `ci.yml` sets no `fetch-depth`,
 * so `git show a7a49a5:…` is unavailable in CI. A test that needed it would be
 * red there; one that skipped when it was missing would be a vacuous pass
 * wearing an acceptance test's name.
 *
 * So the split is explicit: the CLASSIFICATION assertion — a record without
 * these keys is `blocked` — runs everywhere and is the thing that had to be
 * true this morning. The PROVENANCE assertion re-derives the key set from the
 * real commit and runs wherever history is present (every dev machine, and CI
 * the day it deepens). When history is absent the run says so rather than
 * implying it checked.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  ADVERTISED_WORKER_CAPABILITIES,
  collectWebOperationsSnapshot,
} from "./index";
import type { HeartbeatLiveness } from "../heartbeat";
import { parseHeartbeat } from "../heartbeat/schema";

/**
 * The commit the running image was built from, and the date that makes it
 * meaningful. Pinned as an artifact of record; the date is asserted so a SHA
 * that ever means something else says so instead of quietly passing.
 */
const OLD_IMAGE_COMMIT = "a7a49a59ae699094cae27aa165a139a18b3708dc";
const OLD_IMAGE_DATE = "2026-08-12";

/**
 * The capability keys `serializeHeartbeat` emitted at that commit — the whole
 * vocabulary the running worker had. Derived, then vendored so a shallow CI
 * checkout can still run the classification below.
 */
const OLD_CAPABILITY_KEYS = [
  "deepCompression",
  "ocr",
  "ocrLanguages",
  "malwareScan",
  "atomicQueue",
] as const;

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", `${OLD_IMAGE_COMMIT}^{commit}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** The record that worker would actually have published. */
function oldWorkerRecord(): string {
  return JSON.stringify({
    v: 1,
    role: "secure-worker",
    mode: "loop",
    capabilities: Object.fromEntries(
      OLD_CAPABILITY_KEYS.map((key) => [
        key,
        key === "ocrLanguages" ? ["eng"] : true,
      ]),
    ),
    at: Date.now(),
  });
}

function livenessFrom(serialized: string): HeartbeatLiveness {
  const parsed = parseHeartbeat(serialized);
  expect(
    parsed,
    "today's parser rejected the 2026-08-12 record outright — it would read as " +
      "no worker at all, which is a different (and less honest) failure",
  ).not.toBeNull();
  return {
    state: "observed",
    observed: true,
    source: "queue-broker",
    lastSeen: "under-30s",
    mode: "loop",
    capabilities: parsed!.capabilities,
    fingerprint: parsed!.fingerprint ?? null,
    detail: "content-free",
  };
}

const DRAINABLE_ENV = {
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "pdfxyz-store",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: "s3-secret-value-1234567890",
  PDFXYZ_QUEUE_PROVIDER: "redis",
  PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
  PDFXYZ_REDIS_REST_TOKEN: "redis-rest-token-1234",
} as const;

describe("the 2026-08-12 worker, as it actually was", () => {
  it("is reported BLOCKED, naming what it cannot do", () => {
    const snapshot = collectWebOperationsSnapshot(DRAINABLE_ENV, {
      daemonLiveness: livenessFrom(oldWorkerRecord()),
    });
    const row = snapshot.subsystems.find((s) => s.id === "worker-capability");

    expect(
      row?.health,
      "the exact worker that was running this morning — alive, drainable, " +
        "beating, and missing the engine the FAQ described — still reads as " +
        "acceptable. This guard does not catch the thing it was built for.",
    ).toBe("blocked");
    expect(row?.detail).toContain("chunked translation");
    expect(row?.detail).toContain("delivery cap");

    /**
     * AND IT CANNOT SAY WHICH BUILD, WHICH IS ALSO THE REAL STATE.
     *
     * That image predates the fingerprint field entirely, so it publishes none
     * — and an image old enough to lack the field is itself the signal. The
     * row must say that rather than leave a blank, because a blank reads as
     * "nothing to report" and the last time this question came up it cost an
     * ssh session and a grep, answered wrongly on the first attempt.
     *
     * Asserted HERE, on the historical record, rather than only on a
     * constructed one: this is the single place that describes the state we
     * were actually in, and it should describe all of it.
     */
    expect(
      row?.detail,
      "the 2026-08-12 worker's row does not say it could not read a build " +
        "fingerprint — the absence is information and it is being dropped",
    ).toMatch(/no build fingerprint/i);
  });

  it("and is NOT reported as merely unknown", () => {
    // The distinction that matters. "No worker answered" was already
    // survivable; this worker answered, in detail, and was wrong. Collapsing
    // the two would put the nine days back in the same bucket as a quiet
    // broker.
    const row = collectWebOperationsSnapshot(DRAINABLE_ENV, {
      daemonLiveness: livenessFrom(oldWorkerRecord()),
    }).subsystems.find((s) => s.id === "worker-capability");
    expect(row?.health).not.toBe("unknown");
    expect(row?.health).not.toBe("ok");
  });

  it("CONTROL: today's worker, with the same record plus the proofs, is OK", () => {
    // The other direction, or the test above would pass on a subsystem that
    // says `blocked` unconditionally.
    const current = JSON.stringify({
      ...JSON.parse(oldWorkerRecord()),
      capabilities: {
        ...JSON.parse(oldWorkerRecord()).capabilities,
        chunkedTranslate: true,
        deliveryCap: true,
        aiReadCap: true,
      },
    });
    const row = collectWebOperationsSnapshot(DRAINABLE_ENV, {
      daemonLiveness: livenessFrom(current),
    }).subsystems.find((s) => s.id === "worker-capability");
    expect(row?.health).toBe("ok");
  });

  it("PROVENANCE: the vendored key set is what that commit really emitted", () => {
    if (!gitAvailable()) {
      // Not a skip and not a pass: an explicit statement that this run could
      // not check provenance, so nobody reads the file's green as covering it.
      expect(
        OLD_CAPABILITY_KEYS.length,
        "git history for the old commit is unavailable (a shallow checkout), " +
          "so the vendored key set was NOT re-derived in this run — the " +
          "classification above still ran",
      ).toBeGreaterThan(0);
      return;
    }

    const date = execFileSync(
      "git",
      ["show", "-s", "--format=%ad", "--date=short", OLD_IMAGE_COMMIT],
      { encoding: "utf8" },
    ).trim();
    expect(
      date,
      `${OLD_IMAGE_COMMIT} is no longer the 2026-08-12 commit, so the record ` +
        "below describes a worker nobody was running",
    ).toBe(OLD_IMAGE_DATE);

    const oldSchema = execFileSync(
      "git",
      ["show", `${OLD_IMAGE_COMMIT}:src/lib/workers/heartbeat/schema.ts`],
      { encoding: "utf8" },
    );
    const emitted = /capabilities:\s*\{([^}]*)\}/.exec(
      oldSchema.slice(oldSchema.indexOf("export function serializeHeartbeat")),
    )?.[1];
    expect(
      emitted,
      "could not read the old serializer's capability block",
    ).toBeTruthy();

    const keys = [...emitted!.matchAll(/(\w+):/g)].map((m) => m[1]!);
    expect(
      keys.sort(),
      "the vendored key set is not what that commit emitted",
    ).toEqual([...OLD_CAPABILITY_KEYS].sort());

    /**
     * ── THIS ASSERTION USED TO PIN THE DEFECT ─────────────────────────────────
     *
     * It read: for EVERY advertised capability, that commit could not publish
     * it. True of a corpus that was exactly the two capabilities added after
     * that commit — and it silently required the corpus to stay that way, since
     * the five capabilities `a7a49a5` already published would each have failed
     * it. A test whose green depends on a corpus never growing is a test that
     * argues against growing it.
     *
     * Inverted on 2026-08-22 rather than deleted, into the two propositions the
     * old one conflated:
     *
     *  - the deploy gap is still the one being tested — at least one advertised
     *    capability was NOT publishable at that commit, or this file is
     *    describing some other worker's problem;
     *  - the corpus did not lose anyone — every capability that commit already
     *    published is still asked about today. That direction is new, and it is
     *    the one that was missing while five of them went unasked.
     */
    const unpublishable = ADVERTISED_WORKER_CAPABILITIES.filter(
      (capability) => !keys.includes(capability.key),
    ).map((capability) => capability.key);
    expect(
      unpublishable,
      `every advertised capability was already publishable at ${OLD_IMAGE_COMMIT}, ` +
        "so the deploy gap this guard exists for is not the one being tested",
    ).not.toHaveLength(0);

    const advertised = ADVERTISED_WORKER_CAPABILITIES.map((c) => c.key);
    for (const key of keys) {
      expect(
        advertised,
        `${key} was publishable at ${OLD_IMAGE_COMMIT} and is not in today's ` +
          "corpus — the subsystem stopped asking about a capability workers " +
          "have been answering for months, and will report every image healthy " +
          "without it",
      ).toContain(key);
    }
  });
});

describe("the build fingerprint reaches the operator, or says it could not", () => {
  /**
   * A published value nothing reads is the `writeSpendProbe` defect: built,
   * merged, deployed, and called by nothing, while every unit test stayed
   * green. So the assertion is not "the worker publishes it" — it is "an
   * operator looking at the row that just went red can see which build it is".
   */
  const rowFor = (fingerprint: string | null, chunked: boolean) => {
    const record = JSON.parse(oldWorkerRecord()) as Record<string, unknown>;
    const live = livenessFrom(
      JSON.stringify({
        ...record,
        ...(fingerprint ? { fingerprint } : {}),
        capabilities: {
          ...(record.capabilities as Record<string, unknown>),
          chunkedTranslate: chunked,
          deliveryCap: chunked,
        },
      }),
    );
    return collectWebOperationsSnapshot(DRAINABLE_ENV, {
      daemonLiveness: live,
    }).subsystems.find((s) => s.id === "worker-capability");
  };

  it("names the running build beside a healthy row", () => {
    expect(rowFor("abc123def456", true)?.detail).toContain(
      "Running build abc123def456",
    );
  });

  it("names it beside a RED row, which is when it is actually needed", () => {
    // The last time this question had to be answered it cost an ssh session and
    // a grep inside the container — and the first attempt got it wrong, because
    // the image id had been captured after the rebuild.
    const row = rowFor("abc123def456", false);
    expect(row?.health).toBe("blocked");
    expect(row?.detail).toContain("abc123def456");
  });

  it("says it could not read one, rather than leaving a blank", () => {
    // An image too old to publish a fingerprint is exactly the kind this
    // subsystem exists to catch, so the absence is information.
    const row = rowFor(null, false);
    expect(row?.detail).toMatch(/no build fingerprint/i);
  });

  it("CONTROL: a malformed fingerprint is dropped, not surfaced", () => {
    // The one high-cardinality field in a record whose whole posture is that
    // there is nowhere to put a hostname. The parser bounds it by shape.
    const row = rowFor("../../etc/passwd" as string, true);
    expect(row?.detail).not.toContain("etc/passwd");
    expect(row?.detail).toMatch(/no build fingerprint/i);
  });
});
