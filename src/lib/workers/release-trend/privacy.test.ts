// @vitest-environment node
/**
 * Hostile no-leak proof for the release evidence trend summary (Phase 53). It feeds a history of reports stuffed
 * with malicious labels, raw refs, path/URL/secret-shaped fields, digests, and embedded EXTRA fields an honest
 * report would never carry — as VALID+COHERENT reports, TAMPERED ones, and UNRECOGNIZED blobs — plus malicious
 * FILE PATHS, and proves the rendered summary (json + text) never echoes a single one of them. The trend reduces
 * every report to bounded enums, small counts, and booleans, and the renderers reach only the reduced result —
 * so there is nowhere for a locator or a byte to enter.
 */

import { describe, expect, it } from "vitest";
import { runReleaseTrend } from "./run";
import { buildTrendResult } from "./build";
import { renderReleaseTrend } from "./render";
import {
  defaultPolicy,
  ingestReportsFrom,
  makeArgs,
  makeProvider,
  NOW,
  promoteReadyReport,
  reportFor,
} from "./fixtures";

/** Locator / secret VALUES that must never appear in a summary, from a hostile report or a path. */
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
  "2099-12-31T23:59:59.000Z", // a hostile input stamp must never be echoed (the trend uses its own)
];

type Obj = Record<string, unknown>;

/** Deep-stuff every NON-load-bearing field of a coherent report with secrets (keeping it self-consistent). */
function hostileReport(): Obj {
  const r = JSON.parse(JSON.stringify(promoteReadyReport())) as Obj;
  r.evilTop = "s3://evil-bucket/secret";
  r.generatedAt = "2099-12-31T23:59:59.000Z"; // the trend uses its OWN stamp; the input stamp is dropped
  (r.recommendation as Obj).detail = "192.168.44.7 sk-super-secret-token-value";
  r.guidance = ["bearer zzz999"];
  r.caveats = ["evil-bucket-name"];
  r.nextActions = [{ id: "leaked-object-key-9f3", detail: "refs/heads/feature/top-secret-launch" }];
  (r.receipt as Obj).at = "us-gov-west-1";
  for (const s of r.sources as Obj[]) {
    s.detail = "refs/heads/feature/top-secret-launch";
    s.facts = { verdict: "us-gov-west-1", leaked: "akiaiosfodnn7example" }; // facts are dropped by the trend
  }
  return r;
}

function assertNoLeak(output: string, label: string): void {
  const lower = output.toLowerCase();
  for (const secret of SECRETS) {
    expect(lower, `${label} leaked ${secret}`).not.toContain(secret.toLowerCase());
  }
}

function renderBoth(objs: readonly unknown[], label: string, policy = {}): void {
  const result = buildTrendResult(NOW, ingestReportsFrom(objs), defaultPolicy(policy));
  assertNoLeak(renderReleaseTrend(result, "json"), `${label}/json`);
  assertNoLeak(renderReleaseTrend(result, "text"), `${label}/text`);
}

describe("release-trend — hostile no-leak", () => {
  it("a history of VALID hostile reports renders content-free (stable) in json + text", () => {
    const objs = [hostileReport(), hostileReport(), hostileReport()];
    const result = buildTrendResult(NOW, ingestReportsFrom(objs), defaultPolicy());
    expect(result.trend.verdict).toBe("stable"); // stays coherent (extras non-load-bearing)
    renderBoth(objs, "valid");
  });

  it("a TAMPERED hostile report (fail-closed) renders content-free in json + text", () => {
    const tampered = hostileReport();
    (tampered.recommendation as Obj).recommendation = "hold-warning"; // flip → no re-derive → tampered (failing)
    const objs = [hostileReport(), tampered];
    const result = buildTrendResult(NOW, ingestReportsFrom(objs), defaultPolicy());
    expect(result.trend.verdict).toBe("failing");
    expect(result.trend.reasons).toContain("report-tampered");
    renderBoth(objs, "tampered");
  });

  it("UNRECOGNIZED hostile blobs (unknown) render content-free in json + text", () => {
    const blob = {
      schema: "s3://evil-bucket/secret",
      evil: "sk-super-secret-token-value",
      akia: "akiaiosfodnn7example",
      ref: "refs/heads/feature/top-secret-launch",
    };
    const result = buildTrendResult(NOW, ingestReportsFrom([blob, blob]), defaultPolicy());
    expect(result.trend.verdict).toBe("unknown");
    renderBoth([blob, blob], "unknown");
  });

  it("never echoes a malicious report FILE PATH — readable or unreadable — in output", async () => {
    const hostilePath = "/tmp/leak/customer-data.pdf";
    const missingPath = "s3://evil-bucket/secret/missing.json";
    const provider = {
      now: () => NOW,
      readFile: async (path: string) =>
        path === hostilePath ? JSON.stringify(hostileReport()) : Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const run = await runReleaseTrend(
      {
        format: "text",
        pretty: true,
        stdin: false,
        maxReports: 20,
        maxHoldWarning: 0,
        maxHoldFail: 0,
        requireLatestReady: false,
        reportPaths: [hostilePath, missingPath],
      },
      provider,
    );
    assertNoLeak(run.output, "paths/text");
    expect(run.output).not.toContain(hostilePath);
    expect(run.output).not.toContain(missingPath);
  });

  it("the render reaches only the reduced result — a stray secret in an ingested field is impossible", () => {
    const result = buildTrendResult(NOW, ingestReportsFrom([hostileReport(), hostileReport()]), defaultPolicy());
    const json = JSON.parse(renderReleaseTrend(result, "json"));
    // Every surfaced point carries only a bounded recommendation or null; no raw string / facts escaped.
    for (const point of json.points) {
      expect(point.recommendation === null || typeof point.recommendation === "string").toBe(true);
      expect(point).not.toHaveProperty("facts");
      expect(point).not.toHaveProperty("evilTop");
    }
    expect(json.generatedAt).toBe(NOW); // the trend's own stamp, never the hostile input's
  });

  it("a full summary over a coherent (non-hostile) history never contains a forbidden token", async () => {
    const objs = [reportFor("promote-ready"), reportFor("hold-warning"), reportFor("promote-ready")];
    for (const format of ["json", "text"] as const) {
      const run = await runReleaseTrend(makeArgs(objs, { format, maxHoldWarning: 5 }), makeProvider(objs));
      assertNoLeak(run.output, `coherent/${format}`);
    }
  });
});
