// @vitest-environment node
/**
 * Contract for the cleanup-evidence ingest parser — the CLI's trust boundary. It proves the
 * parser reads ONLY the four understood fields, reconstructs a bounded lifecycle record,
 * fails closed on a structurally invalid object, bounds size/count, and never echoes the input.
 */
import { describe, expect, it } from "vitest";
import { parseCleanupEvidence } from "./ingest";

describe("parseCleanupEvidence — happy paths", () => {
  it("parses a bare array of observations", () => {
    const result = parseCleanupEvidence(
      JSON.stringify([
        { presence: "absent", activeDelete: true },
        { presence: "present", expiresAtMs: 1700000000000 },
        { presence: "error" },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects).toHaveLength(3);
    expect(result.objects[0]).toEqual({
      presence: "absent",
      lifecycle: null,
      activeDelete: true,
    });
    expect(result.objects[1]).toEqual({
      presence: "present",
      lifecycle: { expiresAtMs: 1700000000000, deleted: false },
      activeDelete: false,
    });
    expect(result.objects[2]).toEqual({
      presence: "error",
      lifecycle: null,
      activeDelete: false,
    });
  });

  it("parses the { objects: [...] } envelope and ignores a schema tag", () => {
    const result = parseCleanupEvidence(
      JSON.stringify({
        schema: "pdfxyz.cleanup-evidence/1",
        objects: [{ presence: "absent" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.objects).toHaveLength(1);
  });

  it("reconstructs a tombstone with no expiry as a placeholder-0 lifecycle record", () => {
    const result = parseCleanupEvidence(
      JSON.stringify([{ presence: "present", deleted: true }]),
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.objects[0]!.lifecycle).toEqual({
        expiresAtMs: 0,
        deleted: true,
      });
  });

  it("ignores unknown/hostile fields — only the four understood fields survive", () => {
    const result = parseCleanupEvidence(
      JSON.stringify([
        {
          presence: "present",
          expiresAtMs: 1700000000000,
          // None of these must survive:
          objectKey: "artifacts/secret/invoice.pdf",
          bucket: "prod-user-uploads",
          signedUrl: "https://s3.amazonaws.com/b/k?X-Amz-Signature=abc",
          providerMessage: "AccessDenied: user arn:aws:iam::123",
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.objects[0]!)).toEqual([
      "presence",
      "lifecycle",
      "activeDelete",
    ]);
    expect(JSON.stringify(result.objects)).not.toMatch(
      /invoice|prod-user|X-Amz|AccessDenied/,
    );
  });

  it("accepts an empty array (nothing to verify, but structurally valid)", () => {
    const result = parseCleanupEvidence("[]");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.objects).toHaveLength(0);
  });
});

describe("parseCleanupEvidence — rejections (content-free issue codes)", () => {
  it("rejects an empty document", () => {
    const result = parseCleanupEvidence("   ");
    expect(result).toEqual({ ok: false, issues: ["empty-document"] });
  });

  it("rejects malformed JSON", () => {
    const result = parseCleanupEvidence("{ not json ");
    expect(result).toEqual({ ok: false, issues: ["malformed-json"] });
  });

  it("rejects JSON that is not an object or array", () => {
    expect(parseCleanupEvidence("42")).toEqual({
      ok: false,
      issues: ["not-an-object"],
    });
  });

  it("rejects an object with no objects array", () => {
    expect(parseCleanupEvidence(JSON.stringify({ foo: 1 }))).toEqual({
      ok: false,
      issues: ["no-objects"],
    });
  });

  it("fails closed on an invalid presence value", () => {
    const result = parseCleanupEvidence(
      JSON.stringify([{ presence: "maybe" }]),
    );
    expect(result).toEqual({ ok: false, issues: ["object-invalid"] });
  });

  it("fails closed on a non-object record", () => {
    expect(parseCleanupEvidence(JSON.stringify(["absent"]))).toEqual({
      ok: false,
      issues: ["object-invalid"],
    });
  });

  it("fails closed on a non-integer expiry", () => {
    const result = parseCleanupEvidence(
      JSON.stringify([{ presence: "present", expiresAtMs: 1.5 }]),
    );
    expect(result).toEqual({ ok: false, issues: ["object-invalid"] });
  });

  it("fails closed on a negative expiry", () => {
    const result = parseCleanupEvidence(
      JSON.stringify([{ presence: "present", expiresAtMs: -1 }]),
    );
    expect(result).toEqual({ ok: false, issues: ["object-invalid"] });
  });

  it("fails closed on a non-boolean activeDelete", () => {
    const result = parseCleanupEvidence(
      JSON.stringify([{ presence: "absent", activeDelete: "yes" }]),
    );
    expect(result).toEqual({ ok: false, issues: ["object-invalid"] });
  });

  it("fails closed on a non-boolean deleted flag", () => {
    const result = parseCleanupEvidence(
      JSON.stringify([{ presence: "present", deleted: 1 }]),
    );
    expect(result).toEqual({ ok: false, issues: ["object-invalid"] });
  });

  it("rejects a document beyond the object-count cap", () => {
    const many = JSON.stringify(
      Array.from({ length: 100_001 }, () => ({ presence: "absent" })),
    );
    expect(parseCleanupEvidence(many)).toEqual({
      ok: false,
      issues: ["too-large"],
    });
  });
});
