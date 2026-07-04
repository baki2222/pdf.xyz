// @vitest-environment node
/**
 * Hostile no-leak proof for the release decision ledger index (Phase 60). It feeds a batch of decision records
 * stuffed with malicious labels, raw refs, reviewer identities, path/URL/secret-shaped fields, digests, and embedded
 * EXTRA fields an honest record would never carry — as VALID+COHERENT records, TAMPERED ones, and UNRECOGNIZED
 * blobs — plus malicious FILE PATHS, and proves the rendered summary (json + text) never echoes a single one of
 * them. The index reduces every record to bounded enums, small counts, and booleans, and the renderers reach only
 * the reduced result — so there is nowhere for a locator or a byte to enter.
 */

import { describe, expect, it } from "vitest";
import { runReleaseDecisionIndex } from "./run";
import { buildIndexResult } from "./build";
import { renderReleaseDecisionIndex } from "./render";
import {
  decisionFor,
  defaultPolicy,
  ingestRecordsFrom,
  makeArgs,
  makeProvider,
  NOW,
  proceedDecision,
} from "./fixtures";

/** Locator / secret / identity VALUES that must never appear in a summary, from a hostile record or a path. */
const SECRETS = [
  "akiaiosfodnn7example",
  "s3://evil-bucket/secret",
  "/tmp/leak/customer-data.pdf",
  "https://evil.example.com/webhook",
  "sk-super-secret-token-value",
  "refs/heads/feature/top-secret-launch",
  "bearer zzz999",
  "192.168.44.7",
  "leaked-object-key-9f3",
  "evil-bucket-name",
  "us-gov-west-1",
  "jane.reviewer@example.com", // a reviewer identity must never surface
  "Jane Q. Reviewer",
  "2099-12-31T23:59:59.000Z", // a hostile input stamp must never be echoed (the index uses its own)
];

type Obj = Record<string, unknown>;

/** Deep-stuff every NON-load-bearing field of a coherent record with secrets (keeping it self-consistent). */
function hostileRecord(): Obj {
  const r = JSON.parse(JSON.stringify(proceedDecision())) as Obj;
  r.evilTop = "s3://evil-bucket/secret";
  r.generatedAt = "2099-12-31T23:59:59.000Z"; // the index uses its OWN stamp; the input stamp is dropped
  (r.decision as Obj).detail = "192.168.44.7 sk-super-secret-token-value";
  (r.publishPack as Obj).detail = "refs/heads/feature/top-secret-launch";
  (r.acknowledgement as Obj).detail = "jane.reviewer@example.com";
  (r.acknowledgement as Obj).reviewer = "leaked-object-key-9f3"; // reviewer class is dropped by the index
  (r.crossCheck as Obj).detail = "evil-bucket-name";
  r.guidance = ["bearer zzz999"];
  r.caveats = ["us-gov-west-1", "Jane Q. Reviewer"];
  r.checklist = [{ id: "leaked-object-key-9f3", detail: "akiaiosfodnn7example" }];
  (r.receipt as Obj).at = "us-gov-west-1";
  return r;
}

function assertNoLeak(output: string, label: string): void {
  const lower = output.toLowerCase();
  for (const secret of SECRETS) {
    expect(lower, `${label} leaked ${secret}`).not.toContain(secret.toLowerCase());
  }
}

function renderBoth(objs: readonly unknown[], label: string, policy = {}): void {
  const result = buildIndexResult(NOW, ingestRecordsFrom(objs), defaultPolicy(policy));
  assertNoLeak(renderReleaseDecisionIndex(result, "json"), `${label}/json`);
  assertNoLeak(renderReleaseDecisionIndex(result, "text"), `${label}/text`);
}

describe("release-decision-index — hostile no-leak", () => {
  it("a batch of VALID hostile records renders content-free (stable) in json + text", () => {
    const objs = [hostileRecord(), hostileRecord(), hostileRecord()];
    const result = buildIndexResult(NOW, ingestRecordsFrom(objs), defaultPolicy());
    expect(result.index.verdict).toBe("stable"); // stays coherent (extras non-load-bearing)
    expect(result.ledger.recordsUsable).toBe(3);
    renderBoth(objs, "valid");
  });

  it("a TAMPERED hostile record (fail-closed) renders content-free in json + text", () => {
    const tampered = hostileRecord();
    (tampered.decision as Obj).decision = "reject"; // flip → no re-derive → tampered (invalid)
    const objs = [hostileRecord(), tampered];
    const result = buildIndexResult(NOW, ingestRecordsFrom(objs), defaultPolicy());
    expect(result.index.verdict).toBe("invalid");
    expect(result.index.reasons).toContain("record-tampered");
    renderBoth(objs, "tampered");
  });

  it("UNRECOGNIZED hostile blobs (invalid) render content-free in json + text", () => {
    const blob = {
      schema: "s3://evil-bucket/secret",
      evil: "sk-super-secret-token-value",
      akia: "akiaiosfodnn7example",
      ref: "refs/heads/feature/top-secret-launch",
      reviewer: "jane.reviewer@example.com",
    };
    const result = buildIndexResult(NOW, ingestRecordsFrom([blob, blob]), defaultPolicy());
    expect(result.index.verdict).toBe("invalid");
    renderBoth([blob, blob], "unreadable");
  });

  it("never echoes a malicious record FILE PATH — readable or unreadable — in output", async () => {
    const hostilePath = "/tmp/leak/customer-data.pdf";
    const missingPath = "s3://evil-bucket/secret/missing.json";
    const provider = {
      now: () => NOW,
      readFile: async (path: string) =>
        path === hostilePath ? JSON.stringify(hostileRecord()) : Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const run = await runReleaseDecisionIndex(
      { format: "text", pretty: true, stdin: false, maxRecords: 100, strict: false, recordPaths: [hostilePath, missingPath] },
      provider,
    );
    assertNoLeak(run.output, "paths/text");
    expect(run.output).not.toContain(hostilePath);
    expect(run.output).not.toContain(missingPath);
  });

  it("the render reaches only the reduced result — a stray secret in an ingested field is impossible", () => {
    const result = buildIndexResult(NOW, ingestRecordsFrom([hostileRecord(), hostileRecord()]), defaultPolicy());
    const json = JSON.parse(renderReleaseDecisionIndex(result, "json"));
    for (const point of json.points) {
      expect(point.decision === null || typeof point.decision === "string").toBe(true);
      expect(point).not.toHaveProperty("detail_evil");
      expect(point).not.toHaveProperty("evilTop");
    }
    expect(json.generatedAt).toBe(NOW); // the index's own stamp, never the hostile input's
  });

  it("a full summary over a coherent (non-hostile) batch never contains a forbidden token", async () => {
    const objs = [decisionFor("proceed"), decisionFor("hold"), decisionFor("proceed")];
    for (const format of ["json", "text"] as const) {
      const run = await runReleaseDecisionIndex(makeArgs(objs, { format }), makeProvider(objs));
      assertNoLeak(run.output, `coherent/${format}`);
    }
  });
});
