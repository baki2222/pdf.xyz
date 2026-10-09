// @vitest-environment node
/**
 * What the extraction MODEL receives, for a job that declares its characters
 * and for one that does not — driven through every tier a real job crosses.
 *
 * ── WHY (2026-10-09) ────────────────────────────────────────────────────────
 *
 * The production proof of ai-extract came back "every requested value is
 * null" on the first run after PR #167, which had put a read cap on per-call
 * AI runs (`processor/read-cap-limit.ts`) priced from the route
 * (`aiReservationFor`). The leading suspicion was that the cap had shrunk the
 * document to nothing for an undeclared job. Every test of the cap stopped at a
 * seam: the route's price, the queue's round-trip, the processor with a
 * hand-built input. None asked what reached the provider from a job a client
 * actually submitted.
 *
 * So this file starts where a user starts and ends where a user ends:
 *
 *   the REAL browser client (`runWorkerAiExtract`, as the panel calls it)
 *     → upload, PUT the bytes
 *     → the REAL `POST /api/jobs` (pricing, allowance, adapter)
 *     → the Redis queue over the Upstash REST wire (faithful in-memory Redis)
 *     → the REAL executor's claim
 *     → the REAL ai-extract processor (`perCallReadLimit`) and engine
 *     → a model that records the document it is shown
 *     → the REAL `GET /api/jobs/{id}`, and the artifact download
 *     → the production proof's own verifier, on the bytes the client received.
 *
 * MEASURED: the provider receives every row of the proof's table whether or
 * not the job declares its characters. An undeclared job carries NO delivery
 * cap at all (the engine's own limit applies); a declared one carries
 * `declared × headroom`, which the table's text does not reach. The read cap
 * was not the defect — the proof's request was (`@/lib/probes/extraction-proof`).
 * The NEGATIVE CONTROL is what makes "it arrived whole" mean something: a job
 * that declares less than its document is cut exactly where its cap says.
 *
 * ── WHAT IS NOT REAL ────────────────────────────────────────────────────────
 *
 *  - The upload route and the object store: the client's upload is answered
 *    here and its bytes land in the local-dev store the executor reads. The
 *    upload route only peeks the allowance (`ai-read-declaration.chain.test.ts`).
 *  - `pdftotext`: the worker's REAL extractor function runs (`runPdfText`,
 *    `parseLayoutText`, `collapseLayoutPadding`) with its subprocess seam
 *    answering `-layout` text laid out from the proof's rows. When a
 *    `pdftotext` is on this host's PATH the same chain also runs on the real
 *    binary — the suite name says which ran.
 *  - The model: `@/tests/literal-extraction-model`, which answers what the
 *    engine's prompt asks of the text it was shown. No provider is called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { AI_DELIVERY_LIMITS } from "@/lib/jobs/delivery-cap";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  PROOF_EXTRACTION_SCHEMA,
  PROOF_TABLE_ROWS,
  PROOF_TABLE_TITLE,
  verifyExtractionProof,
} from "@/lib/probes/extraction-proof";
import { proofTablePdf } from "@/tests/extraction-proof-fixtures";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import { resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import { POST } from "@/app/api/jobs/route";
import { GET } from "@/app/api/jobs/[id]/route";
import { literalExtractionModel } from "@/tests/literal-extraction-model";
import {
  publishHeartbeat,
  unwireJobRoute,
  wireJobRoute,
  type WiredJobRoute,
} from "@/tests/wired-job-route";
import { countDeclaredCharacters } from "./ai-declared-characters";
import { runWorkerAiExtract } from "./ai-extract-client";
import { createLocalDevExecutorStorage } from "./executor/local-dev-storage";
import { createWorkerExecutor } from "./executor/executor";
import {
  buildHeartbeat,
  emptyCapabilities,
  serializeHeartbeat,
} from "./heartbeat";
import type { FetchLike, PdfSecurityWorkerResult } from "./pdf-security-client";
import {
  createNativePdfTextExtractor,
  probePdfTextFromConfig,
  resolveNativePdfTextExtractor,
} from "./pdf-text/native";
import { resolveNativePdfTextConfig } from "./pdf-text/native-config";
import { createProcessorRegistry } from "./processor";
import type { ClaimableQueue, ClaimedJob } from "./queue/claim";
import { createRedisQueue } from "./queue/redis";
import { parseRedisQueueConfig } from "./queue/redis-config";
import { DevWorkerStore } from "./store";

/* ------------------------------------------------------------------ *
 *  The worker's text extractor.
 * ------------------------------------------------------------------ */

/**
 * The proof PDF as `pdftotext -layout` prints it: the title, a blank line, and
 * each row with its cells padded out to their columns, then a page break.
 * Derived from the rows the PDF is drawn from, never typed beside them.
 */
const LAYOUT =
  [
    `      ${PROOF_TABLE_TITLE}`,
    "",
    ...PROOF_TABLE_ROWS.map(
      (row) =>
        "      " +
        row
          .map((cell) => cell.padEnd(17))
          .join("")
          .trimEnd(),
    ),
  ].join("\n") + "\n\f";

interface WorkerExtractor {
  readonly label: string;
  /** What the extractor was handed and what it returned, per job. */
  readonly seen: { bytes: Uint8Array; text: string }[];
  readonly extract: (bytes: Uint8Array) => Promise<ExtractedPdfText>;
}

function recording(
  label: string,
  inner: (bytes: Uint8Array) => Promise<ExtractedPdfText>,
): WorkerExtractor {
  const seen: { bytes: Uint8Array; text: string }[] = [];
  return {
    label,
    seen,
    extract: async (bytes) => {
      const out = await inner(bytes);
      seen.push({ bytes, text: out.text.trim() });
      return out;
    },
  };
}

/** The production extractor function, its subprocess answering {@link LAYOUT}. */
function layoutSeamExtractor(): WorkerExtractor {
  return recording(
    "pdftotext -layout (subprocess seam answering the proof's layout)",
    createNativePdfTextExtractor(
      "pdftotext",
      resolveNativePdfTextConfig({}),
      "collapse",
      {
        exec: async () => LAYOUT,
        fs: {
          mkdtemp: async () => "seam",
          writeFile: async () => {},
          rm: async () => {},
        },
      },
    ),
  );
}

const NATIVE_BINARY = probePdfTextFromConfig(resolveNativePdfTextConfig({}));

const EXTRACTORS: (() => WorkerExtractor)[] = [
  layoutSeamExtractor,
  ...(NATIVE_BINARY
    ? [
        () =>
          recording(
            `the real ${NATIVE_BINARY} on this host`,
            resolveNativePdfTextExtractor({})!,
          ),
      ]
    : []),
];

/* ------------------------------------------------------------------ *
 *  One wired deployment, from the browser client to the download.
 * ------------------------------------------------------------------ */

let route: WiredJobRoute;
let store: DevWorkerStore;

beforeEach(() => {
  resetRateLimitGuardForTests();
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  route = wireJobRoute();
  store = new DevWorkerStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  unwireJobRoute();
});

/** The running worker publishes that it enforces the per-call read cap. */
async function workerProvesReadCap(): Promise<void> {
  await publishHeartbeat(
    route,
    serializeHeartbeat(
      buildHeartbeat({
        mode: "loop",
        capabilities: { ...emptyCapabilities(), aiReadCap: true },
        at: Date.now(),
      }),
    ),
  );
}

const fromResponse = (res: Response) => ({
  ok: res.ok,
  status: res.status,
  headers: res.headers,
  json: () => res.json(),
  arrayBuffer: () => res.arrayBuffer(),
});

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  arrayBuffer: async () => new ArrayBuffer(0),
});

interface Run {
  result: PdfSecurityWorkerResult;
  /** The JSON body the client POSTed to /api/jobs. */
  body: Record<string, unknown>;
  /** What the route answered it. */
  status: number;
  /** The job as the worker's executor claimed it off the queue. */
  claimed: ClaimedJob;
  /** The document text the model was shown. */
  document: string;
  extractor: WorkerExtractor;
}

/** Drive one panel-shaped job through the whole deployment. */
async function runJob(
  pdf: Uint8Array,
  declaredCharacters: number | null,
  makeExtractor: () => WorkerExtractor,
): Promise<Run> {
  const extractor = makeExtractor();
  const model = literalExtractionModel();
  const redis = parseRedisQueueConfig(process.env);
  if (!redis.ok) throw new Error("the wired Redis queue did not configure");
  const base = createRedisQueue(redis.config);
  const claims: ClaimedJob[] = [];
  const queue: ClaimableQueue = {
    ...base,
    claim: async (options) => {
      const claim = await base.claim(options);
      if (claim.ok && claim.value) claims.push(claim.value);
      return claim;
    },
  };
  const executor = createWorkerExecutor({
    queue,
    storage: createLocalDevExecutorStorage({ store }),
    registry: createProcessorRegistry({
      aiExtract: { extract: extractor.extract, provider: model },
    }),
  });

  const bodies: Record<string, unknown>[] = [];
  const statuses: number[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const text = (raw: unknown) =>
      typeof raw === "string"
        ? raw
        : new TextDecoder().decode(raw as ArrayBuffer);
    if (url === "/api/uploads") {
      const req = JSON.parse(text(init?.body)) as {
        files: { filename: string; contentType: string; bytes: number }[];
      };
      const file = req.files[0]!;
      const slot = store.reserveSlot({
        sessionId: "sess_chain0000000",
        filename: file.filename,
        contentType: file.contentType,
        declaredBytes: file.bytes,
      });
      return answer(201, {
        slots: [
          { fileId: slot.fileId, url: `/upload/${slot.fileId}`, method: "PUT" },
        ],
      });
    }
    if (url.startsWith("/upload/")) {
      const put = store.putBytes(
        url.slice("/upload/".length),
        new Uint8Array(init!.body!),
      );
      return answer(put.ok ? 200 : 400, {});
    }
    if (url === "/api/jobs" && init?.method === "POST") {
      const body = JSON.parse(text(init.body)) as Record<string, unknown>;
      bodies.push(body);
      const res = await POST(
        new Request("http://localhost/api/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      statuses.push(res.status);
      return fromResponse(res);
    }
    if (url.startsWith("/api/jobs/")) {
      // The worker runs between the browser's polls, as in production.
      await executor.drain();
      const id = url.slice("/api/jobs/".length);
      return fromResponse(
        await GET(new Request(`http://localhost${url}`), {
          params: Promise.resolve({ id }),
        }),
      );
    }
    if (url.startsWith("/api/artifacts/local/")) {
      const artifact = store.getArtifact(
        url.slice("/api/artifacts/local/".length),
      );
      if (!artifact) return answer(404, {});
      return {
        ...answer(200, {}),
        arrayBuffer: async () =>
          artifact.bytes.buffer.slice(
            artifact.bytes.byteOffset,
            artifact.bytes.byteOffset + artifact.bytes.byteLength,
          ) as ArrayBuffer,
      };
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await runWorkerAiExtract(
    {
      filename: "table.pdf",
      bytes: pdf,
      declaredCharacters,
      mode: "schema",
      schema: PROOF_EXTRACTION_SCHEMA.map((field) => ({ ...field })),
    },
    { fetchImpl, pollIntervalMs: 0, maxPollAttempts: 3 },
  );

  // Health: one job, created, claimed, run, and one call to the model.
  expect(bodies, "the client never reached POST /api/jobs").toHaveLength(1);
  expect(claims, "the worker never claimed the job").toHaveLength(1);
  expect(model.documents, "the model was never asked").toHaveLength(1);
  expect(extractor.seen).toHaveLength(1);
  return {
    result,
    body: bodies[0]!,
    status: statuses[0]!,
    claimed: claims[0]!,
    document: model.documents[0]!,
    extractor,
  };
}

/** Every row of the proof table, as a line of the document, in order. */
function expectWholeTable(document: string): void {
  const lines = document.split("\n").map((line) => line.trim());
  expect(lines, "the title is missing").toContain(PROOF_TABLE_TITLE);
  let at = -1;
  for (const row of PROOF_TABLE_ROWS) {
    const next = lines.indexOf(row.join(" "), at + 1);
    expect(
      next,
      `the model was not shown the row "${row.join(" ")}"`,
    ).toBeGreaterThan(at);
    at = next;
  }
}

let pdf: Uint8Array;
beforeEach(async () => {
  pdf ??= await proofTablePdf();
});

describe("the corpus", () => {
  it("has the always-run extractor, and names the real one when this host has it", () => {
    expect(EXTRACTORS.length).toBeGreaterThanOrEqual(1);
    expect(EXTRACTORS.length).toBe(NATIVE_BINARY ? 2 : 1);
  });

  it("health: the browser counts the proof table, so the declared run is a real declaration", async () => {
    const counted = await countDeclaredCharacters(pdf);
    expect(counted).not.toBeNull();
    expect(counted!).toBeGreaterThan(PROOF_TABLE_ROWS.flat().join("").length);
  });
});

describe.each(EXTRACTORS.map((make) => [make().label, make] as const))(
  "the model receives the document — worker text from %s",
  (_label, makeExtractor) => {
    it("UNDECLARED (the API caller, and the production proof): no cap rides the job, and the whole table reaches the model", async () => {
      const run = await runJob(pdf, null, makeExtractor);
      expect(run.status).toBe(202);
      // The request the proof harness builds: tool, inputs, names, options.
      expect("declaredCharacters" in run.body).toBe(false);
      expect(
        run.claimed.delivery,
        "an undeclared job carries no delivery cap: the engine's own limit applies",
      ).toBeUndefined();
      // The extractor was handed the bytes the client uploaded.
      expect(run.extractor.seen[0]!.bytes).toEqual(pdf);
      expectWholeTable(run.document);
      expect(run.document).toBe(run.extractor.seen[0]!.text);
      // And the artifact the client downloaded passes the production proof.
      expect(run.result.ok).toBe(true);
      if (!run.result.ok) return;
      expect(await verifyExtractionProof(run.result.output)).toMatchObject({
        ok: true,
      });
    });

    it("DECLARED (the browser panel, under a worker proving its read cap): the cap is declared × headroom, and the whole table reaches the model", async () => {
      await workerProvesReadCap();
      const declared = await countDeclaredCharacters(pdf);
      const run = await runJob(pdf, declared, makeExtractor);
      expect(run.status).toBe(202);
      expect(run.body.declaredCharacters).toBe(declared);
      expect(
        route.heartbeatReads(),
        "health: the route never asked the running worker, so the declared price path did not run",
      ).toBeGreaterThan(0);
      expect(run.claimed.delivery).toEqual({
        characters: Math.ceil(declared! * AI_DELIVERY_LIMITS.headroom),
      });
      expect(run.extractor.seen[0]!.text.length).toBeLessThan(
        run.claimed.delivery!.characters,
      );
      expectWholeTable(run.document);
      expect(run.document).toBe(run.extractor.seen[0]!.text);
      expect(run.result.ok).toBe(true);
      if (!run.result.ok) return;
      expect(await verifyExtractionProof(run.result.output)).toMatchObject({
        ok: true,
      });
    });

    it("NEGATIVE CONTROL: a job declaring less than its document is cut exactly where its cap says", async () => {
      await workerProvesReadCap();
      // Small enough that `declared × headroom` lands inside the table.
      const declared = 10;
      const run = await runJob(pdf, declared, makeExtractor);
      const cap = Math.ceil(declared * AI_DELIVERY_LIMITS.headroom);
      expect(run.claimed.delivery).toEqual({ characters: cap });
      const whole = run.extractor.seen[0]!.text;
      expect(
        whole.length,
        "health: the cap must be shorter than the document",
      ).toBeGreaterThan(cap);
      expect(run.document).toBe(whole.slice(0, cap));
      expect(run.document).not.toContain(PROOF_TABLE_ROWS.at(-1)!.join(" "));
      // The cut is disclosed, and the proof refuses what it produced.
      expect(run.result.ok).toBe(true);
      if (!run.result.ok) return;
      expect(run.result.job.results?.ai?.truncation?.truncated).toBe(true);
      expect((await verifyExtractionProof(run.result.output)).ok).toBe(false);
    });
  },
);
