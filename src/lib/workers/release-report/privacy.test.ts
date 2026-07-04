// @vitest-environment node
/**
 * Hostile no-leak proof for the release evidence operator report (Phase 52). It feeds each source stuffed with
 * malicious labels, raw refs, path/URL/secret-shaped fields, digests, and embedded EXTRA fields an honest
 * document would never carry — as a VALID+COHERENT set, a TAMPERED one, and UNRECOGNIZED blobs — plus
 * malicious FILE PATHS, and proves the rendered report (json + text) never echoes a single one of them. The
 * report reduces every document to bounded enums, small counts, and booleans, and the renderers reach only the
 * reduced result — so there is nowhere for a locator or a byte to enter.
 */

import { describe, expect, it } from "vitest";
import { runReleaseReport } from "./run";
import { buildReportResult } from "./build";
import { renderReleaseReport } from "./render";
import {
  ingestSourcesFrom,
  makeArgs,
  makeProvider,
  NOW,
  passAudit,
  passBundle,
  type ReportObjects,
} from "./fixtures";

/** Locator / secret VALUES that must never appear in a report, from a hostile document or a path. */
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
];

type Obj = Record<string, unknown>;

/** Deep-stuff every NON-load-bearing field of a coherent bundle with secrets (keeping it self-consistent). */
function hostileBundle(): Obj {
  const b = JSON.parse(JSON.stringify(passBundle())) as Obj;
  b.evilTop = "s3://evil-bucket/secret";
  (b.rollup as Obj).detail = "192.168.44.7 sk-super-secret-token-value";
  b.guidance = ["bearer zzz999"];
  b.caveats = ["evil-bucket-name"];
  b.generatedAt = "leaked-object-key-9f3"; // the report uses its own stamp; the input stamp is dropped
  for (const s of b.stages as Obj[]) {
    s.detail = "refs/heads/feature/top-secret-launch";
    s.verdict = "us-gov-west-1"; // a stage's raw verdict token is reduced away (rollup keys on severity)
  }
  return b;
}

/** Deep-stuff every NON-load-bearing field of a coherent audit with secrets (keeping it self-consistent). */
function hostileAudit(): Obj {
  const a = JSON.parse(JSON.stringify(passAudit())) as Obj;
  a.evilTop = "akiaiosfodnn7example";
  (a.rollup as Obj).detail = "s3://evil-bucket/secret";
  a.guidance = ["refs/heads/feature/top-secret-launch"];
  a.caveats = ["evil-bucket-name"];
  a.nextAction = "bearer zzz999";
  (a.baseline as Obj).detail = "https://evil.example.com/webhook";
  (a.current as Obj).detail = "us-gov-west-1";
  for (const f of a.regressions as Obj[]) f.detail = "sk-super-secret-token-value"; // per-finding prose is dropped
  return a;
}

function assertNoLeak(output: string, label: string): void {
  const lower = output.toLowerCase();
  for (const secret of SECRETS) {
    expect(lower, `${label} leaked ${secret}`).not.toContain(secret.toLowerCase());
  }
}

function renderBoth(objs: ReportObjects, label: string, strict = false): void {
  const result = buildReportResult(NOW, ingestSourcesFrom(objs), strict);
  assertNoLeak(renderReleaseReport(result, "json"), `${label}/json`);
  assertNoLeak(renderReleaseReport(result, "text"), `${label}/text`);
}

describe("release-report — hostile no-leak", () => {
  it("a VALID hostile bundle + audit renders content-free (promote-ready) in json + text", () => {
    const objs = { bundle: hostileBundle(), audit: hostileAudit() };
    const result = buildReportResult(NOW, ingestSourcesFrom(objs), false);
    expect(result.recommendation.recommendation).toBe("promote-ready"); // stays coherent (extras non-load-bearing)
    renderBoth(objs, "valid");
  });

  it("a TAMPERED hostile audit (fail) renders content-free in json + text", () => {
    const audit = hostileAudit();
    (audit.rollup as Obj).verdict = "warn"; // flip the recorded verdict → does not re-derive → tampered (hold-fail)
    const objs = { bundle: hostileBundle(), audit };
    const result = buildReportResult(NOW, ingestSourcesFrom(objs), false);
    expect(result.recommendation.recommendation).toBe("hold-fail");
    renderBoth(objs, "tampered");
  });

  it("UNRECOGNIZED hostile blobs (needs-evidence) render content-free in json + text", () => {
    const blob = {
      schema: "s3://evil-bucket/secret",
      evil: "sk-super-secret-token-value",
      akia: "akiaiosfodnn7example",
      ref: "refs/heads/feature/top-secret-launch",
    };
    const result = buildReportResult(NOW, ingestSourcesFrom({ bundle: blob, audit: blob }), false);
    expect(result.recommendation.recommendation).toBe("needs-evidence");
    renderBoth({ bundle: blob, audit: blob }, "unknown");
  });

  it("never echoes a malicious document FILE PATH — readable or unreadable — in output", async () => {
    const hostilePath = "/tmp/leak/customer-data.pdf";
    const missingPath = "s3://evil-bucket/secret/missing.json";
    const provider = {
      now: () => NOW,
      readFile: async (path: string) =>
        path === hostilePath ? JSON.stringify(hostileBundle()) : Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const run = await runReleaseReport(
      { format: "text", pretty: true, strict: false, bundlePath: hostilePath, auditPath: missingPath },
      provider,
    );
    assertNoLeak(run.output, "paths/text");
    expect(run.output).not.toContain(hostilePath);
    expect(run.output).not.toContain(missingPath);
  });

  it("the render reaches only the reduced result — a stray secret in an ingested field is impossible", () => {
    const result = buildReportResult(NOW, ingestSourcesFrom({ bundle: hostileBundle(), audit: hostileAudit() }), false);
    const json = JSON.parse(renderReleaseReport(result, "json"));
    // Every surfaced verdict is a bounded enum or null; no raw string escaped.
    for (const source of json.sources) {
      expect(source.verdict === null || typeof source.verdict === "string").toBe(true);
      expect(source).not.toHaveProperty("evilTop");
    }
    // The audit facts carry only bounded regression ids, never per-finding prose.
    const audit = json.sources.find((s: { id: string }) => s.id === "audit");
    if (audit.facts) for (const d of audit.facts.drivers) expect(typeof d).toBe("string");
  });

  it("a full report over a coherent (non-hostile) set never contains a forbidden token", async () => {
    const objs = { bundle: passBundle(), audit: passAudit() };
    for (const format of ["json", "text"] as const) {
      const run = await runReleaseReport(makeArgs(objs, { format }), makeProvider(objs));
      assertNoLeak(run.output, `coherent/${format}`);
    }
  });
});
