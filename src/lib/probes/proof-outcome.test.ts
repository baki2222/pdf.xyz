// @vitest-environment node
/**
 * The proof harness may claim "not evidence" only when the observation
 * licenses it.
 *
 * WHY THIS EXISTS (TASK-72). On 2026-08-21 `pnpm worker:prove-tools` printed
 * `FAIL chat-with-pdf … HTTP 429 rate_limited` and exited 1 against a
 * production deployment where nothing was broken: the deployment's own free
 * AI allowance had refused the fourth AI run of the day, exactly as designed.
 * An instrument that goes red for a non-defect trains its reader to discount
 * red, and a red guard nobody can explain gets deleted. So the harness gained
 * a third outcome — UNPROVEN — and this file pins the rules for when it may
 * be claimed.
 *
 * THE PROPERTY (stated as the property, not the mechanism): a proof may be
 * reported as "unproven — not evidence about the tool" ONLY when the observed
 * response says the deployment's own policy refused to run the job. Every
 * refusal that does not carry that license stays FAILED, because the safe
 * error for an instrument is the alarm that makes a human look — a false
 * "not evidence" is the convenient direction, and defects that fail in the
 * convenient direction are the ones that ship.
 *
 * CORPUS IN BOTH DIRECTIONS (house rule 1): every classifier branch below is
 * exercised by a response the deployment actually serves (built from the same
 * constants the routes serve, so copy churn moves both sides together), and
 * the branch list is exported as a value so this corpus fails loudly if a
 * branch is added without a corpus member — `[] ⊆ X` is vacuously true, and a
 * blind predicate reports the strongest possible pass.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { DEFAULT_RETENTION } from "@/lib/jobs";
import { AI_CEILING_REACHED_MESSAGE } from "@/lib/jobs/ai-spend-ceiling";
import { createWorkerExecutor } from "@/lib/workers/executor/executor";
import { createLocalDevExecutorStorage } from "@/lib/workers/executor/local-dev-storage";
import {
  WebpageFetchError,
  webpageFetchMessage,
  type ChromiumPdfRunner,
} from "@/lib/workers/html-render/engine";
import { createProcessorRegistry } from "@/lib/workers/processor";
import { createLocalDevQueue } from "@/lib/workers/queue/local-dev";
import { DevWorkerStore } from "@/lib/workers/store";
import {
  AI_ALLOWANCE_USED_MESSAGE,
  RATE_LIMITED_MESSAGE,
} from "@/lib/ratelimit/response";
import {
  EXIT_ALL_PROVEN,
  EXIT_DEFECT,
  EXIT_INCOMPLETE,
  PROOF_OUTCOMES,
  UNPROVEN_CAUSES,
  UNPROVEN_VIAS,
  harnessExitCode,
  judgeExpectedRefusal,
  orderSpecsForAllowance,
  refusalVerdict,
  unprovenSummaryLines,
  type DeploymentProofLedger,
  type ObservedRefusal,
  type RefusalVerdict,
  type UnprovenCause,
} from "./proof-outcome";

/* ------------------------------------------------------------------ *
 *  refusalVerdict — the corpus, one member per response the app serves
 * ------------------------------------------------------------------ */

/** Responses the deployment actually serves, built from the served constants. */
const SERVED_REFUSALS: {
  name: string;
  observed: ObservedRefusal;
  want: RefusalVerdict["outcome"];
  via?: (typeof UNPROVEN_VIAS)[number];
}[] = [
  {
    // The refusal that motivated this file, verbatim from production via the
    // constant the route serves (`rateLimitErrorResult`, action "ai.run").
    name: "the free AI allowance (429 rate_limited, allowance message)",
    observed: {
      status: 429,
      code: "rate_limited",
      message: AI_ALLOWANCE_USED_MESSAGE,
    },
    want: "unproven",
    via: "rate-limit",
  },
  {
    // The generic flood throttle (`jobs.create` / `uploads.create`) shares the
    // envelope: still the deployment's own limiter, still not tool evidence.
    name: "the generic throttle (429 rate_limited, generic message)",
    observed: {
      status: 429,
      code: "rate_limited",
      message: RATE_LIMITED_MESSAGE,
    },
    want: "unproven",
    via: "rate-limit",
  },
  {
    // The global AI spend ceiling: `POST /api/jobs` answers the peek with this
    // exact constant (`apiError("service_unavailable", AI_CEILING_REACHED_MESSAGE)`).
    name: "the AI spend ceiling (503 service_unavailable, ceiling message)",
    observed: {
      status: 503,
      code: "service_unavailable",
      message: AI_CEILING_REACHED_MESSAGE,
    },
    want: "unproven",
    via: "spend-ceiling",
  },
  {
    name: "no worker configured (503 worker_not_configured)",
    observed: {
      status: 503,
      code: "worker_not_configured",
      message: "No worker backend is configured.",
    },
    want: "failed",
  },
  {
    // `service_unavailable` is NOT unique to the ceiling: artifact delivery and
    // storage failures reuse the code. Only the ceiling's own sentence licenses
    // "unproven"; any other 503 with this code is a real outage and stays red.
    name: "a storage outage sharing the ceiling's code (503, other message)",
    observed: {
      status: 503,
      code: "service_unavailable",
      message: "The artifact store did not respond.",
    },
    want: "failed",
  },
  {
    // A platform 429 without the app's typed envelope (CDN/proxy HTML page):
    // nothing observed says OUR policy refused, so nothing licenses "unproven".
    name: "an untyped 429 (platform page, no error envelope)",
    observed: { status: 429, code: null, message: null },
    want: "failed",
  },
  {
    name: "a validation rejection (400 invalid_request)",
    observed: { status: 400, code: "invalid_request", message: "bad options" },
    want: "failed",
  },
  {
    name: "a server error (500 internal_error)",
    observed: { status: 500, code: "internal_error", message: "boom" },
    want: "failed",
  },
];

describe("refusalVerdict", () => {
  it.each(SERVED_REFUSALS)("classifies $name as $want", (row) => {
    const verdict = refusalVerdict(row.observed);
    expect(verdict.outcome).toBe(row.want);
    if (verdict.outcome === "unproven") {
      expect(verdict.via).toBe(row.via);
      // The reason must carry the server's own sentence, never a guess.
      expect(verdict.reason).toContain(row.observed.message ?? "");
    }
  });

  it("every unproven via is exercised by a served response (no decorative branch)", () => {
    const seen = new Set(
      SERVED_REFUSALS.filter((r) => r.want === "unproven").map((r) => r.via),
    );
    for (const via of UNPROVEN_VIAS) expect(seen.has(via)).toBe(true);
  });

  it("both directions are populated — the corpus is not vacuous", () => {
    // `[] ⊆ X` is vacuously true; a corpus that quietly shrinks reports the
    // strongest possible pass. Bound its size in both directions.
    expect(
      SERVED_REFUSALS.filter((r) => r.want === "unproven").length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      SERVED_REFUSALS.filter((r) => r.want === "failed").length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("a 429 that lost its typed code on the way is NOT excused", () => {
    // The composed chain: `postJson` parses the body; a proxy that strips the
    // JSON leaves code null. The verdict must depend on what was observed at
    // the end of the chain, not on what the app would have sent.
    expect(
      refusalVerdict({ status: 429, code: null, message: "Too Many Requests" })
        .outcome,
    ).toBe("failed");
  });

  it("the ceiling message under the wrong status is NOT excused", () => {
    // The license is the pair (status, code) plus the served sentence; a 200 or
    // 500 carrying the sentence is a malfunction, not a policy refusal.
    expect(
      refusalVerdict({
        status: 500,
        code: "internal_error",
        message: AI_CEILING_REACHED_MESSAGE,
      }).outcome,
    ).toBe("failed");
  });
});

/* ------------------------------------------------------------------ *
 *  unprovenSummaryLines — the roll-up may not spread one observed cause
 * ------------------------------------------------------------------ */

/**
 * THIS PINS A DEFECT THAT SHIPPED IN THIS FEATURE'S OWN FIRST RUN. Measured
 * against production on 2026-08-21, the harness's summary said:
 *
 *   5 UNPROVEN — refused by the deployment's own policy, which is not
 *   evidence about the tools: summarize-pdf, translate-pdf, ai-extract,
 *   chat-with-pdf, chat-with-pdf (follow-up)
 *
 * Four of those five were refused. The fifth was never asked: its input
 * artifact came from the opening chat turn, which had itself been refused, so
 * no request left the harness and no policy said anything about it. Every
 * per-proof line above the summary was correct; the roll-up took the cause it
 * had observed for the majority and spread it over the union — the same
 * defect `reservation-refusal.ts` exists to prevent, one file over.
 */
const REAL_RUN_2026_08_21: { label: string; cause: UnprovenCause }[] = [
  { label: "summarize-pdf", cause: "rate-limit" },
  { label: "translate-pdf", cause: "rate-limit" },
  { label: "ai-extract", cause: "rate-limit" },
  { label: "chat-with-pdf", cause: "rate-limit" },
  { label: "chat-with-pdf (follow-up)", cause: "dependency" },
];

describe("unprovenSummaryLines", () => {
  it("does not say a dependency-blocked proof was refused by a policy", () => {
    const lines = unprovenSummaryLines(REAL_RUN_2026_08_21);
    const refusalLine = lines.find((l) => l.includes("rate-limit policy"));
    expect(refusalLine).toBeDefined();
    expect(refusalLine).not.toContain("chat-with-pdf (follow-up)");
    // The four that WERE refused are all still named, the opening turn among
    // them — excluding the follow-up must not cost the line its own members.
    expect(refusalLine).toContain("4 UNPROVEN");
    expect(refusalLine?.endsWith("chat-with-pdf")).toBe(true);
  });

  it("gives the dependency-blocked proof its own, true sentence", () => {
    const lines = unprovenSummaryLines(REAL_RUN_2026_08_21);
    const line = lines.find((l) => l.includes("chat-with-pdf (follow-up)"));
    expect(line).toContain("never asked");
    expect(line).toContain("1 UNPROVEN");
  });

  it("names every unproven proof exactly once, across all lines", () => {
    // Grouping must not lose a row (a count that quietly shrinks reports the
    // strongest possible pass) nor double-count one.
    const joined = unprovenSummaryLines(REAL_RUN_2026_08_21).join("\n");
    for (const row of REAL_RUN_2026_08_21) {
      expect(joined.split(row.label).length - 1).toBeGreaterThanOrEqual(1);
    }
    const counted = unprovenSummaryLines(REAL_RUN_2026_08_21)
      .map((l) => Number(l.slice(0, l.indexOf(" "))))
      .reduce((a, b) => a + b, 0);
    expect(counted).toBe(REAL_RUN_2026_08_21.length);
  });

  it("every cause has a sentence, and no sentence goes unexercised", () => {
    // The corpus, in both directions: one row per cause the harness can carry,
    // and a distinct line for each — a cause with no line would vanish from
    // the report, a line no cause reaches is decoration.
    const oneEach = UNPROVEN_CAUSES.map((cause) => ({
      label: `spec-${cause}`,
      cause,
    }));
    const lines = unprovenSummaryLines(oneEach);
    expect(lines).toHaveLength(UNPROVEN_CAUSES.length);
    for (const { label } of oneEach) {
      expect(lines.filter((l) => l.includes(label))).toHaveLength(1);
    }
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("the causes are the two policy refusals plus dependency", () => {
    // Pins the relationship rather than the list: a new UNPROVEN_VIAS member
    // must appear here, and `dependency` must stay distinct from both.
    expect([...UNPROVEN_CAUSES]).toEqual([...UNPROVEN_VIAS, "dependency"]);
  });

  it("no unproven proofs means no roll-up at all", () => {
    expect(unprovenSummaryLines([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  harnessExitCode — the trichotomy, and its precedence
 * ------------------------------------------------------------------ */

describe("harnessExitCode", () => {
  it("all proven on a full run with full coverage exits 0", () => {
    expect(
      harnessExitCode({
        outcomes: ["proven", "proven"],
        unspecifiedToolCount: 0,
        fullRun: true,
      }),
    ).toBe(EXIT_ALL_PROVEN);
  });

  it("any failure exits 1 — defect evidence dominates", () => {
    expect(
      harnessExitCode({
        outcomes: ["proven", "failed", "unproven"],
        unspecifiedToolCount: 0,
        fullRun: true,
      }),
    ).toBe(EXIT_DEFECT);
  });

  it("a worker tool with no spec exits 1 on a full run even when all proven", () => {
    expect(
      harnessExitCode({
        outcomes: ["proven"],
        unspecifiedToolCount: 1,
        fullRun: true,
      }),
    ).toBe(EXIT_DEFECT);
  });

  it("a filtered run says nothing about coverage", () => {
    expect(
      harnessExitCode({
        outcomes: ["proven"],
        unspecifiedToolCount: 1,
        fullRun: false,
      }),
    ).toBe(EXIT_ALL_PROVEN);
  });

  it("unproven without failure exits 2 — incomplete, not failing", () => {
    expect(
      harnessExitCode({
        outcomes: ["proven", "unproven"],
        unspecifiedToolCount: 0,
        fullRun: true,
      }),
    ).toBe(EXIT_INCOMPLETE);
  });

  it("exit 0 is never diluted: unproven alone can not produce it", () => {
    expect(
      harnessExitCode({
        outcomes: ["unproven"],
        unspecifiedToolCount: 0,
        fullRun: true,
      }),
    ).not.toBe(EXIT_ALL_PROVEN);
  });

  it("the outcome vocabulary is exactly the three states", () => {
    expect([...PROOF_OUTCOMES].sort()).toEqual([
      "failed",
      "proven",
      "unproven",
    ]);
  });
});

/* ------------------------------------------------------------------ *
 *  orderSpecsForAllowance — rotation that repairs itself
 * ------------------------------------------------------------------ */

interface FakeSpec {
  tool: string;
  label?: string;
}

/** Mirrors the real SPECS shape: three 1-spec AI tools + one 2-spec AI tool. */
const NON_AI: FakeSpec[] = [{ tool: "compress-pdf" }, { tool: "repair-pdf" }];
const AI: FakeSpec[] = [
  { tool: "summarize-pdf" },
  { tool: "translate-pdf" },
  { tool: "ai-extract" },
  { tool: "chat-with-pdf" },
  { tool: "chat-with-pdf", label: "chat-with-pdf (follow-up)" },
];
const SPECS: FakeSpec[] = [...NON_AI, ...AI];
const isAi = (s: FakeSpec) =>
  ["summarize-pdf", "translate-pdf", "ai-extract", "chat-with-pdf"].includes(
    s.tool,
  );
const key = (s: FakeSpec) => s.label ?? s.tool;

describe("orderSpecsForAllowance", () => {
  it("keeps non-AI specs first, in their original order", () => {
    const ordered = orderSpecsForAllowance(SPECS, isAi, {});
    expect(ordered.slice(0, NON_AI.length).map(key)).toEqual(NON_AI.map(key));
  });

  it("keeps a tool's specs contiguous and in order (the chat pair is atomic)", () => {
    const ledger: DeploymentProofLedger = {
      "summarize-pdf": { lastProvenAt: "2026-08-20T00:00:00.000Z" },
    };
    const ordered = orderSpecsForAllowance(SPECS, isAi, ledger).map(key);
    const open = ordered.indexOf("chat-with-pdf");
    expect(ordered[open + 1]).toBe("chat-with-pdf (follow-up)");
  });

  it("never-proven tools come before proven ones; among proven, oldest first", () => {
    const ledger: DeploymentProofLedger = {
      "summarize-pdf": { lastProvenAt: "2026-08-20T00:00:00.000Z" },
      "translate-pdf": { lastProvenAt: "2026-08-18T00:00:00.000Z" },
      "ai-extract": { lastProvenAt: "2026-08-19T00:00:00.000Z" },
      // chat-with-pdf: never proven
    };
    const aiTools = orderSpecsForAllowance(SPECS, isAi, ledger)
      .filter(isAi)
      .map((s) => s.tool);
    expect([...new Set(aiTools)]).toEqual([
      "chat-with-pdf",
      "translate-pdf",
      "ai-extract",
      "summarize-pdf",
    ]);
  });

  it("a tool is as stale as its LEAST recently proven spec", () => {
    // Half-proven chat (opening proved, follow-up never) must still sort as
    // never-proven: the conversation claim is the one that was not made.
    const ledger: DeploymentProofLedger = {
      "chat-with-pdf": { lastProvenAt: "2026-08-21T00:00:00.000Z" },
      "summarize-pdf": { lastProvenAt: "2026-08-01T00:00:00.000Z" },
      "translate-pdf": { lastProvenAt: "2026-08-01T00:00:00.000Z" },
      "ai-extract": { lastProvenAt: "2026-08-01T00:00:00.000Z" },
    };
    const first = orderSpecsForAllowance(SPECS, isAi, ledger).filter(isAi)[0]!;
    expect(first.tool).toBe("chat-with-pdf");
  });

  it("an unparsable timestamp counts as never proven (re-prove, not trust)", () => {
    const ledger: DeploymentProofLedger = {
      "summarize-pdf": { lastProvenAt: "not-a-date" },
      "translate-pdf": { lastProvenAt: "2026-08-01T00:00:00.000Z" },
      "ai-extract": { lastProvenAt: "2026-08-01T00:00:00.000Z" },
      "chat-with-pdf": { lastProvenAt: "2026-08-01T00:00:00.000Z" },
      "chat-with-pdf (follow-up)": { lastProvenAt: "2026-08-01T00:00:00.000Z" },
    };
    const first = orderSpecsForAllowance(SPECS, isAi, ledger).filter(isAi)[0]!;
    expect(first.tool).toBe("summarize-pdf");
  });

  it("ties keep the original SPECS order (stable, no thrash)", () => {
    const ordered = orderSpecsForAllowance(SPECS, isAi, {}).map(key);
    expect(ordered).toEqual(SPECS.map(key));
  });

  /**
   * THE PROPERTY THE TASK NAMES, verified over the composed chain rather than
   * per unit: with an allowance of 3 runs per day, every AI tool is proven
   * within 2 simulated days, and the ledger can say when each was last proven.
   * (5 AI proof runs across 4 tools, one allowance of 3: no single day can
   * cover them; the rotation must converge instead.)
   */
  it("with 3 runs a day, every AI spec is proven within 2 days", () => {
    const ledger: DeploymentProofLedger = {};
    const ALLOWANCE = 3;
    let clock = Date.parse("2026-08-21T00:00:00.000Z");

    for (let day = 0; day < 2; day++) {
      let remaining = ALLOWANCE;
      for (const spec of orderSpecsForAllowance(SPECS, isAi, ledger)) {
        if (!isAi(spec)) continue;
        if (remaining === 0) continue; // the limiter refuses: unproven, no spend
        remaining -= 1;
        ledger[key(spec)] = {
          lastProvenAt: new Date((clock += 1000)).toISOString(),
        };
      }
    }

    for (const spec of AI) {
      expect(ledger[key(spec)]?.lastProvenAt).toBeDefined();
    }
  });

  it("day 2 spends the allowance on the tools day 1 could not reach", () => {
    // Day 1 with an empty ledger proves the first three 1-spec tools; day 2's
    // ordering must open with the chat pair, not re-prove yesterday's passes.
    const ledger: DeploymentProofLedger = {
      "summarize-pdf": { lastProvenAt: "2026-08-21T00:00:01.000Z" },
      "translate-pdf": { lastProvenAt: "2026-08-21T00:00:02.000Z" },
      "ai-extract": { lastProvenAt: "2026-08-21T00:00:03.000Z" },
    };
    const day2 = orderSpecsForAllowance(SPECS, isAi, ledger)
      .filter(isAi)
      .map(key);
    expect(day2.slice(0, 2)).toEqual([
      "chat-with-pdf",
      "chat-with-pdf (follow-up)",
    ]);
  });
});

/*
 * webpage-to-pdf's negative proof: ask for a page the site answers 404 and
 * require the job to REFUSE it. Judged here through the whole worker chain —
 * renderer error -> engine -> processor -> executor -> the stored job the API
 * serves — because each hop can drop the reason on its own: the engine's
 * catch used to replace every error with one generic sentence.
 */
describe("the expected-refusal proof (webpage-to-pdf 404)", () => {
  const NOT_FOUND = webpageFetchMessage({ reason: "http", status: 404 });
  /** A real one-page PDF: what Chromium prints from an error page. */
  const printedErrorPage = async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    return doc.save();
  };

  async function jobAfterRender(renderUrl: ChromiumPdfRunner["renderUrl"]) {
    let clock = 100_000;
    const store = new DevWorkerStore(() => clock);
    const queue = createLocalDevQueue({ store, now: () => clock });
    await queue.submit({
      job: {
        jobId: "job_proof404000",
        tool: "webpage-to-pdf",
        capability: "secure-worker",
        status: "queued",
        progress: 0,
        createdAt: new Date(clock).toISOString(),
        updatedAt: new Date(clock).toISOString(),
        expiresAt: new Date(clock + 3_600_000).toISOString(),
        retention: DEFAULT_RETENTION,
      },
      inputs: [],
      options: { url: "https://example.com/pdfxyz-proof-404" },
    });
    await createWorkerExecutor({
      queue,
      storage: createLocalDevExecutorStorage({ store, now: () => clock }),
      registry: createProcessorRegistry({
        htmlRender: { chromium: { renderHtml: printedErrorPage, renderUrl } },
      }),
      leaseMs: 1_000,
    }).drain();
    clock += 1;
    return store.getJob("job_proof404000")!;
  }

  it("passes when the worker refuses the 404 with the site's reason", async () => {
    const job = await jobAfterRender(async () => {
      throw new WebpageFetchError({ reason: "http", status: 404 });
    });
    expect(judgeExpectedRefusal(NOT_FOUND, job)).toMatchObject({ ok: true });
  });

  it("goes red when the worker prints the 404 page instead (the pre-2026-09 worker)", async () => {
    const job = await jobAfterRender(printedErrorPage);
    expect(job.status).toBe("completed");
    const verdict = judgeExpectedRefusal(NOT_FOUND, job);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/COMPLETED/);
  });

  it("goes red when the job fails for a reason that is not the site's", async () => {
    const job = await jobAfterRender(async () => {
      throw new Error("Chromium exited before the render finished.");
    });
    expect(judgeExpectedRefusal(NOT_FOUND, job)).toMatchObject({ ok: false });
    expect(judgeExpectedRefusal(NOT_FOUND, {})).toMatchObject({ ok: false });
  });
});
