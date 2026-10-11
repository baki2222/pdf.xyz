// @vitest-environment node
// @native-canvas
/**
 * The browser's job client declares every file type the server accepts.
 *
 * The defect this exists for (details in `mime-by-format.ts`): the shared
 * runner declared every upload `application/pdf`, so Word, Excel, PowerPoint
 * and HTML to PDF were refused with 415 for every real user, while the worker
 * proof harness — which builds its own, correct requests — reported all four
 * PASS. A proof of the path next to the one users take.
 *
 * So this does not test the declaration function in isolation. It runs the
 * REAL browser client (`runSecurityJob`) against the REAL upload route handler
 * (`POST /api/uploads`), for every format of every upload-backed tool in the
 * catalogue. With worker env absent, a request that clears the intake gate AND
 * the per-tool validator is answered `503 worker_not_configured`; a refused one
 * is 4xx. The chain, not the units.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import { tools } from "@/lib/tools";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import { runSecurityJob } from "@/lib/workers/pdf-security-client";
import { POST } from "@/app/api/uploads/route";
import { declaredContentTypeFor, MIME_BY_FORMAT } from "./mime-by-format";
import { MIME_BY_FORMAT as VALIDATED_TABLE } from "./validation";

beforeEach(() => {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  resetRateLimitGuardForTests();
});

/** Every (tool, format) pair a user can actually upload, from the catalogue. */
const ALL_FORMATS = tools
  .filter((t) => modeUploadsFiles(t.processing))
  .flatMap((t) => t.accept.map((format) => ({ tool: t.slug, format })));

/**
 * Formats a tool accepts that are not FILES. `webpage-to-pdf` takes a link the
 * user types; there is nothing to upload and nothing to declare. The server
 * ignores formats with no MIME too (`allowedMimeTypesForTool`).
 *
 * Pinned as an exact list rather than filtered away: a filter would also hide
 * a typo'd format (`DOCZ`) that silently accepts nothing. A new unmapped
 * format fails the test below and has to be a decision.
 */
const NOT_A_FILE = [{ tool: "webpage-to-pdf", format: "URL" }];

const CASES = ALL_FORMATS.filter(
  (c) => MIME_BY_FORMAT[c.format.toUpperCase()] !== undefined,
);

/**
 * Drive the browser client into the route handler, and report the status the
 * route gave the upload-session request.
 */
async function sessionStatusFor(
  tool: string,
  filename: string,
): Promise<number | "refused-locally"> {
  let status: number | null = null;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/uploads") {
      resetRateLimitGuardForTests();
      const res = await POST(
        new Request("http://localhost/api/uploads", init as RequestInit),
      );
      status = res.status;
      return res;
    }
    throw new Error(`unexpected request past the session step: ${url}`);
  }) as typeof fetch;

  const result = await runSecurityJob(
    tool,
    filename,
    new Uint8Array(2048),
    {},
    { fetchImpl, maxPollAttempts: 1, pollIntervalMs: 0 },
  );
  if (status === null) {
    expect(result.ok).toBe(false);
    return "refused-locally";
  }
  return status;
}

describe("the browser's declared type is the type the server accepts", () => {
  it("covers every upload-backed tool and format (health check)", () => {
    // A catalogue walk that found nothing would pass everything below.
    const toolCount = new Set(CASES.map((c) => c.tool)).size;
    expect(toolCount, "upload-backed tools found").toBeGreaterThanOrEqual(18);
    expect(CASES.length).toBeGreaterThanOrEqual(25);
    // The four that were broken are in the set by name, as proof the walk
    // can see them — not as the corpus.
    for (const slug of [
      "word-to-pdf",
      "excel-to-pdf",
      "powerpoint-to-pdf",
      "html-to-pdf",
    ]) {
      expect(
        CASES.some((c) => c.tool === slug),
        slug,
      ).toBe(true);
    }
  });

  it.each(CASES)(
    "$tool accepts a .$format declared by the browser client",
    async ({ tool, format }) => {
      const filename = `sample.${format.toLowerCase()}`;
      expect(
        declaredContentTypeFor(filename),
        `no declared type for ${format}`,
      ).toBeTruthy();
      const status = await sessionStatusFor(tool, filename);
      expect(
        status,
        `${tool} refused ${filename} declared as ${declaredContentTypeFor(filename)}`,
      ).toBe(503);
    },
  );

  it("every format with no MIME is a known non-file input", () => {
    const unmapped = ALL_FORMATS.filter(
      (c) => MIME_BY_FORMAT[c.format.toUpperCase()] === undefined,
    );
    expect(unmapped).toEqual(NOT_A_FILE);
  });

  it("the route really refuses a mismatch (positive control)", async () => {
    // Without this, 503 everywhere could mean the route accepts anything. The
    // old client's exact request: a .docx declared as a PDF.
    resetRateLimitGuardForTests();
    const res = await POST(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tool: "word-to-pdf",
          files: [
            {
              filename: "letter.docx",
              contentType: "application/pdf",
              bytes: 2048,
            },
          ],
        }),
      }),
    );
    expect(res.status).toBe(415);
  });

  it("declares nothing for a format no tool accepts", async () => {
    expect(declaredContentTypeFor("payload.exe")).toBeNull();
    expect(declaredContentTypeFor("no-extension")).toBeNull();
    expect(declaredContentTypeFor("trailing.")).toBeNull();
    // And the client refuses it locally instead of sending a doomed request.
    expect(await sessionStatusFor("word-to-pdf", "payload.exe")).toBe(
      "refused-locally",
    );
  });

  it("is the table the server validates with, not a copy", () => {
    // validation.ts re-exports this module's object; a second table would be a
    // second truth. This used to check only `toContain("DOCX")`, which a copy
    // passes just as well — identity is the property.
    expect(VALIDATED_TABLE).toBe(MIME_BY_FORMAT);
    // Positive control: an equal copy is NOT the table.
    expect({ ...MIME_BY_FORMAT }).not.toBe(MIME_BY_FORMAT);
    expect(Object.keys(MIME_BY_FORMAT)).toContain("DOCX");
  });
});
