/**
 * A 429 says how long to wait, and the wait reaches the caller as a NUMBER
 * (batch plan P3, "Type fix").
 *
 * `readWorkerError` read `Retry-After` into `retryAfterSeconds` on every 429,
 * and `uploadToWorkerSlot` carried it on a refused reservation, while
 * neither `PdfSecurityWorkerFailure` nor `OcrWorkerFailure` declared the
 * field (CLAUDE.md rule 3: the failure path got the minimal type). The value
 * travelled at runtime only by accident of a spread, invisible to every
 * caller that typed its result; a batch that must PAUSE on a rate limit,
 * rather than fail the file, could not read it without a cast.
 *
 * The type half is checked by `tsc` (`expectTypeOf` is erased at runtime);
 * the runtime half drives the real clients over an injected fetch whose
 * reservation, or job creation, answers 429 with `Retry-After`.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  runSecurityJob,
  type FetchLike,
  type PdfSecurityWorkerFailure,
} from "./pdf-security-client";
import {
  runWorkerOcr,
  type FetchLike as OcrFetchLike,
  type OcrWorkerFailure,
} from "./ocr-client";
import type { OcrOptions } from "@/lib/jobs/ocr";

const WAIT = 900;

function respond(status: number, body: unknown, headers = {}) {
  const h = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: { get: (name: string) => h.get(name.toLowerCase()) ?? null },
  };
}

const LIMITED = respond(
  429,
  { error: { code: "rate_limited", message: "Too many requests." } },
  { "Retry-After": WAIT },
);

/** Every request answered, in order; the reservation or the job is limited. */
function network(limitAt: "/api/uploads" | "/api/jobs") {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === limitAt) return LIMITED;
    if (url === "/api/uploads")
      return respond(200, {
        slots: [
          {
            fileId: "file_1",
            url: "https://upload.example/slot",
            method: "PUT",
            headers: {},
          },
        ],
      });
    if (url === "https://upload.example/slot") return respond(200, {});
    throw new Error(`unexpected request ${url}`);
  };
  return { calls, fetchImpl };
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

describe("retryAfterSeconds is declared on every worker failure type", () => {
  it("is part of the type, as a number (tsc)", () => {
    expectTypeOf<PdfSecurityWorkerFailure>()
      .toHaveProperty("retryAfterSeconds")
      .toEqualTypeOf<number | undefined>();
    expectTypeOf<OcrWorkerFailure>()
      .toHaveProperty("retryAfterSeconds")
      .toEqualTypeOf<number | undefined>();
  });
});

describe("a 429 surfaces its wait to the caller", () => {
  for (const at of ["/api/uploads", "/api/jobs"] as const) {
    it(`the security/Office/HTML runner, limited at ${at}`, async () => {
      const { calls, fetchImpl } = network(at);
      const result = await runSecurityJob(
        "optimize-web",
        "a.pdf",
        PDF,
        {},
        { fetchImpl: fetchImpl as FetchLike, sleep: async () => {} },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("rate_limited");
      expect(result.retryAfterSeconds).toBe(WAIT);
      // Health: the request that was limited is the one named, and nothing
      // after it ran.
      expect(calls[calls.length - 1]).toBe(`POST ${at}`);
    });

    it(`OCR, limited at ${at}`, async () => {
      const { calls, fetchImpl } = network(at);
      const result = await runWorkerOcr(
        {
          filename: "scan.pdf",
          bytes: PDF,
          contentType: "application/pdf",
          options: {
            languages: ["eng"],
            outputMode: "searchable-pdf",
          } as OcrOptions,
        },
        { fetchImpl: fetchImpl as OcrFetchLike, sleep: async () => {} },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("rate_limited");
      expect(result.retryAfterSeconds).toBe(WAIT);
      expect(calls[calls.length - 1]).toBe(`POST ${at}`);
    });
  }
});
