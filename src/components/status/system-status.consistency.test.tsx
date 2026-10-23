// @vitest-environment jsdom
/**
 * The secure-worker card may not contradict itself.
 *
 * Every guard before this one pins a phrase or a number. This defect was
 * neither: on 2026-08-10 production's /status rendered a "Not enabled"
 * headline and "No secure worker is configured in this environment" directly
 * above rows reading OCR "Available" (21 observed language packs), scanning
 * active, and a drainable pipeline. Every field was individually true — the
 * headline came from the web process's in-process facet (`mode`/`detail`),
 * the rows from observed heartbeat state — and the RELATIONSHIP between them
 * was false. The field design misled the project's most careful reader
 * inside the very brief that commissioned the investigation into it.
 *
 * So this guard asserts the contradiction, not the strings:
 *   1. a down-headline badge while any row in the same card reports live is
 *      forbidden;
 *   2. a lead paragraph claiming nothing is configured while any row reports
 *      live or configured is forbidden.
 * The string predicates live in one place each and carry health checks — the
 * all-dead card MUST read as down, the production card's rows MUST read as
 * live, and the nothing-configured predicate MUST recognize the exact claim
 * that shipped — so a reword that empties a predicate fails loudly here. A
 * guard whose predicates match nothing does not report "no contradiction";
 * it reports "no contradiction in the words I know".
 *
 * Fixtures are derived through `buildWorkerStatus` itself with a
 * production-like injected env (inert placeholder values), so they are the
 * real derivation for that state, not a hand-typed guess — including the
 * exact shape production served on 2026-08-10 (mode `disabled` with an
 * observed worker heartbeat).
 *
 * WHAT THIS DOES NOT COVER, in the census's confession discipline: one
 * card's internal consistency only — not cross-page consistency, not whether
 * any individual facet is itself telling the truth (the heartbeat and
 * readiness seams own that), and not the compress panel (its fallback copy
 * is gated by its own drainability check).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { buildWorkerStatus, type WorkerStatus } from "@/lib/workers/status";
import { resetTelemetry } from "@/lib/telemetry/track";
import { SystemStatus } from "./system-status";

/* ------------------------------------------------------------------ *
 *  Fixtures — real derivations, inert values.
 * ------------------------------------------------------------------ */

/** Production-like env: storage + queue + AI declared. Placeholder values. */
const PROD_ENV = {
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "pdfxyz-inputs",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: "inert-placeholder-secret",
  PDFXYZ_QUEUE_PROVIDER: "redis",
  PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
  PDFXYZ_REDIS_REST_TOKEN: "inert-placeholder-token",
  PDFXYZ_AI_PROVIDER: "openai",
  PDFXYZ_AI_MODEL: "model-placeholder",
} as const;

/** The shape production served on 2026-08-10: web tier `disabled`, worker
 *  heartbeat observed with OCR + scanning live. The defect's home state. */
const PRODUCTION_SHAPE: WorkerStatus = buildWorkerStatus(
  "disabled",
  undefined,
  undefined,
  PROD_ENV,
  undefined,
  true, // workerObserved — a heartbeat is seen
  true, // workerOcr
  true, // workerScan
  ["eng", "ben"],
);

/**
 * Pipeline configured (drainable) but no worker heartbeat observed.
 *
 * Both halves are a PREMISE the contradiction tests below depend on — if this
 * fixture stopped being drainable, or started reporting an observed worker, the
 * tests would still pass while measuring a different scenario. Asserted rather
 * than described.
 */
const CONFIGURED_NOT_OBSERVED: WorkerStatus = buildWorkerStatus(
  "disabled",
  undefined,
  undefined,
  PROD_ENV,
  undefined,
  false,
  false,
  false,
);

/** Nothing configured, nothing observed. */
const ALL_DEAD: WorkerStatus = buildWorkerStatus(
  "disabled",
  undefined,
  undefined,
  {},
);

/** The developer-only in-process worker. */
const LOCAL_DEV: WorkerStatus = buildWorkerStatus(
  "local-dev",
  undefined,
  undefined,
  {},
);

/* ------------------------------------------------------------------ *
 *  The predicates — one place each, health-checked below.
 * ------------------------------------------------------------------ */

/** Exact badge labels asserting the worker/section is off. */
const BADGE_DOWN = /^(Not enabled|Not configured|Off|Disabled)$/;
/** Exact badge labels asserting something is live/positive right now. */
const BADGE_LIVE = /^(Available|Active|Ready|Drainable|Declared|Live)$/;
/** Badge label asserting configuration presence. */
const BADGE_CONFIGURED = /^Configured$/;
/** Lead-paragraph claims that NOTHING is configured/enabled here. */
const CLAIMS_NOTHING_CONFIGURED =
  /no secure worker is configured|isn'?t enabled in this environment|nothing is configured/i;

/** The lead production actually served on 2026-08-10 — the health anchor for
 *  the predicate above; if the predicate stops recognizing it, this fails. */
const MAIN_2026_08_10_LEAD =
  "No secure worker is configured in this environment. Deep image compression runs on an encrypted, auto-deleting worker when enabled.";

/* ------------------------------------------------------------------ *
 *  Render harness.
 * ------------------------------------------------------------------ */

interface CardView {
  headlineBadge: string;
  lead: string;
  /** Badge elements in the card body (rows), excluding the headline. */
  rowBadges: (re: RegExp) => string[];
}

async function renderCard(status: WorkerStatus): Promise<CardView> {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(async () => ({ ok: true, json: async () => status })),
  );
  render(<SystemStatus localTools={[]} />);
  // The card moved under "Technical details" on 2026-10-23 (the first screen
  // is a visitor's now: `system-status.plain.test.tsx`). Open it the way a
  // reader does; a role query does not see a `hidden` region.
  fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
  const heading = await screen.findByRole("heading", {
    name: /^secure worker$/i,
  });
  const header = heading.parentElement as HTMLElement;
  const card = header.parentElement as HTMLElement;
  // Ready state: the OCR row exists once the fetch resolved.
  await within(card).findByText("OCR");
  await waitFor(() => expect(card.querySelector("p")).not.toBeNull());
  const headlineBadge = (header.textContent ?? "")
    .replace(/Secure worker/i, "")
    .trim();
  const lead = card.querySelector("p")?.textContent ?? "";
  const rowBadges = (re: RegExp) =>
    within(card)
      .queryAllByText(re)
      .filter((el) => !header.contains(el))
      .map((el) => el.textContent ?? "");
  return { headlineBadge, lead, rowBadges };
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 *  The invariants.
 * ------------------------------------------------------------------ */

function expectNoContradiction(view: CardView, label: string) {
  const down = BADGE_DOWN.test(view.headlineBadge);
  const liveRows = view.rowBadges(BADGE_LIVE);
  expect(
    down && liveRows.length > 0,
    `${label}: the headline badge "${view.headlineBadge}" says down while rows say [${liveRows.join(", ")}] — one card, two verdicts`,
  ).toBe(false);

  const denies = CLAIMS_NOTHING_CONFIGURED.test(view.lead);
  const present = [
    ...view.rowBadges(BADGE_LIVE),
    ...view.rowBadges(BADGE_CONFIGURED),
  ];
  expect(
    denies && present.length > 0,
    `${label}: the lead claims nothing is configured ("${view.lead.slice(0, 80)}…") while rows say [${present.join(", ")}]`,
  ).toBe(false);
}

describe("the fixture's own premise", () => {
  it("CONFIGURED_NOT_OBSERVED really is drainable with no observed worker", () => {
    // Both halves are relied on by the contradiction tests below. If either
    // flipped, those would still pass while measuring a different scenario.
    expect(CONFIGURED_NOT_OBSERVED.pipeline.drainable).toBe(true);
    // "no heartbeat observed" shows up as the mode staying disabled: nothing
    // in this status claims a live worker.
    expect(CONFIGURED_NOT_OBSERVED.mode).toBe("disabled");
  });
});

describe("the secure-worker card renders one verdict", () => {
  it("health: the all-dead card still reads as down", async () => {
    const view = await renderCard(ALL_DEAD);
    expect(
      BADGE_DOWN.test(view.headlineBadge),
      `the down-predicate no longer matches the all-dead headline ("${view.headlineBadge}") — fix the predicate before trusting any pass`,
    ).toBe(true);
  });

  it("health: the production card's rows still read as live", async () => {
    const view = await renderCard(PRODUCTION_SHAPE);
    expect(
      view.rowBadges(BADGE_LIVE).length,
      "the live-predicate matches no row on the observed-worker shape — fix the predicate before trusting any pass",
    ).toBeGreaterThan(0);
  });

  it("health: the nothing-configured predicate recognizes the claim that shipped", () => {
    expect(CLAIMS_NOTHING_CONFIGURED.test(MAIN_2026_08_10_LEAD)).toBe(true);
  });

  it("the headline may not deny what a row asserts — production shape, 2026-08-10", async () => {
    expectNoContradiction(
      await renderCard(PRODUCTION_SHAPE),
      "observed-worker production shape",
    );
  });

  it("the lead may not claim nothing is configured while the pipeline is drainable", async () => {
    expectNoContradiction(
      await renderCard(CONFIGURED_NOT_OBSERVED),
      "configured-but-unobserved shape",
    );
  });

  it("the consistent states stay consistent", async () => {
    expectNoContradiction(await renderCard(ALL_DEAD), "all-dead shape");
  });

  it("local-dev stays consistent", async () => {
    expectNoContradiction(await renderCard(LOCAL_DEV), "local-dev shape");
  });
});
