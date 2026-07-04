// @vitest-environment node
/**
 * Hostile no-leak proof for the release evidence governance bundle (Phase 54). It feeds a trend + latest report
 * + latest audit stuffed with malicious labels, raw refs, path/URL/secret-shaped fields, digests, and embedded
 * EXTRA fields an honest document would never carry — as VALID+COHERENT documents, TAMPERED ones, and
 * UNRECOGNIZED blobs — plus malicious FILE PATHS, and proves the rendered bundle (json + text) never echoes a
 * single one of them. The bundle reduces every document to bounded enums, small counts, and booleans, and the
 * renderers reach only the reduced result — so there is nowhere for a locator or a byte to enter.
 */

import { describe, expect, it } from "vitest";
import { runReleaseGovernance } from "./run";
import { buildGovernanceResult } from "./build";
import { renderReleaseGovernance } from "./render";
import {
  defaultPolicy,
  ingestGovernanceFrom,
  makeArgs,
  makeProvider,
  passAudit,
  promoteReadyReport,
  stableTrend,
} from "./fixtures";

/** Locator / secret VALUES that must never appear in a bundle, from a hostile document or a path. */
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
  "sha256:deadbeefcafe",
  "2099-12-31T23:59:59.000Z", // a hostile input stamp must never be echoed (the bundle uses its own)
];

type Obj = Record<string, unknown>;
const clone = (o: unknown): Obj => JSON.parse(JSON.stringify(o)) as Obj;

/** Deep-stuff every NON-load-bearing field of a document with secrets (keeping it self-consistent). */
function stuff(doc: Obj): Obj {
  doc.evilTop = "s3://evil-bucket/secret";
  doc.generatedAt = "2099-12-31T23:59:59.000Z"; // the bundle uses its OWN stamp; the input stamp is dropped
  doc.guidance = ["bearer zzz999"];
  doc.caveats = ["evil-bucket-name refs/heads/feature/top-secret-launch"];
  if (isObject(doc.receipt)) doc.receipt.at = "us-gov-west-1";
  if (isObject(doc.metadata)) (doc.metadata as Obj).leaked = "sha256:deadbeefcafe";
  return doc;
}

function isObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A coherent trend stuffed with secrets in dropped fields (still re-derives → usable). */
function hostileTrend(): Obj {
  const t = stuff(clone(stableTrend()));
  for (const p of t.points as Obj[]) p.detail = "192.168.44.7 sk-super-secret-token-value";
  (t.trend as Obj).detail = "leaked-object-key-9f3";
  for (const r of (t.reasons as Obj[]) ?? []) r.detail = "us-gov-west-1";
  return t;
}

/** A coherent report stuffed with secrets in dropped fields (still re-derives → usable). */
function hostileReport(): Obj {
  const r = stuff(clone(promoteReadyReport()));
  (r.recommendation as Obj).detail = "sk-super-secret-token-value";
  for (const s of r.sources as Obj[]) {
    s.detail = "refs/heads/feature/top-secret-launch";
    s.facts = { verdict: "us-gov-west-1", leaked: "akiaiosfodnn7example" }; // facts are dropped by the boundary
  }
  return r;
}

/** A coherent audit stuffed with secrets in dropped fields (still re-derives → usable). */
function hostileAudit(): Obj {
  const a = stuff(clone(passAudit()));
  for (const f of (a.regressions as Obj[]) ?? []) f.detail = "/tmp/leak/customer-data.pdf";
  if (isObject(a.rollup)) a.rollup.detail = "https://evil.example.com/webhook";
  return a;
}

/** A tampered trend whose CLAIMED verdict field is a secret-shaped string (never echoed). */
function tamperedSecretTrend(): Obj {
  const t = clone(stableTrend());
  (t.trend as Obj).blocking = 999; // recorded rollup no longer re-derives → tampered
  (t.trend as Obj).detail = "s3://evil-bucket/secret";
  return t;
}

/** An UNRECOGNIZED blob that is entirely secrets (⇒ an unreadable source; content never echoed). */
function hostileBlob(): Obj {
  return {
    schema: "pdfxyz.evil/1",
    bucket: "evil-bucket-name",
    key: "leaked-object-key-9f3",
    url: "https://evil.example.com/webhook",
    token: "bearer zzz999",
  };
}

function assertNoLeak(output: string, label: string): void {
  for (const secret of SECRETS) {
    expect(output.includes(secret), `${label} leaked: ${secret}`).toBe(false);
  }
}

describe("release-governance no-leak — coherent hostile documents", () => {
  it("json + text never echo a secret from a hostile trend / report / audit", () => {
    const result = buildGovernanceResult(
      "2026-07-04T00:00:00.000Z",
      ingestGovernanceFrom({ trend: hostileTrend(), report: hostileReport(), audit: hostileAudit() }),
      defaultPolicy(),
    );
    // The hostile documents are still coherent → a healthy window.
    expect(result.governance.verdict).toBe("healthy");
    assertNoLeak(renderReleaseGovernance(result, "json"), "json");
    assertNoLeak(renderReleaseGovernance(result, "text"), "text");
    // And the bundle carries its OWN stamp, never the hostile input's.
    expect(result.generatedAt).toBe("2026-07-04T00:00:00.000Z");
  });
});

describe("release-governance no-leak — tampered + unrecognized documents", () => {
  it("a tampered trend surfaces only its bounded state, never its secret-shaped fields", () => {
    const result = buildGovernanceResult(
      "2026-07-04T00:00:00.000Z",
      ingestGovernanceFrom({ trend: tamperedSecretTrend() }),
      defaultPolicy(),
    );
    expect(result.governance.reasons).toContain("trend-tampered");
    assertNoLeak(renderReleaseGovernance(result, "json"), "tampered json");
    assertNoLeak(renderReleaseGovernance(result, "text"), "tampered text");
  });

  it("an unrecognized blob is reduced to `unreadable`, its content never echoed", () => {
    const result = buildGovernanceResult(
      "2026-07-04T00:00:00.000Z",
      ingestGovernanceFrom({ trend: hostileBlob(), report: hostileBlob(), audit: hostileBlob() }),
      defaultPolicy(),
    );
    expect(result.coverage.trend).toBe("unreadable");
    assertNoLeak(renderReleaseGovernance(result, "json"), "blob json");
    assertNoLeak(renderReleaseGovernance(result, "text"), "blob text");
  });
});

describe("release-governance no-leak — hostile file paths (never echoed, even on error)", () => {
  const EVIL_PATHS = {
    trend: "/tmp/leak/customer-data.pdf",
    report: "s3://evil-bucket/secret",
    audit: "refs/heads/feature/top-secret-launch",
  };

  it("an output over hostile paths never echoes the path (files unreadable → incomplete)", async () => {
    // The provider serves nothing for these paths → each read throws → unreadable source.
    const args = makeArgs(
      { trend: stableTrend() },
      { trendPath: EVIL_PATHS.trend, reportPath: EVIL_PATHS.report, auditPath: EVIL_PATHS.audit },
    );
    const run = await runReleaseGovernance(args, makeProvider({}));
    assertNoLeak(run.output, "run output");
    assertNoLeak(JSON.stringify(run.result), "run result");
    expect(run.result.coverage.trend).toBe("unreadable");
  });

  it("a usable trend served by a hostile path still leaks nothing", async () => {
    const args = makeArgs({}, { trendPath: EVIL_PATHS.trend });
    const provider = {
      now: () => "2026-07-04T00:00:00.000Z",
      readFile: async (p: string) => (p === EVIL_PATHS.trend ? JSON.stringify(hostileTrend()) : ""),
      readStdin: async () => "",
    };
    const run = await runReleaseGovernance(args, provider);
    assertNoLeak(run.output, "hostile-path output");
    expect(run.result.coverage.trend).toBe("usable");
  });
});
