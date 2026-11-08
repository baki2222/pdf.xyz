// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  OCR_JOB_POLL,
  jobPollFor,
  type JobPollBudget,
} from "@/lib/jobs/client-wait";
import { OFFICE_OCR_TOOLS } from "@/lib/jobs/office-export-ocr";
import { runWorkerPdfOfficeExport } from "./pdf-office-export-client";
import type { FetchLike } from "./pdf-security-client";
import { runWorkerTableExtract } from "./table-extract-client";

/**
 * The wait a browser gives an OCR-first job (2026-11-08, review of audit
 * pdf-to-excel#2 / extract-tables#3).
 *
 * A job that runs OCR first runs OCR PDF's engine before the conversion, so
 * the page must wait as OCR PDF's does (`OCR_JOB_POLL`), not with the tool's
 * own, shorter budget, or it gives up on a scan that is still being read. A
 * reviewer removed the OCR branch from both clients and every test stayed
 * green: nothing drove a client to its give-up point. This one does, through
 * the real job lifecycle, and counts what the client actually did — the
 * status reads it made and the pauses between them — against a job that never
 * finishes.
 *
 * The subjects are DERIVED: every export in `OFFICE_OCR_TOOLS` (the list the
 * panel and the processor both read) plus Extract Tables, whose processor
 * always runs the shared OCR-first step.
 */

interface Observed {
  statusReads: number;
  pauses: number[];
  stillRunning: boolean;
}

/** A worker whose job is queued and never leaves `running`. */
function neverFinishing(): {
  fetchImpl: FetchLike;
  sleep: (ms: number) => Promise<void>;
  observed: () => Omit<Observed, "stillRunning">;
} {
  let statusReads = 0;
  const pauses: number[] = [];
  const json = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  const fetchImpl: FetchLike = async (url) => {
    if (url === "/api/uploads") {
      return json({
        slots: [
          {
            fileId: "file_1",
            url: "https://upload.example/slot",
            method: "PUT",
            headers: {},
          },
        ],
      });
    }
    if (url === "https://upload.example/slot") return json({});
    if (url === "/api/jobs") return json({ jobId: "job_1", status: "queued" });
    if (url === "/api/jobs/job_1") {
      statusReads += 1;
      return json({ jobId: "job_1", status: "running" });
    }
    throw new Error(`unexpected url ${url}`);
  };
  return {
    fetchImpl,
    sleep: async (ms) => {
      pauses.push(ms);
    },
    observed: () => ({ statusReads, pauses }),
  };
}

type Run = (
  ocr: boolean,
  harness: ReturnType<typeof neverFinishing>,
) => Promise<{ ok: boolean; stillRunning?: boolean }>;

const OCR_INPUT = { languages: ["eng"] } as const;
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const SUBJECTS: Array<{ tool: string; run: Run }> = [
  ...OFFICE_OCR_TOOLS.map((tool) => ({
    tool,
    run: ((ocr, h) =>
      runWorkerPdfOfficeExport(
        {
          tool,
          filename: "scan.pdf",
          bytes: BYTES,
          ...(ocr ? { ocr: OCR_INPUT } : {}),
        },
        { fetchImpl: h.fetchImpl, sleep: h.sleep },
      )) as Run,
  })),
  {
    tool: "extract-tables",
    run: (ocr, h) =>
      runWorkerTableExtract(
        {
          filename: "scan.pdf",
          bytes: BYTES,
          ...(ocr ? { ocr: OCR_INPUT } : {}),
        },
        { fetchImpl: h.fetchImpl, sleep: h.sleep },
      ),
  },
];

async function observe(subject: (typeof SUBJECTS)[number], ocr: boolean) {
  const h = neverFinishing();
  const result = await subject.run(ocr, h);
  expect(result.ok).toBe(false);
  return {
    ...h.observed(),
    stillRunning: !result.ok && result.stillRunning === true,
  } satisfies Observed;
}

function expectBudget(seen: Observed, budget: JobPollBudget): void {
  // The client stopped because it ran out of patience, not for another reason.
  expect(seen.stillRunning).toBe(true);
  expect(seen.statusReads).toBe(budget.maxAttempts);
  expect(seen.pauses).toHaveLength(budget.maxAttempts);
  expect(new Set(seen.pauses)).toEqual(new Set([budget.intervalMs]));
}

describe("an OCR-first job waits as OCR PDF's does", () => {
  it("the subject set is the derived one, and not empty", () => {
    expect(SUBJECTS.map((s) => s.tool)).toEqual([
      ...OFFICE_OCR_TOOLS,
      "extract-tables",
    ]);
    expect(SUBJECTS.length).toBeGreaterThanOrEqual(2);
  });

  for (const subject of SUBJECTS) {
    describe(subject.tool, () => {
      it("health check: its own budget differs from OCR's, so the two can be told apart", () => {
        const own = jobPollFor(subject.tool);
        expect(
          own.maxAttempts !== OCR_JOB_POLL.maxAttempts ||
            own.intervalMs !== OCR_JOB_POLL.intervalMs,
        ).toBe(true);
      });

      it("with OCR on, it polls OCR_JOB_POLL's interval and attempts", async () => {
        expectBudget(await observe(subject, true), OCR_JOB_POLL);
      });

      it("control: without OCR, it keeps the tool's own budget", async () => {
        expectBudget(await observe(subject, false), jobPollFor(subject.tool));
      });
    });
  }
});
