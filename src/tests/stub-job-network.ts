import { vi } from "vitest";
import type { JobError } from "@/lib/jobs/types";
import type { WorkerStatus } from "@/lib/workers/status";

/**
 * The secure-worker pipeline as a browser job client meets it — status, upload
 * session, the upload itself, job creation — served over the global `fetch`,
 * so a panel test can drive the REAL client and the real panel instead of
 * `vi.mock`ing the client.
 *
 * WHY NOT `vi.mock`. `vitest.config.ts` runs `isolate: false`: a panel module
 * evaluated while its client is mocked stays in the shared module cache bound
 * to the stub, and every later test file in the same worker that imports the
 * panel gets the stub too (`src/tests/mock-isolation.test.ts`, which fails on
 * exactly that). A global `fetch` stub is removed by `vi.unstubAllGlobals()`.
 *
 * `jobOutcome` decides how the created job ended, from the parsed body of the
 * `POST /api/jobs` request — so the test can also read what was declared.
 */
export interface StubbedJobOutcome {
  /** A terminal job status: the client polls nothing further. */
  status: "failed" | "completed";
  error?: JobError;
}

export interface JobNetwork {
  /** Every `POST /api/jobs` body, parsed, in order. */
  readonly jobBodies: Record<string, unknown>[];
  /** How many uploads reached the slot. */
  readonly uploads: () => number;
}

/** A request body as the job client sends it: JSON, encoded to bytes. */
const parseBody = (body: RequestInit["body"]): Record<string, unknown> =>
  JSON.parse(
    typeof body === "string"
      ? body
      : new TextDecoder().decode(body as ArrayBuffer | Uint8Array),
  ) as Record<string, unknown>;

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

export function stubJobNetwork(
  status: WorkerStatus,
  jobOutcome: (body: Record<string, unknown>) => StubbedJobOutcome = () => ({
    status: "failed",
    error: {
      code: "internal_error",
      message: "stubbed failure",
      retryable: false,
    },
  }),
): JobNetwork {
  const jobBodies: Record<string, unknown>[] = [];
  let uploads = 0;
  const now = new Date(0).toISOString();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/api/worker/status")) return json(status);
      if (url === "/api/uploads" && method === "POST") {
        const body = parseBody(init?.body) as { tool?: string };
        return json(
          {
            sessionId: "s_stub",
            tool: body.tool,
            slots: [
              {
                fileId: "f_stub0000000000001",
                filename: "input.pdf",
                url: "/api/uploads/local/f_stub0000000000001",
                method: "PUT",
                headers: {},
              },
            ],
            expiresAt: now,
            retention: {},
          },
          201,
        );
      }
      if (url.startsWith("/api/uploads/local/") && method === "PUT") {
        uploads += 1;
        return json({});
      }
      if (url === "/api/jobs" && method === "POST") {
        const body = parseBody(init?.body);
        jobBodies.push(body);
        const outcome = jobOutcome(body);
        return json(
          {
            jobId: "j_stub",
            tool: body.tool,
            capability: "ai",
            status: outcome.status,
            progress: 100,
            ...(outcome.error ? { error: outcome.error } : {}),
            createdAt: now,
            updatedAt: now,
            expiresAt: now,
            retention: {},
          },
          201,
        );
      }
      throw new Error(`unexpected request in test: ${method} ${url}`);
    }),
  );
  return { jobBodies, uploads: () => uploads };
}
