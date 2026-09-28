// @vitest-environment node
/**
 * Every AI tool's job reserves what its document holds — driven from a real
 * PDF, through the real client, onto the wire, into the REAL route, against a
 * real limiter.
 *
 * THE DEFECT (2026-09-28): only Translate declared a character count. Summarize,
 * Chat with PDF and AI Data Extraction sent none, so `POST /api/jobs` reserved
 * its undeclared fallback — a third of the day — for every job. Three one-page
 * invoices of about 2,000 characters each spent the published "30,774 free
 * characters a day", and the fourth was refused with a message about text
 * "translated by someone else" and an HTTP header.
 *
 * WHY NOTHING CAUGHT IT: `declared-characters.chain.test.ts` drove the one
 * client that declared, by name. The route honoured declarations correctly and
 * every allowance test drove the route or the guard directly — with a
 * declaration the test itself supplied. No test started where a user starts,
 * with a file in a panel, so none could see that three of four clients never
 * produced the field. The set searched was the one client that worked.
 *
 * THE CORPUS IS THE CATALOG: every AI-capability tool must have a driver here,
 * in both directions, and a floor stops it shrinking to nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  AI_DELIVERY_LIMITS,
  REQUIRED_WORKER_ENV,
  capabilityForMode,
  deliveryCapFor,
  parseCreateJobRequest,
} from "@/lib/jobs";
import { tools } from "@/lib/tools";
import {
  AI_CHARACTER_ALLOWANCE,
  AI_CHARACTER_ALLOWANCE_DELIVERED,
  AI_ALLOWANCE_USED_MESSAGE,
} from "@/lib/jobs/ai-allowance";
import { NO_SELECTABLE_TEXT_MESSAGE } from "@/lib/jobs/ai-no-text";
import { extractPdfText } from "@/lib/pdf/text";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import {
  enforceAiCharacterAllowance,
  resetRateLimitGuardForTests,
} from "@/lib/ratelimit/guard";
import { POST } from "@/app/api/jobs/route";
import { S3_ENV } from "./storage/s3-config";
import { REDIS_QUEUE_ENV } from "./queue/redis-config";
import { createFakeRedis } from "./queue/redis-fake";
import { redisRestFetch } from "./queue/redis-rest-fake";
import type { FetchLike, PdfSecurityWorkerResult } from "./pdf-security-client";
import { declareAiRead, READ_BOUND_AI_TOOLS } from "./ai-read-declaration";
import { runWorkerAiExtract } from "./ai-extract-client";
import { runWorkerSummarize } from "./summarize-client";
import { runWorkerChatWithPdf } from "./chat-with-pdf-client";
import { runWorkerTranslate } from "./translate-client";

/* ------------------------------------------------------------------ *
 *  Fixtures: real PDFs, counted by the real extractor.
 * ------------------------------------------------------------------ */

const LINE =
  "Invoice 2026-0412. Consulting services rendered in March, net 30 days. ";

async function textPdf(pages: number, linesPerPage: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p += 1) {
    const page = doc.addPage([612, 792]);
    for (let l = 0; l < linesPerPage; l += 1) {
      page.drawText(`${LINE}(${p + 1}.${l + 1})`, {
        x: 20,
        y: 770 - l * 15,
        size: 8,
        font,
      });
    }
  }
  return doc.save();
}

async function blankPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  return doc.save();
}

/* ------------------------------------------------------------------ *
 *  Drivers: the REAL client for every AI tool, keyed by slug.
 * ------------------------------------------------------------------ */

type Driver = (
  bytes: Uint8Array,
  declaredCharacters: number | undefined,
  fetchImpl: FetchLike,
) => Promise<PdfSecurityWorkerResult>;

const CLIENT_OPTS = { pollIntervalMs: 0, maxPollAttempts: 1 };

const DRIVERS: Record<string, Driver> = {
  "ai-extract": (bytes, declaredCharacters, fetchImpl) =>
    runWorkerAiExtract(
      {
        filename: "invoice.pdf",
        bytes,
        declaredCharacters,
        mode: "schema",
        schema: [{ name: "total", type: "number" }],
      },
      { ...CLIENT_OPTS, fetchImpl },
    ),
  "summarize-pdf": (bytes, declaredCharacters, fetchImpl) =>
    runWorkerSummarize(
      {
        filename: "invoice.pdf",
        bytes,
        declaredCharacters,
        length: "brief",
        format: "bullets",
      },
      { ...CLIENT_OPTS, fetchImpl },
    ),
  "chat-with-pdf": (bytes, declaredCharacters, fetchImpl) =>
    runWorkerChatWithPdf(
      {
        filename: "invoice.pdf",
        bytes,
        declaredCharacters,
        question: "What is the total?",
      },
      { ...CLIENT_OPTS, fetchImpl },
    ),
  // Translate's own chain test (`declared-characters.chain.test.ts`) owns its
  // page half. It is driven here too so the corpus is the whole catalog: the
  // defect was three clients out of four, found by testing the fourth.
  "translate-pdf": (bytes, declaredCharacters, fetchImpl) =>
    runWorkerTranslate(
      {
        filename: "invoice.pdf",
        bytes,
        targetLanguage: "fr",
        sourceLanguage: "auto",
        declaredCharacters: declaredCharacters ?? 1,
        declaredTextPages: 1,
      },
      { ...CLIENT_OPTS, fetchImpl },
    ),
};

const AI_TOOLS = tools
  .filter((tool) => capabilityForMode(tool.processing) === "ai")
  .map((tool) => tool.slug)
  .sort();

/* ------------------------------------------------------------------ *
 *  Transports.
 * ------------------------------------------------------------------ */

function decode(body: unknown): unknown {
  return JSON.parse(
    typeof body === "string"
      ? body
      : new TextDecoder().decode(body as ArrayBuffer),
  );
}

function stoppedJob(tool: string) {
  return {
    jobId: "job_test000001",
    tool,
    status: "failed",
    progress: 0,
    error: { code: "internal_error", message: "stop here", retryable: false },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    expiresAt: new Date(3_600_000).toISOString(),
    retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
  };
}

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  arrayBuffer: async () => new ArrayBuffer(0),
});

/**
 * Answers the upload calls itself and hands POST /api/jobs to `jobs`. The
 * upload is not under test: `POST /api/uploads` only PEEKS the allowance.
 */
function transport(
  tool: string,
  jobs: (body: unknown) => Promise<ReturnType<typeof response>>,
) {
  const statuses: number[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    if (url === "/api/uploads") {
      return response(201, {
        slots: [{ fileId: "f_abc123def456", url: "/upload/slot-1" }],
      });
    }
    if (url === "/upload/slot-1") return response(200, {});
    if (url === "/api/jobs" && init?.method === "POST") {
      const answered = await jobs(decode(init.body));
      statuses.push(answered.status);
      return answered;
    }
    if (url.startsWith("/api/jobs/")) return response(200, stoppedJob(tool));
    throw new Error(`unexpected request: ${url}`);
  };
  return { fetchImpl, statuses };
}

/** Capture the body only; answer with a job that stops polling at once. */
function capture(tool: string) {
  const bodies: unknown[] = [];
  const t = transport(tool, async (body) => {
    bodies.push(body);
    return response(201, stoppedJob(tool));
  });
  return { ...t, bodies };
}

/** Hand the body to the REAL route. */
function toRoute(tool: string) {
  return transport(tool, async (body) => {
    const res = await POST(
      new Request("http://localhost/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    return response(res.status, await res.json());
  });
}

/* ------------------------------------------------------------------ *
 *  A wired deployment, so the REAL adapter creates the job and keeps
 *  the charge (a failed creation is refunded — allowance-refund.chain).
 * ------------------------------------------------------------------ */

const QUEUE_URL = "https://queue-example-12345.upstash.io";
const WIRED_ENV: Record<string, string> = {
  [S3_ENV.provider]: "s3",
  [S3_ENV.endpoint]: "https://s3.us-east-1.amazonaws.com",
  [S3_ENV.region]: "us-east-1",
  [S3_ENV.bucket]: "pdfxyz-test",
  [S3_ENV.accessKeyId]: "AKIAEXAMPLE0000000",
  [S3_ENV.secretAccessKey]: "s3cr3tEXAMPLEkeyValue00000000000000000000",
  [REDIS_QUEUE_ENV.provider]: "redis",
  [REDIS_QUEUE_ENV.restUrl]: QUEUE_URL,
  [REDIS_QUEUE_ENV.restToken]: "AX_tokenEXAMPLEvalue000000000000000000000",
};

function wire() {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  resetRateLimitGuardForTests();
  process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  Object.assign(process.env, WIRED_ENV);
  vi.stubGlobal("fetch", redisRestFetch(createFakeRedis(), QUEUE_URL));
}

beforeEach(wire);

afterEach(() => {
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  for (const name of Object.keys(WIRED_ENV)) delete process.env[name];
  vi.unstubAllGlobals();
});

/** A bare request in the same bucket the route's requests land in. */
const sameConnection = () =>
  new Request("http://localhost/api/jobs", { method: "POST" });

/* ------------------------------------------------------------------ */

let invoice: Uint8Array;
let invoiceCharacters: number;
let longReport: Uint8Array;

beforeEach(async () => {
  if (invoice) return;
  invoice = await textPdf(1, 25);
  invoiceCharacters = (await extractPdfText(invoice)).characterCount;
  longReport = await textPdf(10, 50);
});

describe("the corpus", () => {
  it("every catalog AI tool has a driver, and every driver is a catalog AI tool", () => {
    expect(
      AI_TOOLS.length,
      "no AI tools — asking nothing",
    ).toBeGreaterThanOrEqual(4);
    expect(Object.keys(DRIVERS).sort()).toEqual(AI_TOOLS);
  });

  it("health: the invoice is small and the report is longer than a day", async () => {
    // The finding's own numbers: a one-page invoice of about 2,000 characters,
    // four of which fit in a day once they are charged for what they hold.
    expect(invoiceCharacters).toBeGreaterThan(1_000);
    expect(invoiceCharacters * 4).toBeLessThan(
      AI_CHARACTER_ALLOWANCE_DELIVERED,
    );
    expect((await extractPdfText(longReport)).characterCount).toBeGreaterThan(
      AI_CHARACTER_ALLOWANCE_DELIVERED,
    );
  });
});

describe("declareAiRead — what the panel counts before it uploads", () => {
  it.each(READ_BOUND_AI_TOOLS.map((slug) => [slug] as const))(
    "%s declares the characters the browser counted",
    async (slug) => {
      const declared = await declareAiRead(slug, invoice);
      expect(declared).toEqual({
        ok: true,
        declaredCharacters: invoiceCharacters,
      });
    },
  );

  it.each(READ_BOUND_AI_TOOLS.map((slug) => [slug] as const))(
    "%s clamps a document longer than a day to the day, rather than being refused",
    async (slug) => {
      const declared = await declareAiRead(slug, longReport);
      expect(declared).toEqual({
        ok: true,
        declaredCharacters: AI_CHARACTER_ALLOWANCE_DELIVERED,
      });
    },
  );

  it.each(READ_BOUND_AI_TOOLS.map((slug) => [slug] as const))(
    "%s refuses a PDF with no text in the worker's own words",
    async (slug) => {
      const declared = await declareAiRead(slug, await blankPdf());
      expect(declared).toEqual({
        ok: false,
        message: NO_SELECTABLE_TEXT_MESSAGE[slug],
      });
    },
  );

  it("declares nothing — rather than inventing a count — for a file pdfjs cannot open", async () => {
    const declared = await declareAiRead(
      "ai-extract",
      new Uint8Array([1, 2, 3]),
    );
    expect(declared).toEqual({ ok: true, declaredCharacters: undefined });
  });
});

describe("the declaration reaches the route's contract", () => {
  it.each(AI_TOOLS.map((slug) => [slug] as const))(
    "%s puts the count on the wire, and the parser and cap keep it",
    async (slug) => {
      const { fetchImpl, bodies } = capture(slug);
      await DRIVERS[slug]!(invoice, invoiceCharacters, fetchImpl);
      expect(
        bodies.length,
        `${slug}'s client never reached POST /api/jobs`,
      ).toBe(1);
      const body = bodies[0] as Record<string, unknown>;
      expect(
        body.declaredCharacters,
        `${slug}'s client dropped the count, so every job it creates reserves ` +
          "a third of the day",
      ).toBe(invoiceCharacters);
      const parsed = parseCreateJobRequest(body);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const cap = deliveryCapFor(parsed.value, AI_DELIVERY_LIMITS);
      expect(cap.characters).toBe(
        Math.ceil(invoiceCharacters * AI_DELIVERY_LIMITS.headroom),
      );
    },
  );

  it("POSITIVE CONTROL: an undeclared body reserves the whole fallback", async () => {
    // What every read-bound job reserved before 2026-09-28. If this ever
    // equalled the declared figure the assertion above could not tell them apart.
    const { fetchImpl, bodies } = capture("ai-extract");
    await DRIVERS["ai-extract"]!(invoice, undefined, fetchImpl);
    const body = bodies[0] as Record<string, unknown>;
    expect(body.declaredCharacters).toBeUndefined();
    const parsed = parseCreateJobRequest(body);
    if (!parsed.ok) throw new Error("the undeclared body stopped parsing");
    expect(deliveryCapFor(parsed.value, AI_DELIVERY_LIMITS).characters).toBe(
      Math.ceil(
        AI_DELIVERY_LIMITS.fallbackCharacters * AI_DELIVERY_LIMITS.headroom,
      ),
    );
  });
});

describe("through the REAL route: the finding's four invoices", () => {
  it.each(READ_BOUND_AI_TOOLS.map((slug) => [slug] as const))(
    "%s: a fourth small job is admitted, and the day is debited exactly what was declared",
    async (slug) => {
      const { fetchImpl, statuses } = toRoute(slug);
      for (let i = 0; i < 4; i += 1) {
        const declared = await declareAiRead(slug, invoice);
        if (!declared.ok) throw new Error(declared.message);
        await DRIVERS[slug]!(invoice, declared.declaredCharacters, fetchImpl);
      }
      expect(
        statuses,
        `${slug}: four one-page jobs are not four-thirds of a day — the ` +
          "fourth was refused because the client reserved the fallback",
      ).toEqual([202, 202, 202, 202]);

      // Pinned from both sides: exactly four declared reservations were taken.
      const spent =
        4 * Math.ceil(invoiceCharacters * AI_DELIVERY_LIMITS.headroom);
      const rest = await enforceAiCharacterAllowance(
        AI_CHARACTER_ALLOWANCE - spent,
        sameConnection(),
      );
      expect(rest.enforced, "health: the limiter must be counting").toBe(true);
      expect(rest.allowed, "the jobs cost MORE than they declared").toBe(true);
      const oneMore = await enforceAiCharacterAllowance(1, sameConnection());
      expect(oneMore.allowed, "the jobs cost LESS than they declared").toBe(
        false,
      );
    },
  );

  it("POSITIVE CONTROL: undeclared, the same four jobs hit the defect's 429", async () => {
    // Without this, "four 202s" could mean the harness can never produce a
    // refusal — a limiter that is off, a bucket the route does not share.
    const { fetchImpl, statuses } = toRoute("ai-extract");
    const results: PdfSecurityWorkerResult[] = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await DRIVERS["ai-extract"]!(invoice, undefined, fetchImpl));
    }
    expect(statuses).toEqual([202, 202, 202, 429]);
    const refused = results[3]!;
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    // What the reader is shown: the allowance, a time in words, no header,
    // and no tool the reader did not use.
    expect(refused.message.startsWith(AI_ALLOWANCE_USED_MESSAGE)).toBe(true);
    expect(refused.message).toMatch(
      /It resets in (?:about \d+ (?:hours?|minutes?)|under a minute)\.$/,
    );
    expect(refused.message).not.toMatch(/retry-after|header|translated/i);
  });

  it.each(READ_BOUND_AI_TOOLS.map((slug) => [slug] as const))(
    "%s: a document longer than a day is admitted on a fresh day, not refused",
    async (slug) => {
      const { fetchImpl, statuses } = toRoute(slug);
      const declared = await declareAiRead(slug, longReport);
      if (!declared.ok) throw new Error(declared.message);
      await DRIVERS[slug]!(longReport, declared.declaredCharacters, fetchImpl);
      expect(statuses).toEqual([202]);
    },
  );
});
