// @vitest-environment node
/**
 * The heartbeat is the only channel through which the web tier can learn which
 * recognition packs the running worker image actually holds.
 *
 * Before it carried them, `/api/worker/status` reported every language the catalogue
 * names and conceded, in its own detail string, that the packs "are not observable
 * from here". A user could pick a language the image had never installed and only
 * find out after uploading a document. The Dockerfile drift guard
 * (`src/deploy/ocr-languages.test.ts`) catches the same mismatch at CI time; this is
 * the runtime half, for the image that is actually deployed.
 *
 * Two directions matter and they are not symmetric:
 *  - a worker that REPORTS packs narrows the menu to exactly those, and
 *  - a worker that reports NOTHING must fall back to the full catalogue, because an
 *    empty list means "did not say", not "has no languages". Reading it the other way
 *    would blank the picker on a healthy deployment running an older worker build.
 */
import { describe, expect, it } from "vitest";
import { OCR_LANGUAGE_CODES } from "@/lib/jobs/ocr";
import { buildWorkerStatus } from "../status";
import { parseHeartbeat, serializeHeartbeat } from "./schema";
import type { WorkerHeartbeat } from "./types";

const BEAT: WorkerHeartbeat = {
  v: 1,
  role: "secure-worker",
  mode: "loop",
  capabilities: {
    deepCompression: true,
    ocr: true,
    ocrLanguages: ["eng", "ben"],
    malwareScan: false,
    atomicQueue: true,
    chunkedTranslate: true,
    deliveryCap: true,
    aiReadCap: true,
    pptxPresentationChain: true,
  },
  at: 1_700_000_000_000,
};

describe("the heartbeat carries the worker's real OCR languages", () => {
  it("survives a serialize/parse round trip", () => {
    const parsed = parseHeartbeat(serializeHeartbeat(BEAT));
    expect(parsed?.capabilities.ocrLanguages).toEqual(["eng", "ben"]);
  });

  it("drops anything outside the advertised vocabulary", () => {
    // A trust boundary: a corrupted record, a hostile broker, or simply a NEWER
    // worker that installed a pack this build does not advertise must not be able to
    // widen the menu. Unknown codes are dropped rather than rejecting the whole beat,
    // so one bad entry cannot take a healthy worker offline.
    const parsed = parseHeartbeat(
      JSON.stringify({
        ...BEAT,
        capabilities: {
          ...BEAT.capabilities,
          ocrLanguages: ["eng", "klingon", 42, null, "ben", "../../etc/passwd"],
        },
      }),
    );
    expect(parsed?.capabilities.ocrLanguages).toEqual(["eng", "ben"]);
  });

  it("normalizes to menu order, so the value does not depend on probe order", () => {
    const parsed = parseHeartbeat(
      JSON.stringify({
        ...BEAT,
        capabilities: {
          ...BEAT.capabilities,
          ocrLanguages: ["ben", "eng", "eng"],
        },
      }),
    );
    // `eng` is first in OCR_LANGUAGE_CODES; duplicates collapse.
    expect(parsed?.capabilities.ocrLanguages).toEqual(["eng", "ben"]);
  });

  it("narrows the offered menu to what the worker reports", () => {
    const status = buildWorkerStatus(
      "remote-configured",
      undefined,
      undefined,
      {},
      undefined,
      true,
      true,
      undefined,
      ["eng", "ben"],
    );
    expect(status.ocr.available).toBe(true);
    expect(status.ocr.languages).toEqual(["eng", "ben"]);
    expect(status.ocr.detail).toMatch(/actually has installed/i);
  });

  it("falls back to the full catalogue when the worker reports no languages", () => {
    const status = buildWorkerStatus(
      "remote-configured",
      undefined,
      undefined,
      {},
      undefined,
      true,
      true,
    );
    // Not an empty picker: silence means "did not say". The detail has to admit it.
    expect(status.ocr.languages).toEqual([...OCR_LANGUAGE_CODES]);
    expect(status.ocr.detail).toMatch(/not reporting which language packs/i);
  });
});
