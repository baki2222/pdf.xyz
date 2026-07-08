// @vitest-environment node
/**
 * Hostile no-leak proof for the release decision closeout governance finalize index trend finalize index trend closeout index trend closeout index trend closeout index trend closeout
 * INDEX (Phase 90). It feeds a history of closeout records stuffed with malicious labels, raw refs, reviewer identities,
 * path/URL/secret-shaped fields, digests, and embedded EXTRA fields an honest record would never carry — as
 * VALID+COHERENT records, TAMPERED ones, and UNRECOGNIZED blobs — plus malicious FILE PATHS, and proves the rendered
 * summary (json + text) never echoes a single one of them. The index reduces every record to bounded enums, small counts,
 * and booleans, and the renderers reach only the reduced result — so there is nowhere for a locator or a byte to enter.
 */

import { describe, expect, it } from "vitest";
import { runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndex as run } from "./run";
import { buildCloseoutIndexResult } from "./build";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndex as render } from "./render";
import {
  blockedCloseout,
  closeoutFor,
  closedCloseout,
  defaultPolicy,
  ingestCloseoutFrom,
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

/** Deep-stuff every NON-load-bearing field of a coherent closeout record with secrets (keeping it self-consistent). */
function hostileCloseout(): Obj {
  const r = JSON.parse(JSON.stringify(closedCloseout())) as Obj;
  r.evilTop = "s3://evil-bucket/secret";
  r.generatedAt = "2099-12-31T23:59:59.000Z"; // the index uses its OWN stamp; the input stamp is dropped
  (r.coverage as Obj).detail = "192.168.44.7 sk-super-secret-token-value";
  (r.primaryReceipt as Obj).evil = "refs/heads/feature/top-secret-launch";
  (r.sourceChain as Obj).evil = "leaked-object-key-9f3";
  (r.receipt as Obj).at = "us-gov-west-1";
  (r.receipt as Obj).disclosure = "jane.reviewer@example.com";
  r.nextActions = ["bearer zzz999"];
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
  const result = buildCloseoutIndexResult(NOW, ingestCloseoutFrom(objs), defaultPolicy(policy));
  assertNoLeak(render(result, "json"), `${label}/json`);
  assertNoLeak(render(result, "text"), `${label}/text`);
}

describe("release-decision-…-closeout-index — hostile no-leak", () => {
  it("a history of VALID hostile records renders content-free (all-closed) in json + text", () => {
    const objs = [hostileCloseout(), hostileCloseout(), hostileCloseout()];
    const result = buildCloseoutIndexResult(NOW, ingestCloseoutFrom(objs), defaultPolicy());
    expect(result.closeoutIndex.verdict).toBe("all-closed"); // stays coherent (extras non-load-bearing)
    expect(result.coverage.closeoutsUsable).toBe(3);
    renderBoth(objs, "valid");
  });

  it("a TAMPERED hostile record (fail-closed) renders content-free in json + text", () => {
    const tampered = hostileCloseout();
    tampered.verdict = "blocked"; // flip the headline + coverage rollup → no re-derive → tampered
    (tampered.coverage as Obj).verdict = "blocked";
    const objs = [hostileCloseout(), tampered];
    const result = buildCloseoutIndexResult(NOW, ingestCloseoutFrom(objs), defaultPolicy());
    expect(result.closeoutIndex.verdict).toBe("invalid");
    expect(result.closeoutIndex.reasons).toContain("closeout-tampered");
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
    const result = buildCloseoutIndexResult(NOW, ingestCloseoutFrom([blob, blob]), defaultPolicy());
    expect(result.closeoutIndex.verdict).toBe("invalid");
    renderBoth([blob, blob], "unreadable");
  });

  it("never echoes a malicious record FILE PATH — readable or unreadable — in output", async () => {
    const hostilePath = "/tmp/leak/customer-data.pdf";
    const missingPath = "s3://evil-bucket/secret/missing.json";
    const provider = {
      now: () => NOW,
      readFile: async (path: string) =>
        path === hostilePath ? JSON.stringify(hostileCloseout()) : Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const r = await run(
      {
        format: "text",
        pretty: true,
        stdin: false,
        maxCloseouts: 26,
        maxOpen: 0,
        maxIncomplete: 0,
        strictOpen: false,
        closeoutPaths: [hostilePath, missingPath],
      },
      provider,
    );
    assertNoLeak(r.output, "paths/text");
    expect(r.output).not.toContain(hostilePath);
    expect(r.output).not.toContain(missingPath);
  });

  it("the render reaches only the reduced result — a stray secret in an ingested field is impossible", () => {
    const result = buildCloseoutIndexResult(NOW, ingestCloseoutFrom([hostileCloseout(), hostileCloseout()]), defaultPolicy());
    const json = JSON.parse(render(result, "json"));
    for (const point of json.points) {
      expect(point.verdict === null || typeof point.verdict === "string").toBe(true);
      expect(point).not.toHaveProperty("evilTop");
      expect(point).not.toHaveProperty("evil");
    }
    expect(json.generatedAt).toBe(NOW); // the index's own stamp, never the hostile input's
  });

  it("a full summary over a coherent (non-hostile) history never contains a forbidden token", async () => {
    const objs = [closeoutFor("closed"), closeoutFor("open"), blockedCloseout()];
    for (const format of ["json", "text"] as const) {
      const r = await run(makeArgs(objs, { format }), makeProvider(objs));
      assertNoLeak(r.output, `coherent/${format}`);
    }
  });
});
