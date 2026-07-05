// @vitest-environment node
/**
 * Hostile no-leak proof for the release decision closeout index trend (Phase 66). It feeds a history of closeout-index
 * windows stuffed with malicious labels, raw refs, reviewer identities, path/URL/secret-shaped fields, digests, and
 * embedded EXTRA fields an honest window would never carry — as VALID+COHERENT windows, TAMPERED ones, and UNRECOGNIZED
 * blobs — plus malicious FILE PATHS, and proves the rendered summary (json + text) never echoes a single one of them.
 * The trend reduces every window to bounded enums, small counts, and booleans, and the renderers reach only the reduced
 * result — so there is nowhere for a locator or a byte to enter.
 */

import { describe, expect, it } from "vitest";
import { runReleaseDecisionCloseoutIndexTrend } from "./run";
import { buildTrendResult } from "./build";
import { renderReleaseDecisionCloseoutIndexTrend } from "./render";
import {
  blockedIndex,
  defaultPolicy,
  indexedIndex,
  ingestIndexesFrom,
  makeArgs,
  makeProvider,
  NOW,
  openIndex,
} from "./fixtures";

type Obj = Record<string, unknown>;

/** Locator / secret / identity VALUES that must never appear in a summary, from a hostile window or a path. */
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
  "2099-12-31t23:59:59.000z", // a hostile input stamp must never be echoed (the trend uses its own)
];

/** Deep-stuff every NON-load-bearing field of a coherent window with secrets (keeping it self-consistent). */
function hostileIndex(): Obj {
  const w = JSON.parse(JSON.stringify(indexedIndex())) as Obj;
  w.evilTop = "s3://evil-bucket/secret";
  w.generatedAt = "2099-12-31T23:59:59.000Z"; // the trend uses its OWN stamp; the input stamp is dropped
  (w.closeoutIndex as Obj).detail = "192.168.44.7 sk-super-secret-token-value";
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

function assertNoLeak(output: string, label: string): void {
  const lower = output.toLowerCase();
  for (const secret of SECRETS) {
    expect(lower, `${label} leaked ${secret}`).not.toContain(secret.toLowerCase());
  }
}

function renderBoth(objs: readonly unknown[], label: string, policy = {}): void {
  const result = buildTrendResult(NOW, ingestIndexesFrom(objs), defaultPolicy(policy));
  assertNoLeak(renderReleaseDecisionCloseoutIndexTrend(result, "json"), `${label}/json`);
  assertNoLeak(renderReleaseDecisionCloseoutIndexTrend(result, "text"), `${label}/text`);
}

describe("release-decision-closeout-index-trend — hostile no-leak", () => {
  it("a history of VALID hostile windows renders content-free (trend-stable) in json + text", () => {
    const objs = [hostileIndex(), hostileIndex(), hostileIndex()];
    const result = buildTrendResult(NOW, ingestIndexesFrom(objs), defaultPolicy());
    expect(result.closeoutIndexTrend.verdict).toBe("trend-stable"); // stays coherent (extras non-load-bearing)
    expect(result.summary.indexesUsable).toBe(3);
    renderBoth(objs, "valid");
  });

  it("a TAMPERED hostile window (fail-closed) renders content-free in json + text", () => {
    const tampered = hostileIndex();
    (tampered.closeoutIndex as Obj).verdict = "index-blocked"; // flip only the rollup → no re-derive → tampered
    (tampered.closeoutIndex as Obj).exitCode = 4;
    (tampered.closeoutIndex as Obj).indexed = false;
    const objs = [hostileIndex(), tampered];
    const result = buildTrendResult(NOW, ingestIndexesFrom(objs), defaultPolicy());
    expect(result.closeoutIndexTrend.verdict).toBe("trend-blocked");
    expect(result.closeoutIndexTrend.reasons).toContain("index-tampered");
    renderBoth(objs, "tampered");
  });

  it("UNRECOGNIZED hostile blobs (incomplete) render content-free in json + text", () => {
    const blob = {
      schema: "s3://evil-bucket/secret",
      evil: "sk-super-secret-token-value",
      akia: "akiaiosfodnn7example",
      ref: "refs/heads/feature/top-secret-launch",
      reviewer: "jane.reviewer@example.com",
    };
    const result = buildTrendResult(NOW, ingestIndexesFrom([blob, blob]), defaultPolicy());
    expect(result.closeoutIndexTrend.verdict).toBe("trend-incomplete");
    renderBoth([blob, blob], "unreadable");
  });

  it("never echoes a malicious window FILE PATH — readable or unreadable — in output", async () => {
    const hostilePath = "/tmp/leak/customer-data.pdf";
    const missingPath = "s3://evil-bucket/secret/missing.json";
    const provider = {
      now: () => NOW,
      readFile: async (path: string) =>
        path === hostilePath ? JSON.stringify(hostileIndex()) : Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const run = await runReleaseDecisionCloseoutIndexTrend(
      { ...makeArgs([]), format: "text", indexPaths: [hostilePath, missingPath] },
      provider,
    );
    assertNoLeak(run.output, "paths/text");
    expect(run.output).not.toContain(hostilePath);
    expect(run.output).not.toContain(missingPath);
  });

  it("the render reaches only the reduced result — a stray secret in an ingested field is impossible", () => {
    const result = buildTrendResult(NOW, ingestIndexesFrom([hostileIndex(), hostileIndex()]), defaultPolicy());
    const json = JSON.parse(renderReleaseDecisionCloseoutIndexTrend(result, "json"));
    for (const point of json.points) {
      expect(point.verdict === null || typeof point.verdict === "string").toBe(true);
      expect(point).not.toHaveProperty("evilTop");
      expect(point).not.toHaveProperty("evil");
      expect(point.detail).not.toContain("evil-bucket-name");
    }
    expect(json.generatedAt).toBe(NOW); // the trend's own stamp, never the hostile input's
  });

  it("a full summary over a coherent (non-hostile) history never contains a forbidden token", async () => {
    const objs = [indexedIndex(), openIndex(), blockedIndex()];
    for (const format of ["json", "text"] as const) {
      const run = await runReleaseDecisionCloseoutIndexTrend(makeArgs(objs, { format }), makeProvider(objs));
      assertNoLeak(run.output, `coherent/${format}`);
    }
  });
});
