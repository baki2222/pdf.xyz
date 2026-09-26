// @vitest-environment node
/**
 * The delivery cap survives the whole path from the route that charges for it
 * to the input the processor is handed — the seams, not the two ends.
 *
 * The cap is the only thing that makes the character reservation true. If it
 * stops arriving — a queue that persists `options` and forgets `delivery`, a
 * claim that rebuilds a `ClaimedJob` field by field, a route that drops the
 * second argument — **every job silently becomes uncapped again.** The product
 * keeps working. Translations get longer, not shorter. Nothing errors, no unit
 * test notices: the route still computes a cap and the engine still enforces
 * one, and only the path between them is dead.
 *
 * That is the exact shape measured on a different feature in this codebase,
 * where two boundaries each passed their own tests (185/186) and the composed
 * chain dropped to 174/186.
 *
 * ── WHY THE ROUTE HALF IS AST-CHECKED AND NOT DRIVEN ────────────────────────
 *
 * The first version of this file drove the real `POST /api/jobs` into a
 * capturing adapter via `vi.mock("@/lib/workers")`. **It broke three unrelated
 * tests, on Linux CI only, and a peer re-running CI found it rather than any
 * check here.**
 *
 * `vitest.config.ts` runs `pool: "threads"` with `isolate: false` — deliberately,
 * to share the module cache across a ~900-file suite — under a comment asserting
 * that "the tests are pure/content-free and carry no cross-file module state".
 * A `vi.mock` IS that state: it replaces the module in the registry the whole
 * worker shares, so every file scheduled after it in the same thread received a
 * fake `getWorkerAdapter`. `local-dev-flow.test.ts` then saw `202` — this file's
 * stub status — where the local-dev adapter returns `201`.
 *
 * It is not a platform bug. File-to-worker assignment follows the CPU count, so
 * Windows put those files in different threads and Linux CI did not; reproduced
 * here on Windows with `--no-file-parallelism`, which forces one worker.
 *
 * **And note which instrument could see it.** The habit on both sides of this
 * work was to prove a change innocent by stash-compare on Windows, against a
 * known-fail list that also lives on Windows. That control and this defect are
 * on opposite platforms, so the local suite reported the truth about the wrong
 * machine. Green CI on `main` against red CI here was the only discriminator.
 *
 * So the route's contribution is checked with the TypeScript parser instead of
 * by execution — a real weakening, stated rather than papered over. It still
 * catches the regression that threatens the feature: the argument being
 * dropped, or the number that is CHARGED drifting from the number that is
 * ENFORCED. It cannot catch a route that computes the right cap and then fails
 * to reach the adapter at all.
 *
 * ── HOW THE SET OF QUEUES IS DECIDED ────────────────────────────────────────
 *
 * The static half DISCOVERS its subjects: it reads the queue directory from
 * `git ls-files` and derives which modules persist a submission from the fact
 * that they mention `submission.options` — a relationship, not a list. A queue
 * added tomorrow is in the corpus the moment it stores a submission, because a
 * queue that does not store options is not storing jobs.
 *
 * The behavioural half names the two real providers, because their constructors
 * genuinely differ (one takes a Redis config and client, the other a store) and
 * nothing can instantiate an unknown one.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION,
  deliveryCapFor,
  parseCreateJobRequest,
  type Job,
  type JobDeliveryCap,
} from "@/lib/jobs";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "@/lib/jobs/translate-limits";
import { createFakeRedis } from "./queue/redis-fake";
import { createRedisQueue } from "./queue/redis";
import { parseRedisQueueConfig, REDIS_QUEUE_ENV } from "./queue/redis-config";
import { createLocalDevQueue } from "./queue/local-dev";
import { DevWorkerStore } from "./store";
import type { ClaimableQueue } from "./queue/claim";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const CAP: JobDeliveryCap = { characters: 56_816, pages: 9 };
const FILE_ID = "f_abc123def456";
const LIMITS = {
  fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
  headroom: TRANSLATE_EXTRACTOR_HEADROOM,
};

function queuedJob(jobId = "job_test000001"): Job {
  return {
    jobId,
    tool: "translate-pdf",
    capability: "secure-worker",
    status: "queued",
    progress: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    /**
     * Far future, and not an offset from the injected clock.
     *
     * The first version used `new Date(3_600_000)` — an hour past the epoch,
     * matching the fake clock — and `DevWorkerStore.getJob` drops expired jobs
     * against the REAL wall clock, so the local-dev queue claimed nothing and
     * the round-trip failed for the fixture's own bug rather than for the
     * property it exists to hold. A control that fails for its own bug is not a
     * control.
     */
    expiresAt: "2100-01-01T00:00:00.000Z",
    retention: DEFAULT_RETENTION,
  };
}

// ---------------------------------------------------------------------------
// 1. The wire body becomes the cap — through the REAL contract parser
// ---------------------------------------------------------------------------

/** Parse a body the way the route does, then derive the cap from the result. */
function capFromWire(body: Record<string, unknown>): JobDeliveryCap {
  const parsed = parseCreateJobRequest({
    tool: "translate-pdf",
    inputs: [FILE_ID],
    options: { targetLanguage: "fr", sourceLanguage: "auto" },
    ...body,
  });
  expect(
    parsed.ok,
    parsed.ok ? "" : "the contract refused a body this test assumes it accepts",
  ).toBe(true);
  if (!parsed.ok) throw new Error("unreachable");
  return deliveryCapFor(parsed.value, LIMITS);
}

describe("a declaration on the wire becomes the cap the job runs under", () => {
  it("derives the character bound from the declaration and the headroom", () => {
    expect(
      capFromWire({ declaredCharacters: 14_204, declaredTextPages: 9 }),
      "the cap the worker will enforce is not the reservation the client is charged",
    ).toEqual({
      characters: 14_204 * TRANSLATE_EXTRACTOR_HEADROOM,
      pages: 9,
    });
  });

  it("falls back to a whole call's worth when nothing was declared", () => {
    // The direct-API path: it has bytes, not extracted text. It pays the
    // maximum and is capped at the maximum — the same number in both roles, so
    // "you get what you reserved" holds for a caller that cannot count.
    expect(capFromWire({})).toEqual({
      characters: Math.ceil(
        TRANSLATE_MAX_INPUT_CHARS * TRANSLATE_EXTRACTOR_HEADROOM,
      ),
    });
  });

  it("leaves the page bound absent rather than zero when it is not declared", () => {
    // Absent means unbounded. A `0` would mean the tool delivers nothing for
    // every caller that cannot count pages — the failure that takes the feature
    // down rather than merely loosening it.
    const cap = capFromWire({ declaredCharacters: 1_000 });
    expect(cap.pages).toBeUndefined();
    expect("pages" in cap).toBe(false);
  });

  it("rounds the reservation UP, so a fractional headroom cannot under-reserve", () => {
    // `Math.ceil`, not `Math.round`: under-reserving truncates an honest
    // caller's own document, and rounding is the direction that would do it
    // silently for half of all inputs.
    const cap = deliveryCapFor(
      { declaredCharacters: 3 },
      { fallbackCharacters: 10, headroom: 1.5 },
    );
    expect(cap.characters).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 2. The route hands that cap to the adapter, and charges the same number
// ---------------------------------------------------------------------------

/**
 * Read the route with the parser rather than with a regex.
 *
 * A string search for `createJob(` cannot tell one argument from two, and "the
 * second argument exists" is the entire property. See the header for why this
 * is not driven end to end.
 */
function routeAst(): TS.SourceFile {
  const file = "src/app/api/jobs/route.ts";
  const source = readFileSync(file, "utf8");
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}

function callsNamed(sf: TS.SourceFile, name: string): TS.CallExpression[] {
  const found: TS.CallExpression[] = [];
  const walk = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      const target = node.expression;
      const text = ts.isPropertyAccessExpression(target)
        ? target.name.text
        : ts.isIdentifier(target)
          ? target.text
          : "";
      if (text === name) found.push(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return found;
}

describe("the route passes the cap it charged for", () => {
  it("calls createJob with a second argument", () => {
    const calls = callsNamed(routeAst(), "createJob");
    expect(
      calls.length,
      "no createJob call was found in the route — this check is asking nothing",
    ).toBe(1);
    expect(
      calls[0]!.arguments.length,
      "the route creates a job without handing over the delivery cap, so every " +
        "job it queues is uncapped while the caller is still charged for one",
    ).toBe(2);
  });

  it("charges the allowance and caps delivery from the SAME binding", () => {
    /**
     * The drift this prevents is invisible in review: two correct expressions
     * that agree today. The amount handed to `enforceAiCharacterAllowance` and
     * the cap handed to the adapter must be properties of ONE object, so what
     * is billed and what may be delivered cannot come apart.
     *
     * ── INVERTED 2026-09-27, NOT DELETED ─────────────────────────────────────
     *
     * This used to require the charge to be `delivery.characters` — the cap's
     * own character bound. That was true of translate and it PINNED A DEFECT
     * on the other three AI tools: it made "charge = the cap" structural, and
     * the only cap a summarize, chat or extract job ever got was the undeclared
     * fallback, so every run of them cost a third of the day whatever the
     * document held. A per-call run is now charged `min(declared, fallback) × h`
     * and read up to `declared × h`, so the two numbers legitimately differ —
     * and the property worth pinning is that they come from one decision, not
     * that they are one number. `delivery-cap.pricing.test.ts` pins the
     * relationship between them (never charged for more than may be read).
     */
    const sf = routeAst();
    const charge = callsNamed(sf, "enforceAiCharacterAllowance");
    expect(
      charge.length,
      "the route no longer charges the AI allowance at all",
    ).toBe(1);

    const amount = charge[0]!.arguments[0];
    expect(amount, "the allowance is charged with no amount").toBeDefined();
    expect(
      amount !== undefined && ts.isPropertyAccessExpression(amount),
      "the allowance is charged with a value computed apart from the " +
        "reservation, so what is billed and what may be delivered can drift",
    ).toBe(true);
    const access = amount as TS.PropertyAccessExpression;
    expect(access.name.text).toBe("charge");

    const capped = callsNamed(sf, "createJob")[0]!.arguments[1];
    expect(
      capped !== undefined && ts.isPropertyAccessExpression(capped),
      "the adapter is handed a cap that is not read off the reservation",
    ).toBe(true);
    const handed = capped as TS.PropertyAccessExpression;
    expect(handed.name.text).toBe("delivery");
    expect(
      ts.isIdentifier(access.expression) &&
        ts.isIdentifier(handed.expression) &&
        access.expression.text === handed.expression.text,
      "the object charged for and the object handed to the adapter are not the " +
        "same binding",
    ).toBe(true);
  });

  it("derives that object with aiReservationFor rather than inline arithmetic", () => {
    // Arithmetic written inline here is the shape that goes stale when the
    // multiplier moves, and none of the tests above can reach it. This named
    // `deliveryCapFor` until 2026-09-27; that function is now the translate
    // branch of `aiReservationFor`, which the route must go through.
    expect(
      callsNamed(routeAst(), "aiReservationFor").length,
      "the route builds the reservation by hand again",
    ).toBe(1);
    expect(
      callsNamed(routeAst(), "deliveryCapFor").length,
      "the route derives a cap beside the reservation, so charge and cap are " +
        "two decisions again",
    ).toBe(0);
  });

  it("asks the RUNNING worker whether per-call reads are capped", () => {
    /**
     * The exit condition names the property, not the mechanism. A per-call
     * tool may be charged its declared size only if the worker that runs the
     * job reads no more than that; the code that makes that true is merged
     * long before the hand-built image carrying it is running. So the witness
     * handed to `aiReservationFor` must be the heartbeat's proof — a literal
     * `true`, or any function that does not ask the running image, would sell
     * a full read at a one-character price for as long as the old image runs.
     */
    const call = callsNamed(routeAst(), "aiReservationFor")[0];
    expect(call, "the route does not price AI jobs at all").toBeDefined();
    const limits = call!.arguments[2];
    expect(
      limits !== undefined && ts.isObjectLiteralExpression(limits),
      "the reservation's limits are not written where this check can read them",
    ).toBe(true);
    const witness = (limits as TS.ObjectLiteralExpression).properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === "readCapEnforced",
    ) as TS.PropertyAssignment | undefined;
    expect(witness, "no read-cap witness is passed").toBeDefined();
    const asked: string[] = [];
    const walk = (node: TS.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        asked.push(node.expression.text);
      }
      ts.forEachChild(node, walk);
    };
    walk(witness!.initializer);
    expect(
      asked,
      "the read-cap witness does not ask the running worker's heartbeat",
    ).toContain("runningWorkerEnforcesAiReadCap");
  });
});

// ---------------------------------------------------------------------------
// 3. Every real queue carries it from submit to claim
// ---------------------------------------------------------------------------

function redisQueue(): ClaimableQueue {
  const parsed = parseRedisQueueConfig({
    [REDIS_QUEUE_ENV.provider]: "redis",
    [REDIS_QUEUE_ENV.restUrl]: "https://example.upstash.io",
    [REDIS_QUEUE_ENV.restToken]: "AX_tokenEXAMPLEvalue000000000000000000000",
  });
  if (!parsed.ok) throw new Error("invalid test config");
  return createRedisQueue(parsed.config, {
    client: createFakeRedis(),
    now: () => 1_000,
  }) as ClaimableQueue;
}

function localDevQueue(): ClaimableQueue {
  return createLocalDevQueue({
    store: new DevWorkerStore(),
    now: () => 1_000,
  }) as ClaimableQueue;
}

describe.each([
  ["redis", redisQueue],
  ["local-dev", localDevQueue],
])("the %s queue round-trips the cap", (_name, build) => {
  it("submit → claim returns the same cap", async () => {
    const queue = build();
    const submitted = await queue.submit({
      job: queuedJob(),
      inputs: [FILE_ID],
      options: { targetLanguage: "fr" },
      delivery: CAP,
    });
    expect(submitted.ok, "the submission was rejected").toBe(true);

    const claim = await queue.claim({ leaseMs: 30_000 });
    expect(claim.ok && claim.value, "nothing was claimable").toBeTruthy();
    if (!claim.ok || !claim.value) return;
    expect(
      claim.value.delivery,
      "the queue stored a job's spec and dropped its delivery cap, so every " +
        "job it serves is uncapped while the route still charges for one",
    ).toEqual(CAP);
  });

  it("CONTROL: a submission with no cap claims back with no cap", async () => {
    // Absent must stay absent rather than becoming a zero, an empty object, or
    // an inherited value from a previous job. An absent cap means unbounded;
    // a `{characters: 0}` would mean the tool delivers nothing, for everyone.
    const queue = build();
    await queue.submit({
      job: queuedJob("job_test000002"),
      inputs: [FILE_ID],
      options: {},
    });
    const claim = await queue.claim({ leaseMs: 30_000 });
    expect(claim.ok && claim.value).toBeTruthy();
    if (!claim.ok || !claim.value) return;
    expect(claim.value.delivery).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Any queue that persists a submission must persist the cap
// ---------------------------------------------------------------------------

describe("every queue that stores a submission stores its cap", () => {
  it("is derived from the tree, not from a list of files", () => {
    const tracked = execFileSync("git", ["ls-files", "src/lib/workers/queue"], {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".ts") && !line.includes(".test."));

    // BOUND THE CORPUS. An empty or collapsed file list makes every assertion
    // below vacuously true and reports the strongest possible pass — and a
    // corpus that silently shrank is invisible to any assertion about its
    // members.
    expect(
      tracked.length,
      "the queue directory listing is implausibly small — the corpus, not the code, is what failed",
    ).toBeGreaterThanOrEqual(8);

    const persisting = tracked.filter((file) =>
      readFileSync(file, "utf8").includes("submission.options"),
    );
    expect(
      persisting.length,
      "no queue module appears to persist a submission, so the check below asks nothing",
    ).toBeGreaterThanOrEqual(2);

    for (const file of persisting) {
      const source = readFileSync(file, "utf8");
      expect(
        source.includes("submission.delivery"),
        `${file} stores a submission's options and not its delivery cap — every job it queues would be uncapped`,
      ).toBe(true);
    }
  });
});
