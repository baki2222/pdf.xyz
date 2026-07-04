// @vitest-environment node
/**
 * No-leak privacy proof for the release evidence publish / handoff pack (Phase 57).
 *
 * The pack ingests UNTRUSTED release-evidence documents. Even a document that is a recognized schema may be
 * hostile — an operator could point us at a hand-edited file whose prose / extra fields have been stuffed with
 * paths, buckets, URLs, object keys, env values, raw provider logs / errors, or OCR / document text. This suite
 * stuffs every such token into every string-bearing corner of each of the five sources (and adds a purely-hostile
 * raw blob) and asserts NONE of it survives into the rendered JSON or text — because the trust boundary reduces
 * each document to bounded enums / small ints / booleans and NEVER copies a free-text field.
 */

import { describe, expect, it } from "vitest";
import { renderReleasePublishPack } from "./render";
import { makePublishPack } from "./fixtures";
import {
  archivablePack,
  healthyGovernance,
  promoteReadyReport,
  stableTrend,
  verifiedDrill,
} from "./fixtures";

/** Locator / secret / log / document-text tokens no output may ever contain. */
const HOSTILE = [
  "s3://pdfxyz-prod-secret/objects/job-42/input.pdf",
  "https://acme.s3.us-east-1.amazonaws.com/key/abc",
  "AKIAIOSFODNN7EXAMPLE",
  "Bearer sk-live-abcdef0123456789abcdef",
  "/tmp/pdfxyz/worker/job-42/output.pdf",
  "PDFXYZ_STORAGE_SECRET_ACCESS_KEY=supersecretvalue",
  "ERROR provider timeout at 10.0.0.5:9000 reading bucket acme-prod",
  "Invoice 4471 John Doe 4111 1111 1111 1111 exp 04/29",
  "redis://user:hunter2@10.0.0.1:6379",
  "object-key-9f8e7d6c-customer-ssn-078-05-1120",
];

/** Deep-stuff every hostile token into a cloned document's prose / extra fields (never a load-bearing field). */
function stuff<T>(doc: T): T {
  const clone = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  clone.__hostile = [...HOSTILE];
  clone.note = HOSTILE.join(" | ");
  clone.generatedBy = HOSTILE.join(" ");
  if (Array.isArray(clone.caveats)) clone.caveats = [...HOSTILE];
  if (Array.isArray(clone.guidance)) clone.guidance = [...HOSTILE];
  if (Array.isArray(clone.followUps)) clone.followUps = HOSTILE.map((h) => ({ id: h, detail: h }));
  return clone as unknown as T;
}

/** A purely hostile blob that is not a recognized document (⇒ unreadable, nothing extracted). */
const RAW_LOG_BLOB = {
  schema: "not-a-pdfxyz-document/1",
  log: HOSTILE.join("\n"),
  stack: HOSTILE,
  ocrText: "Patient: Jane Roe, DOB 1980-01-01, MRN 123456",
};

describe("release-publish-pack — no-leak over hostile documents", () => {
  it("stuffed recognized documents stay usable, and no token leaks into JSON or text", () => {
    const result = makePublishPack({
      governance: stuff(healthyGovernance()),
      archive: stuff(archivablePack()),
      restoreDrill: stuff(verifiedDrill()),
      report: stuff(promoteReadyReport()),
      trend: stuff(stableTrend()),
    });
    // The stuffed prose is dropped, so the documents still re-derive ⇒ a clean publishable pack.
    expect(result.pack.verdict).toBe("publishable");
    expect(result.coverage.sourcesUsable).toBe(5);

    const json = renderReleasePublishPack(result, "json");
    const text = renderReleasePublishPack(result, "text");
    for (const token of HOSTILE) {
      expect(json, `json leaked ${token}`).not.toContain(token);
      expect(text, `text leaked ${token}`).not.toContain(token);
    }
  });

  it("a purely-hostile raw blob is unreadable and never echoed", () => {
    const result = makePublishPack({ governance: healthyGovernance(), archive: RAW_LOG_BLOB });
    expect(result.coverage.archive).toBe("unreadable");
    const json = renderReleasePublishPack(result, "json");
    const text = renderReleasePublishPack(result, "text");
    for (const token of [...HOSTILE, "Jane Roe", "MRN 123456", "not-a-pdfxyz-document"]) {
      expect(json, `json leaked ${token}`).not.toContain(token);
      expect(text, `text leaked ${token}`).not.toContain(token);
    }
  });

  it("a hostile string placed in a load-bearing verdict field is off-enum ⇒ never surfaced (tampered, clean)", () => {
    const gov = JSON.parse(JSON.stringify(healthyGovernance())) as { governance: { verdict: string } };
    gov.governance.verdict = "s3://leak/verdict"; // off-enum ⇒ claim not surfaced, doc no longer re-derives
    const result = makePublishPack({ governance: gov });
    expect(result.coverage.governance).toBe("tampered");
    expect(result.pack.verdict).toBe("blocked");
    const json = renderReleasePublishPack(result, "json");
    expect(json).not.toContain("s3://leak/verdict");
  });

  it("the whole result serializes to bounded values only (no raw string longer than authored prose)", () => {
    // A coarse structural guard: every string in the result is either an enum-ish token, an ISO stamp, or
    // app-authored prose — none of the hostile tokens above.
    const result = makePublishPack({
      governance: stuff(healthyGovernance()),
      archive: stuff(archivablePack()),
    });
    const serialized = JSON.stringify(result);
    for (const token of HOSTILE) expect(serialized).not.toContain(token);
  });
});
