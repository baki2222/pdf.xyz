// @vitest-environment node
/**
 * Proof for the pure artifact-manifest evaluation: the taxonomy tables, the retention
 * class derivation, the per-output classification (every reject reason), and the
 * set-level validation. Deterministic — no I/O, clock, or engine.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, type RetentionPolicy } from "@/lib/jobs";
import type { ProcessorArtifact } from "../processor/types";
import { DEFAULT_ARTIFACT_POLICY, type ArtifactManifestPolicy } from "./policy";
import {
  buildArtifactManifest,
  checkArtifacts,
  outputKindForContentType,
  outputKindForFilename,
  producibleKinds,
  retentionClassFor,
} from "./manifest";
import type { ArtifactReason, ArtifactValidationInput } from "./types";

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc("%PDF-1.7 minimal");

function artifact(over: Partial<ProcessorArtifact> = {}): ProcessorArtifact {
  return {
    filename: "out.pdf",
    contentType: "application/pdf",
    bytes: PDF,
    ...over,
  };
}

function input(
  over: Partial<ArtifactValidationInput> = {},
): ArtifactValidationInput {
  return {
    tool: "compress-pdf",
    processor: "compress",
    retention: DEFAULT_RETENTION,
    artifacts: [artifact()],
    ...over,
  };
}

/** Run the default-policy gate and return the folded verdict + first reason. */
function reasonOf(
  over: Partial<ArtifactValidationInput>,
  policy: ArtifactManifestPolicy = DEFAULT_ARTIFACT_POLICY,
): { verdict: string; reason: ArtifactReason } {
  const r = checkArtifacts(policy, input(over));
  return { verdict: r.verdict, reason: r.reason };
}

describe("output-kind classification", () => {
  it("maps every recognized producible content-type to its kind", () => {
    expect(outputKindForContentType("application/pdf")).toBe("pdf");
    expect(outputKindForContentType("text/plain")).toBe("text-sidecar");
    expect(outputKindForContentType("application/zip")).toBe("archive");
    expect(outputKindForContentType("image/png")).toBe("image");
    expect(outputKindForContentType("image/jpeg")).toBe("image");
  });

  it("classifies an unrecognized or empty content-type as unknown", () => {
    expect(outputKindForContentType("application/x-msdownload")).toBe("unknown");
    expect(outputKindForContentType("")).toBe("unknown");
  });

  it("derives the coherence kind from a filename extension, else null", () => {
    expect(outputKindForFilename("report.pdf")).toBe("pdf");
    expect(outputKindForFilename("scan.txt")).toBe("text-sidecar");
    expect(outputKindForFilename("bundle.zip")).toBe("archive");
    expect(outputKindForFilename("page.PNG")).toBe("image");
    expect(outputKindForFilename("noext")).toBeNull();
    expect(outputKindForFilename("weird.bin")).toBeNull();
  });
});

describe("retention class derivation", () => {
  const policy = (ttl: number, persists = false): RetentionPolicy =>
    ({
      inputTtlMinutes: ttl,
      outputTtlMinutes: ttl,
      persistsAfterJob: persists as false,
    }) satisfies RetentionPolicy;

  it("buckets a finite, non-persistent TTL", () => {
    expect(retentionClassFor(policy(10))).toBe("ephemeral");
    expect(retentionClassFor(policy(60))).toBe("short"); // the shipped default
    expect(retentionClassFor(DEFAULT_RETENTION)).toBe("short");
    expect(retentionClassFor(policy(720))).toBe("standard");
    expect(retentionClassFor(policy(5000))).toBe("extended");
  });

  it("fails closed to unknown for a malformed, non-positive, or persistent policy", () => {
    expect(retentionClassFor(policy(0))).toBe("unknown");
    expect(retentionClassFor(policy(-5))).toBe("unknown");
    expect(retentionClassFor(policy(Number.NaN))).toBe("unknown");
    // A policy that claims persistence beyond the job is never blessed.
    expect(retentionClassFor(policy(60, true))).toBe("unknown");
    expect(retentionClassFor(null)).toBe("unknown");
    expect(retentionClassFor(undefined)).toBe("unknown");
  });
});

describe("producible kinds per processor family", () => {
  it("constrains compress and ocr, leaves other open across recognized kinds", () => {
    expect([...producibleKinds("compress")]).toEqual(["pdf"]);
    expect([...producibleKinds("ocr")].sort()).toEqual(["pdf", "text-sidecar"]);
    expect(producibleKinds("other").has("archive")).toBe(true);
    expect(producibleKinds("other").has("image")).toBe(true);
  });
});

describe("buildArtifactManifest — content-free projection", () => {
  it("records only structural provenance, normalizing the content-type", () => {
    const m = buildArtifactManifest(
      { tool: "ocr-pdf", processor: "ocr" },
      { filename: "scan.txt", contentType: "text/plain; charset=utf-8", bytes: enc("hi") },
      "short",
    );
    expect(m).toEqual({
      outputKind: "text-sidecar",
      contentType: "text/plain", // charset parameter stripped
      byteCount: 2,
      retentionClass: "short",
      toolSlug: "ocr-pdf",
      processor: "ocr",
      policyId: "pdfxyz-worker-artifact-manifest",
      policyVersion: 1,
    });
    // The manifest never carries the filename.
    expect(JSON.stringify(m)).not.toContain("scan.txt");
  });
});

describe("checkArtifacts — valid outputs", () => {
  it("accepts a single valid compression PDF", () => {
    const r = checkArtifacts(DEFAULT_ARTIFACT_POLICY, input());
    expect(r.verdict).toBe("valid");
    expect(r.reason).toBe("ok");
    expect(r.checks).toHaveLength(1);
    expect(r.checks[0]!.manifest.outputKind).toBe("pdf");
  });

  it("accepts an OCR pair (searchable PDF + text sidecar)", () => {
    const r = checkArtifacts(
      DEFAULT_ARTIFACT_POLICY,
      input({
        tool: "ocr-pdf",
        processor: "ocr",
        artifacts: [
          { filename: "scan-ocr.pdf", contentType: "application/pdf", bytes: PDF },
          {
            filename: "scan.txt",
            contentType: "text/plain; charset=utf-8",
            bytes: enc("recognized"),
          },
        ],
      }),
    );
    expect(r.verdict).toBe("valid");
    expect(r.checks.map((c) => c.manifest.outputKind)).toEqual([
      "pdf",
      "text-sidecar",
    ]);
  });
});

describe("checkArtifacts — rejects each malformed/ambiguous shape", () => {
  it("no_artifacts: a successful run produced nothing", () => {
    expect(reasonOf({ artifacts: [] })).toEqual({
      verdict: "invalid",
      reason: "no_artifacts",
    });
  });

  it("too_many_artifacts: over the count ceiling", () => {
    const many = Array.from({ length: 3 }, () => artifact());
    const r = checkArtifacts(
      { ...DEFAULT_ARTIFACT_POLICY, maxArtifacts: 2 },
      input({ artifacts: many }),
    );
    expect(r).toMatchObject({ verdict: "invalid", reason: "too_many_artifacts" });
    expect(r.checks).toHaveLength(0); // set-level: no per-output checks
  });

  it("empty_artifact: a zero-byte output", () => {
    expect(reasonOf({ artifacts: [artifact({ bytes: enc("") })] })).toEqual({
      verdict: "invalid",
      reason: "empty_artifact",
    });
  });

  it("oversize_artifact: over the opt-in byte ceiling", () => {
    expect(
      reasonOf({ artifacts: [artifact()] }, {
        ...DEFAULT_ARTIFACT_POLICY,
        maxBytes: 1,
      }),
    ).toEqual({ verdict: "invalid", reason: "oversize_artifact" });
  });

  it("unknown_output_kind: an unrecognized content-type", () => {
    expect(
      reasonOf({
        artifacts: [
          artifact({ filename: "out.bin", contentType: "application/x-weird" }),
        ],
      }),
    ).toEqual({ verdict: "invalid", reason: "unknown_output_kind" });
  });

  it("content_type_mismatch: content-type disagrees with the filename extension", () => {
    expect(
      reasonOf({
        // Named .pdf but typed text/plain — a recognized-but-incoherent output.
        artifacts: [artifact({ filename: "out.pdf", contentType: "text/plain" })],
      }),
    ).toEqual({ verdict: "invalid", reason: "content_type_mismatch" });
  });

  it("unsupported_content_type: a kind this processor may not produce", () => {
    expect(
      reasonOf({
        // Compression producing a coherent text sidecar — a kind it must not emit.
        processor: "compress",
        artifacts: [artifact({ filename: "out.txt", contentType: "text/plain" })],
      }),
    ).toEqual({ verdict: "invalid", reason: "unsupported_content_type" });
  });

  it("missing_retention_class: the job resolves no usable class", () => {
    expect(
      reasonOf({
        retention: {
          inputTtlMinutes: 0,
          outputTtlMinutes: 0,
          persistsAfterJob: false,
        },
      }),
    ).toEqual({ verdict: "invalid", reason: "missing_retention_class" });
  });

  it("provenance_incomplete: an absent tool slug", () => {
    expect(reasonOf({ tool: "" })).toEqual({
      verdict: "invalid",
      reason: "provenance_incomplete",
    });
  });

  it("policy_unavailable: fails closed when the policy is missing", () => {
    const r = checkArtifacts(null, input());
    expect(r).toMatchObject({ verdict: "invalid", reason: "policy_unavailable" });
  });
});

describe("checkArtifacts — disabled + config toggles", () => {
  it("skips (never validates) when the gate is disabled", () => {
    const r = checkArtifacts(
      { ...DEFAULT_ARTIFACT_POLICY, enabled: false },
      input({ artifacts: [] }), // would fail, but the gate is off
    );
    expect(r).toMatchObject({ verdict: "skipped", checked: false, reason: "not_validated" });
    expect(r.checks).toHaveLength(0);
  });

  it("skips the content-type checks when checkContentType is off", () => {
    // An unknown kind passes when the content-type check is disabled (bytes/retention
    // still enforced), so the gate never blocks a novel-but-well-formed output.
    const r = checkArtifacts(
      { ...DEFAULT_ARTIFACT_POLICY, checkContentType: false },
      input({
        artifacts: [
          artifact({ filename: "out.bin", contentType: "application/x-weird" }),
        ],
      }),
    );
    expect(r.verdict).toBe("valid");
  });

  it("skips the retention requirement when requireRetentionClass is off", () => {
    const r = checkArtifacts(
      { ...DEFAULT_ARTIFACT_POLICY, requireRetentionClass: false },
      input({
        retention: {
          inputTtlMinutes: 0,
          outputTtlMinutes: 0,
          persistsAfterJob: false,
        },
      }),
    );
    expect(r.verdict).toBe("valid");
    expect(r.checks[0]!.manifest.retentionClass).toBe("unknown"); // recorded, not enforced
  });
});
