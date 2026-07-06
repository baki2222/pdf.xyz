// @vitest-environment node
/**
 * Hostile no-leak proof (Phase 81). It stuffs secret-shaped and locator-shaped strings into every non-load-bearing field
 * of an otherwise self-consistent finalize-index window, then proves NONE of them survive into the trend's json / text
 * output — because the trust boundary reconstructs each window from bounded enums + small integers only, and never
 * echoes an ingested window's own stamp, prose, or an input file path.
 */

import { describe, expect, it } from "vitest";
import { runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend } from "./run";
import { buildTrendResult } from "./build";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend } from "./render";
import {
  blockedWindow,
  defaultPolicy,
  indexedWindow,
  ingestWindowsFrom,
  makeArgs,
  makeProvider,
  NOW,
  openWindow,
} from "./fixtures";

type Obj = Record<string, unknown>;

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
  "jane.reviewer@example.com",
  "jane q. reviewer",
  "2099-12-31t23:59:59.000z", // a hostile input stamp
];

/** A self-consistent (usable) window with every NON-load-bearing field stuffed with secret / locator strings. */
function hostileWindow(): Obj {
  const w = JSON.parse(JSON.stringify(indexedWindow())) as Obj;
  w.evilTop = "s3://evil-bucket/secret";
  w.generatedAt = "2099-12-31T23:59:59.000Z";
  (w.finalizeIndex as Obj).detail = "192.168.44.7 sk-super-secret-token-value";
  (w.metadata as Obj).evil = "refs/heads/feature/top-secret-launch";
  (w.receipt as Obj).at = "us-gov-west-1";
  (w.receipt as Obj).disclosure = "jane.reviewer@example.com";
  w.guidance = ["bearer zzz999"];
  w.caveats = ["us-gov-west-1", "Jane Q. Reviewer"];
  w.reasons = [{ id: "leaked-object-key-9f3", severity: "blocking", detail: "akiaiosfodnn7example" }];
  for (const p of w.points as Obj[]) {
    p.detail = "evil-bucket-name https://evil.example.com/webhook";
    p.evil = "leaked-object-key-9f3";
  }
  return w;
}

/** Assert none of the secret-shaped strings appear anywhere in `output`. */
function assertNoLeak(output: string, label: string): void {
  const lower = output.toLowerCase();
  for (const secret of SECRETS) {
    expect(lower.includes(secret.toLowerCase()), `${label} leaked ${secret}`).toBe(false);
  }
}

/** Build the result over `objs` and assert both json + text render content-free. */
function renderBoth(objs: readonly unknown[], label: string, policy = {}): void {
  const result = buildTrendResult(NOW, ingestWindowsFrom(objs), defaultPolicy(policy));
  assertNoLeak(renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend(result, "json"), `${label}/json`);
  assertNoLeak(renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend(result, "text"), `${label}/text`);
}

describe("release-decision-closeout-governance-finalize-index-trend-finalize-index-trend — hostile no-leak", () => {
  it("a history of VALID hostile windows renders content-free (stable) in json + text", () => {
    const objs = [hostileWindow(), hostileWindow(), hostileWindow()];
    const result = buildTrendResult(NOW, ingestWindowsFrom(objs), defaultPolicy());
    expect(result.verdict).toBe("stable");
    expect(result.coverage.windowsUsable).toBe(3);
    renderBoth(objs, "valid");
  });

  it("a TAMPERED hostile window (fail-closed) renders content-free in json + text", () => {
    const tampered = hostileWindow();
    const rollup = tampered.finalizeIndex as Obj;
    rollup.verdict = "index-blocked";
    rollup.exitCode = 4;
    rollup.indexed = false;
    const objs = [hostileWindow(), tampered];
    const result = buildTrendResult(NOW, ingestWindowsFrom(objs), defaultPolicy());
    expect(result.verdict).toBe("invalid");
    expect(result.reasons.map((r) => r.id)).toContain("window-tampered");
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
    const result = buildTrendResult(NOW, ingestWindowsFrom([blob, blob]), defaultPolicy());
    expect(result.verdict).toBe("invalid");
    renderBoth([blob, blob], "unreadable");
  });

  it("never echoes a malicious window FILE PATH — readable or unreadable — in output", async () => {
    const hostilePath = "/tmp/leak/customer-data.pdf";
    const missingPath = "s3://evil-bucket/secret/missing.json";
    const provider = {
      now: () => NOW,
      readFile: async (path: string) =>
        path === hostilePath ? JSON.stringify(hostileWindow()) : Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend(
      { ...makeArgs([]), format: "text", indexPaths: [hostilePath, missingPath] },
      provider,
    );
    assertNoLeak(run.output, "paths/text");
    expect(run.output).not.toContain(hostilePath);
    expect(run.output).not.toContain(missingPath);
  });

  it("the render reaches only the reduced result — a stray secret in an ingested field is impossible", () => {
    const result = buildTrendResult(NOW, ingestWindowsFrom([hostileWindow(), hostileWindow()]), defaultPolicy());
    const json = JSON.parse(renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend(result, "json"));
    for (const point of json.points) {
      expect(point.verdict === null || typeof point.verdict === "string").toBe(true);
      expect(Object.prototype.hasOwnProperty.call(point, "evilTop")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(point, "evil")).toBe(false);
      expect(String(point.detail)).not.toContain("evil-bucket-name");
    }
    expect(json.generatedAt).toBe(NOW);
  });

  it("a full summary over a coherent (non-hostile) history never contains a forbidden token", async () => {
    const objs = [indexedWindow(), openWindow(), blockedWindow()];
    for (const format of ["json", "text"] as const) {
      const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend(
        makeArgs(objs, { format }),
        makeProvider(objs),
      );
      assertNoLeak(run.output, `coherent/${format}`);
    }
  });
});
