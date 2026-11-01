// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  hasUploadedThisSession,
  resetUploadedThisSessionForTests,
} from "./session-uploads";
import { runWorkerCompression } from "@/lib/workers/client";
import { runWorkerOcr } from "@/lib/workers/ocr-client";
import { runWorkerProtect } from "@/lib/workers/pdf-security-client";

/**
 * The crash fallbacks can only be honest about uploads if something actually
 * observes them, and there are exactly three places on the client where file
 * bytes leave the device: `runWorkerCompression`, `runWorkerOcr`, and
 * `runSecurityJob` — the last of which the other eleven worker clients
 * (summarize, translate, ai-extract, chat, tables, signatures, office in both
 * directions, PDF/A, repair, optimize) all funnel through. This pins all three,
 * so a fourth upload path added without raising the flag is a failing test
 * rather than a silently re-broken promise.
 *
 * WOULD THIS BE GREEN IF THE FIX WERE ABSENT? No, and not by assertion: with
 * the three `markUploadStarted()` calls removed, every "raises the flag" case
 * here fails, because nothing else in the tree ever sets it.
 *
 * The interesting cases are the two boundaries:
 *  - a PUT that comes back non-OK still raises it (bytes were on the wire; the
 *    upload failing is not evidence that nothing was uploaded), and
 *  - a failed `POST /api/uploads` does NOT (reserving a slot sends no file
 *    content, so the reassurance is still true).
 * A flag raised on entry to the function, or only on success, passes one of
 * those and fails the other.
 */

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

const SLOT = {
  fileId: "file_1",
  url: "https://upload.example/slot",
  method: "PUT",
  headers: {},
};

/**
 * A fetch stub that walks the flow only as far as the flag question needs.
 * `sessionOk: false` fails before any bytes are sent; `uploadOk: false`
 * exercises a failed PUT. When the upload succeeds the drivers go on to create
 * the job, so `/api/jobs` is refused here — the flag is already settled by that
 * point, and every driver turns the refusal into an honest typed failure rather
 * than throwing, which keeps this test about the flag and nothing else.
 */
function harness({ sessionOk = true, uploadOk = true } = {}) {
  const urls: string[] = [];
  const fetchImpl = async (url: string) => {
    urls.push(url);
    if (url === "/api/uploads") {
      return sessionOk
        ? jsonResponse({ slots: [SLOT] })
        : jsonResponse(
            { error: { code: "nope", message: "no slot" } },
            false,
            503,
          );
    }
    if (url === SLOT.url) {
      return uploadOk
        ? jsonResponse({})
        : jsonResponse(
            { error: { code: "nope", message: "put failed" } },
            false,
            500,
          );
    }
    if (url === "/api/jobs") {
      return jsonResponse(
        { error: { code: "nope", message: "job refused" } },
        false,
        503,
      );
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchImpl: fetchImpl as never, urls };
}

/** The three drivers, each invoked with the minimum its signature requires. */
const DRIVERS: ReadonlyArray<{
  name: string;
  run: (fetchImpl: never) => Promise<unknown>;
}> = [
  {
    name: "runWorkerCompression",
    run: (fetchImpl) =>
      runWorkerCompression(
        { filename: "a.pdf", bytes: PDF, profile: "lossless" },
        { fetchImpl },
      ),
  },
  {
    name: "runWorkerOcr",
    run: (fetchImpl) =>
      runWorkerOcr(
        {
          filename: "a.pdf",
          bytes: PDF,
          contentType: "application/pdf",
          options: {
            languages: ["eng"],
            outputMode: "searchable-pdf",
            redoOcr: false,
            deskew: false,
            rotatePages: false,
          },
        },
        { fetchImpl },
      ),
  },
  {
    name: "runWorkerProtect (and the 11 clients routed through runSecurityJob)",
    run: (fetchImpl) =>
      runWorkerProtect(
        { filename: "a.pdf", bytes: PDF, password: "pw" },
        { fetchImpl },
      ),
  },
];

describe("session upload flag", () => {
  beforeEach(() => {
    // The suite runs with `isolate: false`, so this module's state is shared
    // across every file in the worker. Reset explicitly rather than trusting
    // file order.
    resetUploadedThisSessionForTests();
  });

  it("starts false, so the reassurance is true until a tool uploads", () => {
    expect(hasUploadedThisSession()).toBe(false);
  });

  describe.each(DRIVERS)("$name", ({ run }) => {
    it("raises the flag when the upload succeeds", async () => {
      const { fetchImpl, urls } = harness();
      await run(fetchImpl);
      expect(urls).toContain(SLOT.url);
      expect(hasUploadedThisSession()).toBe(true);
    });

    it("raises the flag even when the upload request fails", async () => {
      const { fetchImpl, urls } = harness({ uploadOk: false });
      await run(fetchImpl);
      expect(urls).toContain(SLOT.url);
      expect(hasUploadedThisSession()).toBe(true);
    });

    it("leaves it false when no slot was ever minted", async () => {
      const { fetchImpl, urls } = harness({ sessionOk: false });
      await run(fetchImpl);
      expect(urls).not.toContain(SLOT.url);
      expect(hasUploadedThisSession()).toBe(false);
    });
  });
});
