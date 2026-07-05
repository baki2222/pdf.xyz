// @vitest-environment node
/**
 * Hostile no-leak proof for the release decision closeout index (Phase 65). It feeds a history of closeout records
 * stuffed with malicious labels, raw refs, reviewer identities, path/URL/secret-shaped fields, digests, and embedded
 * EXTRA fields an honest record would never carry — as VALID+COHERENT records, TAMPERED ones, and UNRECOGNIZED blobs —
 * plus malicious FILE PATHS, and proves the rendered summary (json + text) never echoes a single one of them. The
 * index reduces every closeout to bounded enums, small counts, and booleans, and the renderers reach only the reduced
 * result — so there is nowhere for a locator or a byte to enter.
 */

import { describe, expect, it } from "vitest";
import { runReleaseDecisionCloseoutIndex } from "./run";
import { buildCloseoutIndexResult } from "./build";
import { renderReleaseDecisionCloseoutIndex } from "./render";
import {
  blockedCloseout,
  closedCloseout,
  closeoutFor,
  defaultPolicy,
  ingestCloseoutsFrom,
  makeArgs,
  makeProvider,
  NOW,
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
  "jane.reviewer@example.com",
  "Jane Q. Reviewer",
  "2099-12-31T23:59:59.000Z", // a hostile input stamp must never be echoed (the index uses its own)
];

type Obj = Record<string, unknown>;

/** Deep-stuff every NON-load-bearing field of a coherent closeout with secrets (keeping it self-consistent). */
function hostileCloseout(): Obj {
  const r = JSON.parse(JSON.stringify(closedCloseout())) as Obj;
  r.evilTop = "s3://evil-bucket/secret";
  r.generatedAt = "2099-12-31T23:59:59.000Z"; // the index uses its OWN stamp; the input stamp is dropped
  (r.closeout as Obj).detail = "192.168.44.7 sk-super-secret-token-value";
  (r.source as Obj).evil = "refs/heads/feature/top-secret-launch";
  (r.receipt as Obj).at = "us-gov-west-1";
  (r.receipt as Obj).disclosure = "jane.reviewer@example.com";
  r.guidance = ["bearer zzz999"];
  r.caveats = ["us-gov-west-1", "Jane Q. Reviewer"];
  r.reasons = [{ id: "leaked-object-key-9f3", severity: "blocking", detail: "akiaiosfodnn7example" }];
  for (const rel of r.related as Obj[]) rel.evil = "evil-bucket-name";
  return r;
}

function assertNoLeak(output: string, label: string): void {
  const lower = output.toLowerCase();
  for (const secret of SECRETS) {
    expect(lower, `${label} leaked ${secret}`).not.toContain(secret.toLowerCase());
  }
}

function renderBoth(objs: readonly unknown[], label: string, policy = {}): void {
  const result = buildCloseoutIndexResult(NOW, ingestCloseoutsFrom(objs), defaultPolicy(policy));
  assertNoLeak(renderReleaseDecisionCloseoutIndex(result, "json"), `${label}/json`);
  assertNoLeak(renderReleaseDecisionCloseoutIndex(result, "text"), `${label}/text`);
}

describe("release-decision-closeout-index — hostile no-leak", () => {
  it("a history of VALID hostile closeouts renders content-free (indexed) in json + text", () => {
    const objs = [hostileCloseout(), hostileCloseout(), hostileCloseout()];
    const result = buildCloseoutIndexResult(NOW, ingestCloseoutsFrom(objs), defaultPolicy());
    expect(result.closeoutIndex.verdict).toBe("indexed"); // stays coherent (extras non-load-bearing)
    expect(result.ledger.closeoutsUsable).toBe(3);
    renderBoth(objs, "valid");
  });

  it("a TAMPERED hostile closeout (fail-closed) renders content-free in json + text", () => {
    const tampered = hostileCloseout();
    tampered.verdict = "closeout-blocked"; // flip only the headline → no re-derive → tampered
    (tampered.closeout as Obj).verdict = "closeout-blocked";
    const objs = [hostileCloseout(), tampered];
    const result = buildCloseoutIndexResult(NOW, ingestCloseoutsFrom(objs), defaultPolicy());
    expect(result.closeoutIndex.verdict).toBe("index-blocked");
    expect(result.closeoutIndex.reasons).toContain("closeout-tampered");
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
    const result = buildCloseoutIndexResult(NOW, ingestCloseoutsFrom([blob, blob]), defaultPolicy());
    expect(result.closeoutIndex.verdict).toBe("index-incomplete");
    renderBoth([blob, blob], "unreadable");
  });

  it("never echoes a malicious closeout FILE PATH — readable or unreadable — in output", async () => {
    const hostilePath = "/tmp/leak/customer-data.pdf";
    const missingPath = "s3://evil-bucket/secret/missing.json";
    const provider = {
      now: () => NOW,
      readFile: async (path: string) =>
        path === hostilePath ? JSON.stringify(hostileCloseout()) : Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const run = await runReleaseDecisionCloseoutIndex(
      {
        format: "text",
        pretty: true,
        stdin: false,
        maxCloseouts: 100,
        maxOpen: 0,
        maxIncomplete: 0,
        maxBlocked: 0,
        strictOpen: false,
        closeoutPaths: [hostilePath, missingPath],
      },
      provider,
    );
    assertNoLeak(run.output, "paths/text");
    expect(run.output).not.toContain(hostilePath);
    expect(run.output).not.toContain(missingPath);
  });

  it("the render reaches only the reduced result — a stray secret in an ingested field is impossible", () => {
    const result = buildCloseoutIndexResult(NOW, ingestCloseoutsFrom([hostileCloseout(), hostileCloseout()]), defaultPolicy());
    const json = JSON.parse(renderReleaseDecisionCloseoutIndex(result, "json"));
    for (const point of json.points) {
      expect(point.verdict === null || typeof point.verdict === "string").toBe(true);
      expect(point).not.toHaveProperty("evilTop");
      expect(point).not.toHaveProperty("evil");
    }
    expect(json.generatedAt).toBe(NOW); // the index's own stamp, never the hostile input's
  });

  it("a full summary over a coherent (non-hostile) history never contains a forbidden token", async () => {
    const objs = [closeoutFor("closed"), closeoutFor("closeout-open"), blockedCloseout()];
    for (const format of ["json", "text"] as const) {
      const run = await runReleaseDecisionCloseoutIndex(makeArgs(objs, { format }), makeProvider(objs));
      assertNoLeak(run.output, `coherent/${format}`);
    }
  });
});
