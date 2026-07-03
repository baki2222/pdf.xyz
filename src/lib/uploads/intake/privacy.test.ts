import { describe, expect, it } from "vitest";
import { DEFAULT_INTAKE_POLICY } from "./policy";
import {
  evaluateUploadDescriptors,
  evaluateUploadedBytes,
  intakeErrorResult,
  type IntakeRejection,
} from "./evaluate";

const enc = (s: string) => new TextEncoder().encode(s);

/** Everything a rejection can turn into that might reach a log, a client, or a metric. */
function surfaces(rejection: IntakeRejection): string {
  return [
    rejection.message,
    JSON.stringify(rejection.telemetry),
    JSON.stringify(intakeErrorResult(rejection)),
  ].join("\n");
}

function rejectionFor(body: unknown): IntakeRejection {
  const decision = evaluateUploadDescriptors(body);
  if (decision.ok) throw new Error("expected the input to be rejected");
  return decision.rejection;
}

// Hostile filenames — each carries a path separator or traversal token, so intake
// rejects it, and each embeds a distinctive secret we assert never leaks.
const HOSTILE_FILENAMES: Array<{ filename: string; secrets: string[] }> = [
  { filename: "../../../../etc/passwd", secrets: ["etc/passwd", "passwd"] },
  { filename: "..\\..\\Windows\\System32\\config\\SAM", secrets: ["System32", "SAM"] },
  {
    filename: "s3://prod-bucket/private/obj_9f8e7d6c5b",
    secrets: ["prod-bucket", "obj_9f8e7d6c5b"],
  },
  {
    filename: "https://acme.s3.amazonaws.com/key?X-Amz-Signature=deadbeefcafe1234",
    secrets: ["X-Amz-Signature", "deadbeefcafe1234", "amazonaws"],
  },
  {
    filename: "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/bPxRfiCYEXAMPLEKEY",
    secrets: ["wJalrXUtnFEMI", "EXAMPLEKEY"],
  },
  {
    filename: "uploads/2026/07/03/obj_abc123_secret_key",
    secrets: ["obj_abc123", "secret_key"],
  },
];

describe("privacy: hostile filenames are rejected but never echoed", () => {
  it.each(HOSTILE_FILENAMES)("$filename", ({ filename, secrets }) => {
    const rejection = rejectionFor({
      files: [{ filename, contentType: "application/pdf", bytes: 10 }],
    });
    expect(rejection.code).toBe("invalid_upload_request");
    const text = surfaces(rejection);
    expect(text).not.toContain(filename);
    for (const secret of secrets) expect(text).not.toContain(secret);
    // Only a positional pointer may name the field.
    expect(rejection.field).toBe("files[0].filename");
  });
});

describe("privacy: a sensitive but non-hostile name only trips length, and stays hidden", () => {
  it("an over-length filename embedding an SSN never echoes it", () => {
    const filename = `Confidential-SSN-123-45-6789-${"x".repeat(300)}.pdf`;
    const rejection = rejectionFor({
      files: [{ filename, contentType: "application/pdf", bytes: 10 }],
    });
    expect(rejection.code).toBe("invalid_upload_request");
    const text = surfaces(rejection);
    expect(text).not.toContain("123-45-6789");
    expect(text).not.toContain("Confidential");
    // The message names the limit, not the value.
    expect(rejection.message).toContain(String(DEFAULT_INTAKE_POLICY.maxFilenameLength));
  });
});

describe("privacy: hostile strings in Content-Type never surface", () => {
  it("a path/URL smuggled into Content-Type fails the shape check and is deferred", () => {
    // These are not valid MIME shapes, so intake ignores them (no echo, no rejection).
    for (const contentType of ["/etc/passwd", "http://169.254.169.254/latest", "a b c"]) {
      expect(
        evaluateUploadDescriptors({ files: [{ filename: "a.pdf", contentType, bytes: 1 }] }),
      ).toEqual({ ok: true });
    }
  });

  it("only a bounded, shape-validated MIME token can appear in an unsupported-type error", () => {
    const rejection = rejectionFor({
      files: [{ filename: "a.bin", contentType: "application/x-msdownload", bytes: 1 }],
    });
    expect(rejection.code).toBe("unsupported_file_type");
    // The (harmless) MIME token may appear; nothing path/URL/name-like can.
    expect(rejection.message).toContain("application/x-msdownload");
    expect(surfaces(rejection)).not.toContain("a.bin");
  });
});

describe("privacy: uploaded bytes are never echoed on a malformed_pdf", () => {
  it("document-looking text in the buffer does not reach the error or telemetry", () => {
    const bytes = enc("SECRET SSN 123-45-6789 patient record — clearly not a PDF");
    const decision = evaluateUploadedBytes(
      bytes,
      { contentType: "application/pdf" },
      { ...DEFAULT_INTAKE_POLICY, requirePdfMagic: true },
    );
    if (decision.ok) throw new Error("expected a rejection");
    const text = surfaces(decision.rejection);
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("123-45-6789");
    expect(text).not.toContain("patient");
    // Only a coarse structural reason is recorded.
    expect(decision.rejection.telemetry.pdf).toBe("missing_header");
  });
});
