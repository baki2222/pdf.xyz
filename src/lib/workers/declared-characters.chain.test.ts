// @vitest-environment node
/**
 * The declared character count survives the whole path from the panel's call to
 * the route's contract — the seam, not the two ends.
 *
 * A job that declares nothing reserves `ceiling × headroom`, which is today's
 * behaviour preserved exactly: three undeclared jobs a day. That default is
 * correct and it carries this project's signature defect. **If the declaration
 * ever stops reaching the route — a renamed field, a property dropped in
 * serialisation, a refactored request shape — every job silently falls back to
 * the maximum.** The product keeps working. Users get three jobs a day again
 * instead of a character budget. Nothing errors, and no unit test notices: the
 * client still computes a count and the route still reads one; only the path
 * between them is dead.
 *
 * So this drives the REAL client entry point with a fake transport, captures
 * the body it actually PUTs on the wire, and feeds that body to the REAL
 * `parseCreateJobRequest`. A unit test that the client sets the field and a
 * unit test that the parser reads it can both stay green while the seam drops
 * it — measured before on a different feature, where the units said 185/186 and
 * the composed chain said 174/186.
 */
import { describe, expect, it } from "vitest";
import { parseCreateJobRequest } from "@/lib/jobs";
import { runWorkerTranslate } from "./translate-client";

/**
 * A file id in the shape the CONTRACT requires — `f_`, not `file_`.
 *
 * The first version of this fixture used `file_…`, so `parseCreateJobRequest`
 * rejected it and a CONTROL failed for its own bug rather than for the property
 * it exists to hold. A control that fails for its own bug is not a control,
 * which is the whole reason they are run before they are trusted.
 */
const FILE_ID = "f_abc123def456";
const BYTES = new Uint8Array([1, 2, 3, 4]);
const DECLARED = 14_204;

/**
 * A transport that answers the three calls `runSecurityJob` makes and records
 * the body of the one that matters. Deliberately not a mock of the client: the
 * client is the thing under test.
 */
function captureTransport() {
  const jobBodies: unknown[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (target === "/api/uploads") {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          slots: [{ fileId: FILE_ID, url: "/upload/slot-1" }],
        }),
      };
    }
    if (target === "/upload/slot-1") {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (target === "/api/jobs") {
      // `jsonBody()` encodes to an ArrayBuffer, NOT a string. Decode rather
      // than assume, because the first version of this capture read
      // `typeof raw === "string"`, recorded nothing, and made the assertion
      // below fail with **"the client never reached POST /api/jobs"** — when
      // it had. A check that fails with a confidently wrong message is worse
      // than one that fails opaquely: it spends the next reader's time hunting
      // a break that does not exist. Same defect #113 fixed the same week, in
      // a probe that reported "storage is probably not configured" for a 429
      // it had actually observed. **A check may not report a cause it did not
      // observe** — including about itself.
      const raw = init?.body;
      const text =
        typeof raw === "string"
          ? raw
          : new TextDecoder().decode(raw as ArrayBuffer);
      jobBodies.push(JSON.parse(text));
      return {
        ok: true,
        status: 201,
        json: async () => ({
          jobId: "job_test000001",
          tool: "translate-pdf",
          status: "failed",
          progress: 0,
          error: {
            code: "internal_error",
            message: "stop here",
            retryable: false,
          },
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          expiresAt: new Date(3_600_000).toISOString(),
          retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
        }),
      };
    }
    throw new Error(`unexpected request: ${target}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, jobBodies };
}

describe("the declared count reaches the route's contract", () => {
  it("is on the body the client actually sends", async () => {
    const { fetchImpl, jobBodies } = captureTransport();
    await runWorkerTranslate(
      {
        filename: "report.pdf",
        bytes: BYTES,
        targetLanguage: "fr",
        sourceLanguage: "auto",
        declaredCharacters: DECLARED,
      },
      { fetchImpl, pollIntervalMs: 0, maxPollAttempts: 1 },
    );

    expect(
      jobBodies.length,
      "the client never reached POST /api/jobs — the chain broke before the " +
        "seam this test exists to check",
    ).toBe(1);
    const body = jobBodies[0] as Record<string, unknown>;
    expect(
      body.declaredCharacters,
      "the client computed a character count and did not put it on the wire, " +
        "so every job it creates silently reserves the maximum",
    ).toBe(DECLARED);
  });

  it("survives the REAL parser, not a hand-written shape", async () => {
    // The other half of the seam: a field on the wire that the server contract
    // drops is exactly as dead as one the client never sent, and a parser is
    // where a rename lands.
    const { fetchImpl, jobBodies } = captureTransport();
    await runWorkerTranslate(
      {
        filename: "report.pdf",
        bytes: BYTES,
        targetLanguage: "fr",
        sourceLanguage: "auto",
        declaredCharacters: DECLARED,
      },
      { fetchImpl, pollIntervalMs: 0, maxPollAttempts: 1 },
    );

    const parsed = parseCreateJobRequest(jobBodies[0]);
    expect(
      parsed.ok,
      parsed.ok ? "" : "the body the client sends does not parse at the route",
    ).toBe(true);
    if (!parsed.ok) return;
    expect(
      parsed.value.declaredCharacters,
      "the parser dropped the declared count, so the route would reserve the " +
        "maximum for a job that told it exactly what it needed",
    ).toBe(DECLARED);
  });

  it("CONTROL: an undeclared job parses too, and declares nothing", async () => {
    // The default path must keep working — a direct API caller that sends no
    // count is not an error, it just pays the maximum. If this went red the
    // contract would have become mandatory by accident.
    const parsed = parseCreateJobRequest({
      tool: "translate-pdf",
      inputs: [FILE_ID],
      options: { targetLanguage: "fr", sourceLanguage: "auto" },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.declaredCharacters).toBeUndefined();
  });

  it("CONTROL: a nonsense declaration is refused at the contract, not honoured", async () => {
    // The count is attacker-controlled. A malformed one must not reach the
    // reservation arithmetic at all.
    for (const bad of [-1, 0, 1.5, "many", null, Number.NaN]) {
      const parsed = parseCreateJobRequest({
        tool: "translate-pdf",
        inputs: [FILE_ID],
        options: { targetLanguage: "fr", sourceLanguage: "auto" },
        declaredCharacters: bad,
      });
      expect(
        parsed.ok,
        `a declared count of ${String(bad)} was accepted by the contract`,
      ).toBe(false);
    }
  });
});
