// @vitest-environment node
// @native-canvas
/**
 * One telemetry report per file on a DEEP batch row, too (batch plan P0b).
 *
 * A deep row runs inside `runWorkerCompression`, which reports its own outcome
 * (`withToolOutcome`), and until 2026-11-08 the batch reported the same file a
 * second time. The batch now runs deep rows with `reportsOutcome: false` — so
 * a deep outcome that never reaches the worker client, such as a locked file
 * refused before upload, must be reported where it is refused, or it would be
 * reported by nobody. The composed chain (the runner, the hook, the worker
 * client, and a file the browser can no longer read) is counted in
 * `compress-batch-deep-report.dom.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCKED_PDF_COPY } from "@/lib/pdf/encryption";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { enterToolPage } from "@/lib/telemetry/tool-outcome";
import { ownerOnlyEncryptedPdf } from "@/tests/encrypted-pdf-fixture";
import { compressBatchFileDeep } from "./compress-batch";

let events: RedactedEvent[] = [];
let leave: () => void = () => {};
beforeEach(() => {
  events = [];
  configureTelemetry((e) => events.push(e));
  leave = enterToolPage({ toolSlug: "compress-pdf", capability: "hybrid" });
});
afterEach(() => {
  leave();
  resetTelemetry();
  vi.unstubAllGlobals();
});

describe("compressBatchFileDeep — a locked file refused before upload", () => {
  it("is reported exactly once, as an encrypted input, and nothing is uploaded", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: unknown) => {
      fetched.push(String(url));
      throw new Error("no request may leave for a locked file");
    });
    const bytes = await ownerOnlyEncryptedPdf();
    const file = new File([bytes.slice()], "locked.pdf", {
      type: "application/pdf",
    });
    await expect(
      compressBatchFileDeep(file, { targetDpi: 150, grayscale: false }),
    ).rejects.toThrow(LOCKED_PDF_COPY.restricted);
    expect(fetched).toEqual([]);
    const outcomes = events.filter(
      (e) => e.name === "tool_completed" || e.name === "tool_failed",
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      name: "tool_failed",
      // The redacted event carries the code as its reason.
      reason: "encrypted-input",
    });
  });
});
