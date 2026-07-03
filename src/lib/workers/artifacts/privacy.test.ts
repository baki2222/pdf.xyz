// @vitest-environment node
/**
 * The content-free contract for the artifact-manifest gate, encoded as an executable
 * test: no manifest, check, verdict, reason, detail, receipt, capability, or metric
 * label the gate produces may carry a filename, object key, signed URL, secret,
 * recognized text, or document byte — even when the inspected OUTPUT is *stuffed* with
 * all of them. Mirrors `../soundness/privacy.test`.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION } from "@/lib/jobs";
import type { ProcessorArtifact } from "../processor/types";
import { artifactManifestMetric } from "../observability/metrics";
import { checkArtifacts } from "./manifest";
import { createArtifactManifestGate } from "./gate";
import { DEFAULT_ARTIFACT_POLICY } from "./policy";
import { buildArtifactReceipt } from "./receipt";
import type { ArtifactValidation, ArtifactValidationInput } from "./types";

/** Secrets/content that must NEVER surface in any gate output. */
const FORBIDDEN = [
  "Confidential Salaries.pdf",
  "/etc/passwd",
  "X-Amz-Signature=deadbeef",
  "AWS_SECRET_ACCESS_KEY",
  "123-45-6789", // an SSN
  "patient record", // recognized OCR text / document body
  "art_abc123secret", // an opaque artifact id / object key
  "https://bucket.s3.amazonaws.com/outputs/x", // a signed URL
];

const enc = (s: string) => new TextEncoder().encode(s);

/** An output whose filename, bytes, and content-type parameter are loaded with secrets. */
function hostileArtifact(over: Partial<ProcessorArtifact> = {}): ProcessorArtifact {
  return {
    filename: "/etc/passwd Confidential Salaries.pdf",
    contentType: "application/pdf; note=AWS_SECRET_ACCESS_KEY",
    bytes: enc("123-45-6789 patient record X-Amz-Signature=deadbeef"),
    ...over,
  };
}

function hostileInput(
  over: Partial<ArtifactValidationInput> = {},
): ArtifactValidationInput {
  return {
    tool: "compress-pdf", // a public catalog slug, not user content
    processor: "compress",
    retention: DEFAULT_RETENTION,
    artifacts: [hostileArtifact()],
    ...over,
  };
}

/** Everything a validation can expose, concatenated for scanning. */
function surfaces(v: ArtifactValidation): string {
  return `${v.verdict}|${v.reason}|${v.detail}|${JSON.stringify(v)}`;
}

describe("artifact-manifest validations are content-free", () => {
  const cases: {
    name: string;
    input: ArtifactValidationInput;
  }[] = [
    {
      name: "pass (a valid PDF whose bytes embed an SSN + patient record)",
      input: hostileInput({
        artifacts: [hostileArtifact({ filename: "Confidential Salaries.pdf" })],
      }),
    },
    {
      name: "reject: empty_artifact",
      input: hostileInput({
        artifacts: [hostileArtifact({ bytes: new Uint8Array() })],
      }),
    },
    {
      name: "reject: content_type_mismatch",
      input: hostileInput({
        artifacts: [
          hostileArtifact({ contentType: "text/plain; k=AWS_SECRET_ACCESS_KEY" }),
        ],
      }),
    },
    {
      name: "reject: unknown_output_kind",
      input: hostileInput({
        artifacts: [
          hostileArtifact({
            filename: "x.bin",
            contentType: "application/x-weird; k=AWS_SECRET_ACCESS_KEY",
          }),
        ],
      }),
    },
    {
      name: "reject: no_artifacts",
      input: hostileInput({ artifacts: [] }),
    },
  ];

  for (const c of cases) {
    it(`${c.name} — leaks nothing`, () => {
      const v = checkArtifacts(DEFAULT_ARTIFACT_POLICY, c.input);
      const text = surfaces(v);
      for (const secret of FORBIDDEN) {
        expect(text, `${c.name} leaked "${secret}"`).not.toContain(secret);
      }
      // The manifest carries no filename/bytes field at all.
      for (const check of v.checks) {
        const keys = Object.keys(check.manifest);
        expect(keys).not.toContain("filename");
        expect(keys).not.toContain("bytes");
        expect(keys).not.toContain("url");
      }
    });
  }

  it("a rejection receipt built from a hostile output is content-free", () => {
    const receipt = buildArtifactReceipt({
      category: "rejected",
      reason: "content_type_mismatch",
      processor: "compress",
      totalBytes: 987_654,
      artifactCount: 1,
      at: "2026-07-03T00:00:00.000Z",
    });
    const text = JSON.stringify(receipt);
    for (const secret of [...FORBIDDEN, "987654"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("a metric built from a hostile check carries only bounded enum labels", () => {
    const v = checkArtifacts(
      DEFAULT_ARTIFACT_POLICY,
      hostileInput({ artifacts: [hostileArtifact({ bytes: new Uint8Array() })] }),
    );
    const sample = artifactManifestMetric(
      v.checks[0]!.verdict,
      v.checks[0]!.reason,
      v.checks[0]!.manifest.outputKind,
      "compress",
    );
    const text = JSON.stringify(sample);
    for (const secret of FORBIDDEN) {
      expect(text).not.toContain(secret);
    }
    // Only the four bounded labels, all from closed vocabularies.
    expect(Object.keys(sample.labels).sort()).toEqual([
      "kind",
      "processor",
      "reason",
      "verdict",
    ]);
  });

  it("the gate capability detail names no variable, value, or secret", () => {
    const detail = createArtifactManifestGate(DEFAULT_ARTIFACT_POLICY)
      .capability()
      .detail;
    for (const secret of [...FORBIDDEN, "PDFXYZ_"]) {
      expect(detail).not.toContain(secret);
    }
  });

  it("a reject detail is a fixed string independent of the output bytes", () => {
    const a = checkArtifacts(
      DEFAULT_ARTIFACT_POLICY,
      hostileInput({ artifacts: [hostileArtifact({ bytes: enc("AAAA one") })] }),
    );
    const b = checkArtifacts(
      DEFAULT_ARTIFACT_POLICY,
      hostileInput({
        artifacts: [hostileArtifact({ bytes: enc("BBBB totally different two") })],
      }),
    );
    // Same shape ⇒ byte-identical detail; the output never colors the message.
    expect(a.reason).toBe(b.reason);
    expect(a.detail).toBe(b.detail);
  });
});
