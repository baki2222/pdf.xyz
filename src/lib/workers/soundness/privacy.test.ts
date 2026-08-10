// @vitest-environment node
/**
 * The content-free contract for the soundness gate, encoded as an executable test:
 * no verdict, reason, detail, or capability the gate produces may carry a filename,
 * object key, signed URL, secret, or document content — even when the inspected
 * input is *stuffed* with all of them. Mirrors `../../uploads/intake/privacy.test`.
 */
import { describe, expect, it } from "vitest";
import type { ProcessorInputFile } from "../processor/types";
import { checkSoundness } from "./check";
import { createSoundnessGate } from "./gate";
import { DEFAULT_SOUNDNESS_POLICY } from "./policy";
import type { SoundnessResult } from "./types";

/** Secrets/content that must NEVER surface in any gate output. */
const FORBIDDEN = [
  "Confidential Salaries.pdf",
  "/etc/passwd",
  "X-Amz-Signature=deadbeef",
  "AWS_SECRET_ACCESS_KEY",
  "123-45-6789", // an SSN
  "patient record", // document body text
  "obj_abc123secret", // an opaque id / object key
  "https://bucket.s3.amazonaws.com/inputs/x", // a signed URL
];

/** An input whose EVERY field is loaded with forbidden content. */
function hostileFile(bytes: Uint8Array): ProcessorInputFile {
  return {
    fileId: "obj_abc123secret",
    filename: "Confidential Salaries.pdf",
    contentType: "application/pdf; x=AWS_SECRET_ACCESS_KEY",
    bytes,
  };
}

/** Everything a soundness result can expose, concatenated for scanning. */
function surfaces(result: SoundnessResult): string {
  return `${result.verdict}|${result.reason}|${result.detail}|${JSON.stringify(
    result,
  )}`;
}

const enc = (s: string) => new TextEncoder().encode(s);

describe("soundness results are content-free", () => {
  // Bytes that themselves embed secrets/content, across each reject path + the pass.
  const cases: { name: string; tool: string; bytes: Uint8Array }[] = [
    {
      name: "pass (valid PDF whose body embeds an SSN + patient record)",
      tool: "compress-pdf",
      bytes: enc(`%PDF-1.7\n123-45-6789 patient record\n%%EOF\n`),
    },
    {
      name: "reject: malformed_pdf (body is /etc/passwd + a signed URL)",
      tool: "compress-pdf",
      bytes: enc(
        "/etc/passwd https://bucket.s3.amazonaws.com/inputs/x X-Amz-Signature=deadbeef",
      ),
    },
    {
      name: "reject: empty",
      tool: "compress-pdf",
      bytes: new Uint8Array(),
    },
    {
      name: "reject: content_type_mismatch",
      tool: "compress-pdf",
      bytes: enc("%PDF-1.7\n%%EOF\n"),
    },
  ];

  for (const c of cases) {
    it(`${c.name} — leaks nothing`, () => {
      // Force the mismatch path for that specific case by declaring a wrong family.
      const input = c.name.includes("content_type_mismatch")
        ? {
            ...hostileFile(c.bytes),
            contentType: "image/png; x=AWS_SECRET_ACCESS_KEY",
          }
        : hostileFile(c.bytes);
      const result = checkSoundness(DEFAULT_SOUNDNESS_POLICY, {
        tool: c.tool,
        inputs: [input],
      });
      const text = surfaces(result);
      for (const secret of FORBIDDEN) {
        expect(text, `${c.name} leaked "${secret}"`).not.toContain(secret);
      }
    });
  }

  it("the gate capability detail names no variable or value", () => {
    const detail = createSoundnessGate(DEFAULT_SOUNDNESS_POLICY).capability()
      .detail;
    for (const secret of [...FORBIDDEN, "PDFXYZ_"]) {
      expect(detail).not.toContain(secret);
    }
  });

  it("a reject detail is a fixed string independent of the input bytes", () => {
    const a = checkSoundness(DEFAULT_SOUNDNESS_POLICY, {
      tool: "compress-pdf",
      inputs: [hostileFile(enc("AAAA garbage one"))],
    });
    const b = checkSoundness(DEFAULT_SOUNDNESS_POLICY, {
      tool: "compress-pdf",
      inputs: [hostileFile(enc("BBBB totally different garbage two"))],
    });
    // Same reason ⇒ byte-identical detail; the input never colors the message.
    expect(a.reason).toBe("malformed_pdf");
    expect(a.detail).toBe(b.detail);
  });
});
