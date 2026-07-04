// @vitest-environment node
/**
 * Hostile no-leak proof for the release evidence audit (Phase 51). It ingests bundles whose every NON-load-
 * bearing field — top-level extras, per-stage + per-link prose, stage facts, caveats/guidance/next-action/
 * archive-note/receipt, and even the bundle's own stamp — is stuffed with malicious labels, raw refs, path/
 * URL/secret-shaped strings, and object keys, as a COHERENT pair, a TAMPERED one, and an UNRECOGNIZED blob,
 * plus a malicious FILE PATH, and proves the rendered audit (json + text) never echoes a single one. The
 * audit reduces every bundle to bounded enums, small counts, and booleans, and the renderers reach only the
 * reduced result — so there is nowhere for a locator or a byte to enter, even from a hostile bundle.
 */

import { describe, expect, it } from "vitest";
import { runReleaseAudit } from "./run";
import { buildAuditResult } from "./build";
import { ingestBundle } from "./ingest";
import { renderReleaseAudit } from "./render";
import { NOW, makeAuditProvider, pairArgs, passBundle, policy } from "./fixtures";

type Obj = Record<string, unknown>;

/** Locator / secret VALUES that must never appear in an audit result, from a hostile bundle or a path. */
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

function isObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-stuff every NON-load-bearing field of a coherent pass bundle with secrets while KEEPING it self-
 * consistent (the rollup/stage-severity/link-status load-bearing fields are untouched → still `usable`).
 */
function hostileBundle(): Obj {
  const b = JSON.parse(JSON.stringify(passBundle())) as Obj;
  b.evilTop = "s3://evil-bucket/secret";
  b.generatedAt = "akiaiosfodnn7example"; // the audit stamps its OWN; it must never copy this
  if (isObject(b.metadata)) b.metadata.evilMeta = "https://evil.example.com/webhook";
  for (const stage of b.stages as Obj[]) {
    stage.detail = "192.168.44.7 sk-super-secret-token-value";
    if (isObject(stage.facts)) stage.facts.evilFact = "leaked-object-key-9f3";
  }
  for (const link of b.consistency as Obj[]) link.detail = "refs/heads/feature/top-secret-launch";
  b.caveats = ["bearer zzz999"];
  b.guidance = ["us-gov-west-1"];
  b.nextAction = "evil-bucket-name";
  if (isObject(b.archive)) b.archive.note = "/tmp/leak/customer-data.pdf";
  b.receipt = { evilReceipt: "s3://evil-bucket/secret" };
  return b;
}

function assertNoLeak(output: string, label: string): void {
  const lower = output.toLowerCase();
  for (const secret of SECRETS) {
    expect(lower, `${label} leaked ${secret}`).not.toContain(secret.toLowerCase());
  }
}

describe("release-audit — hostile no-leak", () => {
  it("a VALID hostile pair renders content-free in json + text and never copies the bundle stamp", async () => {
    const provider = makeAuditProvider({ baseline: hostileBundle(), current: hostileBundle() });
    // The bundles stay coherent (only prose/extra fields were stuffed) → a real pass over a comparable pair.
    const run = await runReleaseAudit(pairArgs(), provider);
    expect(run.result.rollup.verdict).toBe("pass");
    expect(run.result.generatedAt).toBe(NOW); // stamped by the runner, not copied from the bundle
    assertNoLeak(renderReleaseAudit(run.result, "json"), "valid/json");
    assertNoLeak(renderReleaseAudit(run.result, "text"), "valid/text");
  });

  it("a TAMPERED hostile bundle (fail) renders content-free in json + text", async () => {
    const tamperedBundle = hostileBundle();
    (tamperedBundle.rollup as Obj).verdict = "warn"; // re-derives to pass ≠ warn → tampered
    const provider = makeAuditProvider({ baseline: hostileBundle(), current: tamperedBundle });
    const run = await runReleaseAudit({ ...pairArgs(), format: "text" }, provider);
    expect(run.result.rollup.verdict).toBe("fail");
    assertNoLeak(run.output, "tampered/text");
    assertNoLeak(renderReleaseAudit(run.result, "json"), "tampered/json");
  });

  it("an UNRECOGNIZED hostile blob (unknown) renders content-free in json + text", () => {
    const blob = { schema: "s3://evil-bucket/secret", evil: "sk-super-secret-token-value", akia: "akiaiosfodnn7example" };
    const result = buildAuditResult({
      generatedAt: NOW,
      mode: "pair",
      policy: policy(),
      baseline: { supplied: true, ingested: ingestBundle(passBundle()) },
      current: { supplied: true, ingested: ingestBundle(blob) },
    });
    expect(result.rollup.verdict).toBe("unknown");
    assertNoLeak(renderReleaseAudit(result, "json"), "unknown/json");
    assertNoLeak(renderReleaseAudit(result, "text"), "unknown/text");
  });

  it("never echoes a malicious bundle FILE PATH — readable or unreadable — in output or errors", async () => {
    const hostilePath = "/tmp/leak/customer-data.pdf";
    const missingPath = "s3://evil-bucket/secret/missing.json";
    const provider = {
      now: () => NOW,
      readStdin: async () => "",
      readFile: async (path: string) =>
        path === hostilePath ? JSON.stringify(hostileBundle()) : Promise.reject(new Error("enoent")),
    };
    const run = await runReleaseAudit(
      { ...pairArgs({ baselinePath: hostilePath, currentPath: missingPath }), format: "text" },
      provider,
    );
    assertNoLeak(run.output, "paths/text");
    expect(run.output).not.toContain(hostilePath);
    expect(run.output).not.toContain(missingPath);
  });

  it("the render reaches only the reduced result — a stray secret in stage facts is impossible", () => {
    const result = buildAuditResult({
      generatedAt: NOW,
      mode: "pair",
      policy: policy(),
      baseline: { supplied: true, ingested: ingestBundle(hostileBundle()) },
      current: { supplied: true, ingested: ingestBundle(hostileBundle()) },
    });
    const json = JSON.parse(renderReleaseAudit(result, "json"));
    // Every recorded per-stage view is just {present, severity} — no facts blob escaped.
    for (const stageId of Object.keys(json.current.stages)) {
      const view = json.current.stages[stageId];
      expect(Object.keys(view).sort()).toEqual(["present", "severity"]);
      expect(typeof view.present).toBe("boolean");
    }
    // Deltas are numbers/null; the whole serialized result carries no forbidden token.
    assertNoLeak(JSON.stringify(json), "reduced/json");
  });
});
