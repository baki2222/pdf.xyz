// @vitest-environment node
// @native-canvas
/**
 * An AI upload whose job could not be admitted is refused BEFORE the bytes
 * move — and only then.
 *
 * THE DEFECT (audit at 67e8d0f): the free daily AI allowance and the global
 * spend ceiling were asked about in `POST /api/jobs` only, and the client
 * reaches that route after `POST /api/uploads` AND the byte PUT. A connection
 * whose allowance was already gone uploaded the whole file (up to the per-file
 * limit) and was then refused with "allowance used". Nothing was wrong with
 * either answer; the question was asked one hop too late.
 *
 * WHY NOTHING CAUGHT IT: every allowance test drove the guard or the job
 * route — each correct on its own. Nothing asked what the UPLOAD route did for
 * a caller the job route was certain to refuse.
 *
 * THE PROPERTY PINNED HERE IS AGREEMENT, not a threshold: for every AI tool
 * and every state of the bucket, the upload is refused exactly when the job
 * route would refuse the SMALLEST job anyone could submit. Refusing less is
 * the defect; refusing more would turn away a file an honest declaration could
 * still run. Both routes are the real handlers, over the same in-process
 * limiter, and the verdict is read from their responses — never from the
 * guard.
 *
 * THE CORPUS IS DERIVED from the catalog: every AI-capability tool whose
 * minimal upload and job requests parse (floor 4), and the non-AI tools whose
 * upload parses as the control that nothing else changed.
 *
 * No `vi.mock`: the suite runs `isolate: false` (see `delivery-cap.chain.test.ts`).
 * With no worker environment the real adapter answers `503
 * worker_not_configured`, which is how "admitted" is told apart from `429`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  REQUIRED_WORKER_ENV,
  capabilityForMode,
  parseCreateJobRequest,
  parseCreateUploadSessionRequest,
  smallestAiReservation,
  AI_DELIVERY_LIMITS,
} from "@/lib/jobs";
import { aiReservationFor } from "@/lib/jobs/delivery-cap";
import { tools } from "@/lib/tools";
import { RATE_LIMIT_ENV, policyFor } from "@/lib/ratelimit";
import {
  enforceAiCharacterAllowance,
  recordAiSpend,
  resetRateLimitGuardForTests,
} from "@/lib/ratelimit/guard";
import {
  AI_ALLOWANCE_USED_MESSAGE,
  AI_CHARACTER_ALLOWANCE,
} from "@/lib/jobs/ai-allowance";
import { AI_CEILING_REACHED_MESSAGE } from "@/lib/jobs/ai-spend-ceiling";
import { aiToolOptionExample } from "@/lib/jobs/ai-tool-options.examples";
import {
  runSecurityJob,
  type FetchLike,
} from "@/lib/workers/pdf-security-client";
import { POST as UPLOAD } from "./route";
import { POST as CREATE_JOB } from "../jobs/route";

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const uploadOf = (slug: string) => ({
  tool: slug,
  files: [
    { filename: "report.pdf", contentType: "application/pdf", bytes: 1024 },
  ],
});
const jobOf = (slug: string, declaredCharacters?: number) => ({
  tool: slug,
  inputs: ["f_1234567890"],
  // Options the route ADMITS — AI options are parsed before the allowance
  // since 2026-09-28, and this file compares the two routes' allowance verdicts.
  ...(aiToolOptionExample(slug) ? { options: aiToolOptionExample(slug) } : {}),
  ...(declaredCharacters !== undefined ? { declaredCharacters } : {}),
});

const uploadable = (slug: string) =>
  parseCreateUploadSessionRequest(uploadOf(slug)).ok;

const AI_TOOLS = tools
  .filter((tool) => capabilityForMode(tool.processing) === "ai")
  .map((tool) => tool.slug)
  .filter((slug) => uploadable(slug) && parseCreateJobRequest(jobOf(slug)).ok);

const NON_AI_UPLOAD_TOOLS = tools
  .filter((tool) => capabilityForMode(tool.processing) !== "ai")
  .map((tool) => tool.slug)
  .filter(uploadable);

/**
 * The least a job of `slug` can reserve, as the upload route asks it. No
 * heartbeat is served in this file, so the running worker has proved nothing
 * and a per-call tool is priced as a whole run whatever it declares — the
 * price on a worker whose image predates the read-cap proof.
 *
 * INTEGRATED: this lane first had ONE smallest reservation for every tool
 * (four characters). On the branch it merged into, a per-call job costs the
 * whole-run fallback until the worker proves its read cap, so four admitted a
 * Summarize, Chat or Extract upload that no job of it could follow — the
 * "refused exactly when" check below failed on it, correctly.
 */
const NO_PROOF = async () => false;
const smallestFor = (slug: string) => smallestAiReservation(slug, NO_PROOF);

/** What the job route charges this job, priced as it prices it. */
async function chargeOf(body: unknown): Promise<number> {
  const parsed = parseCreateJobRequest(body);
  if (!parsed.ok) throw new Error("the job body stopped parsing");
  return (
    await aiReservationFor(parsed.value.tool, parsed.value, {
      ...AI_DELIVERY_LIMITS,
      readCapEnforced: NO_PROOF,
    })
  ).charge;
}

/** Spend the connection's bucket down to `remaining` characters. */
async function leave(remaining: number): Promise<void> {
  resetRateLimitGuardForTests();
  const spend = AI_CHARACTER_ALLOWANCE - remaining;
  if (spend <= 0) return;
  const spent = await enforceAiCharacterAllowance(spend, post("/api/jobs", {}));
  expect(spent.allowed, `health: could not spend ${spend}`).toBe(true);
}

beforeEach(() => {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  resetRateLimitGuardForTests();
  process.env[RATE_LIMIT_ENV.provider] = "local-memory";
});

afterEach(() => {
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
});

describe("the corpus", () => {
  it("is derived from the catalog and is not implausibly small", () => {
    expect(AI_TOOLS.length).toBeGreaterThanOrEqual(4);
    expect(NON_AI_UPLOAD_TOOLS.length).toBeGreaterThanOrEqual(5);
  });

  it("the smallest reservation is what the smallest ACCEPTED declaration costs", async () => {
    // One character is the least the job contract accepts, and zero is not.
    // If the validator ever accepted less, the upload would be asking about a
    // job size that is not the smallest, and could refuse a runnable file.
    for (const slug of AI_TOOLS) {
      expect(parseCreateJobRequest(jobOf(slug, 0)).ok, slug).toBe(false);
      const one = parseCreateJobRequest(jobOf(slug, 1));
      expect(one.ok, slug).toBe(true);
      if (!one.ok) continue;
      const smallest = await smallestFor(slug);
      expect(await chargeOf(jobOf(slug, 1)), slug).toBe(smallest);
      expect(smallest).toBeGreaterThan(0);
      expect(smallest).toBeLessThan(AI_CHARACTER_ALLOWANCE);
    }
  });

  it("under a worker that proves its read cap, it is a LOWER bound on every tool's cheapest job", async () => {
    // The one place it can only be a bound: a proven per-call run is also
    // charged its options, which an upload does not know. Below every real
    // job, so no file an honest job could run is refused.
    const proven = async () => true;
    for (const slug of AI_TOOLS) {
      const parsed = parseCreateJobRequest(jobOf(slug, 1));
      if (!parsed.ok) throw new Error(`${slug}: the job body stopped parsing`);
      const cheapest = (
        await aiReservationFor(slug, parsed.value, {
          ...AI_DELIVERY_LIMITS,
          readCapEnforced: proven,
        })
      ).charge;
      expect(
        await smallestAiReservation(slug, proven),
        slug,
      ).toBeLessThanOrEqual(cheapest);
    }
  });
});

describe("POST /api/uploads agrees with POST /api/jobs about the allowance", () => {
  it("refuses an AI upload exactly when no job could be admitted", async () => {
    const seen = new Set<boolean>();
    for (const slug of AI_TOOLS) {
      const smallest = await smallestFor(slug);
      const undeclared = await chargeOf(jobOf(slug));
      const states = [
        0,
        smallest - 1,
        smallest,
        undeclared - 1,
        undeclared,
        AI_CHARACTER_ALLOWANCE,
      ];
      for (const remaining of states) {
        await leave(remaining);
        const upload = await UPLOAD(post("/api/uploads", uploadOf(slug)));
        await leave(remaining);
        const job = await CREATE_JOB(post("/api/jobs", jobOf(slug, 1)));
        const jobRefused = job.status === 429;
        // Health: "admitted" must mean the adapter's honest 503, not some
        // other refusal the comparison would silently absorb.
        if (!jobRefused) expect(job.status, `${slug} @${remaining}`).toBe(503);
        expect(
          upload.status === 429,
          `${slug} with ${remaining} characters left: the job route ` +
            `${jobRefused ? "refuses" : "admits"} the smallest job, the ` +
            `upload answered ${upload.status}`,
        ).toBe(jobRefused);
        seen.add(jobRefused);
      }
    }
    // Both verdicts occurred, or "they agree" proves nothing.
    expect([...seen].sort()).toEqual([false, true]);
  });

  it("answers a spent allowance with the allowance's own 429 before any upload", async () => {
    await leave(0);
    for (const slug of AI_TOOLS) {
      const res = await UPLOAD(post("/api/uploads", uploadOf(slug)));
      expect(res.status, slug).toBe(429);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("rate_limited");
      // The job route's own refusal, and the header the browser client states
      // in words (`@/lib/workers/read-error`) — until 2026-09-28 the body told
      // a browser user to read that header.
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(body.error.message).toBe(AI_ALLOWANCE_USED_MESSAGE);
    }
  });

  it("control: a non-AI upload is not asked about the AI allowance", async () => {
    await leave(0);
    for (const slug of NON_AI_UPLOAD_TOOLS.slice(0, 5)) {
      const res = await UPLOAD(post("/api/uploads", uploadOf(slug)));
      expect(res.status, slug).toBe(503);
    }
  });

  it("asking spends nothing: the whole day is still reservable after uploads", async () => {
    const uploads = Math.min(5, policyFor("uploads.create").limit - 1);
    for (let i = 0; i < uploads; i += 1) {
      const res = await UPLOAD(post("/api/uploads", uploadOf(AI_TOOLS[0]!)));
      expect(res.status).toBe(503);
    }
    const whole = await enforceAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE,
      post("/api/jobs", {}),
    );
    expect(whole.enforced).toBe(true);
    expect(whole.allowed, "an upload spent some of the allowance").toBe(true);
  });
});

describe("POST /api/uploads agrees with POST /api/jobs about the spend ceiling", () => {
  it("answers a spent ceiling with the job route's own 503, before any upload", async () => {
    const recorded = await recordAiSpend(policyFor("ai.spend").limit);
    expect(recorded, "health: the ceiling could not be spent").toBe(true);
    for (const slug of AI_TOOLS) {
      const upload = await UPLOAD(post("/api/uploads", uploadOf(slug)));
      const job = await CREATE_JOB(post("/api/jobs", jobOf(slug, 1)));
      expect(job.status, `health: ${slug}'s job route`).toBe(503);
      const jobBody = await job.json();
      expect(jobBody.error.message).toBe(AI_CEILING_REACHED_MESSAGE);
      expect(upload.status, slug).toBe(503);
      expect(await upload.json()).toEqual(jobBody);
    }
    // Control: a non-AI upload never reads the AI ceiling.
    const other = await UPLOAD(
      post("/api/uploads", uploadOf(NON_AI_UPLOAD_TOOLS[0]!)),
    );
    expect((await other.json()).error.code).toBe("worker_not_configured");
  });
});

describe("what the panel receives", () => {
  /** A fetch that sends `/api/uploads` to the real route and records everything. */
  function throughTheRoute() {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push(input);
      if (input !== "/api/uploads") throw new Error(`unexpected ${input}`);
      return UPLOAD(
        new Request(`http://localhost${input}`, {
          method: init?.method ?? "GET",
          headers: init?.headers ?? {},
          body: init?.body ?? null,
        }),
      );
    };
    return { calls, fetchImpl };
  }

  async function textPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc
      .addPage([300, 300])
      .drawText("Quarterly revenue rose.", { x: 20, y: 150, size: 12, font });
    return doc.save();
  }

  it("a spent allowance reads as the allowance, and not one byte is PUT", async () => {
    const bytes = await textPdf();
    await leave(0);
    for (const slug of AI_TOOLS) {
      const { calls, fetchImpl } = throughTheRoute();
      const result = await runSecurityJob(
        slug,
        "report.pdf",
        bytes,
        {},
        {
          fetchImpl,
        },
      );
      expect(result.ok, slug).toBe(false);
      const message = !result.ok ? result.message : "";
      expect(message.startsWith(AI_ALLOWANCE_USED_MESSAGE), slug).toBe(true);
      // What the panel renders: a wait a reader can act on, not a header name
      // — said by the browser client from the route's Retry-After.
      expect(message, slug).toMatch(/ Try again in about [^.]+\.$/);
      expect(message, slug).not.toMatch(/header|retry-after/i);
      expect(calls, `${slug} went past the refused upload`).toEqual([
        "/api/uploads",
      ]);
    }
  });

  it("positive control: with allowance left the panel hears the worker, not the allowance", async () => {
    const bytes = await textPdf();
    const { fetchImpl } = throughTheRoute();
    const result = await runSecurityJob(
      AI_TOOLS[0]!,
      "report.pdf",
      bytes,
      {},
      { fetchImpl },
    );
    expect(!result.ok && result.code).toBe("worker_not_configured");
  });
});
