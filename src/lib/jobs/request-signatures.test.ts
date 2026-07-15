import { describe, expect, it } from "vitest";
import {
  MAX_REQUEST_SIGNERS,
  MAX_REQUEST_FIELDS,
  REQUEST_SIGNATURE_FIELD_TYPES,
  parseSignatureRequestOptions,
  signatureRequestOutputName,
} from "./request-signatures";

/** A minimal, valid request: two signers, one signature field each on page 1. */
function validOptions(): Record<string, unknown> {
  return {
    signers: [
      { name: "Ada Lovelace", email: "ada@example.com" },
      { name: "Alan Turing", email: "alan@example.com" },
    ],
    fields: [
      { signer: 0, page: 1, type: "signature", x: 0.1, y: 0.1, width: 0.35, height: 0.06 },
      { signer: 1, page: 1, type: "signature", x: 0.55, y: 0.1, width: 0.35, height: 0.06 },
    ],
  };
}

describe("parseSignatureRequestOptions", () => {
  it("accepts a well-formed request and applies defaults", () => {
    const parsed = parseSignatureRequestOptions(validOptions());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.signers).toHaveLength(2);
      expect(parsed.value.fields).toHaveLength(2);
      // Defaults: sequential routing, no external delivery, fields required.
      expect(parsed.value.routing).toBe("sequential");
      expect(parsed.value.deliver).toBe(false);
      expect(parsed.value.fields[0]!.required).toBe(true);
      expect(parsed.value.title).toBeUndefined();
    }
  });

  it("preserves an explicit routing, title, message, and deliver flag", () => {
    const parsed = parseSignatureRequestOptions({
      ...validOptions(),
      routing: "parallel",
      title: "NDA",
      message: "Please sign by Friday.",
      deliver: true,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.routing).toBe("parallel");
      expect(parsed.value.title).toBe("NDA");
      expect(parsed.value.message).toBe("Please sign by Friday.");
      expect(parsed.value.deliver).toBe(true);
    }
  });

  it("exposes the supported field types", () => {
    expect([...REQUEST_SIGNATURE_FIELD_TYPES]).toEqual([
      "signature",
      "initials",
      "date",
      "text",
    ]);
  });

  it("rejects a request with no signers", () => {
    const parsed = parseSignatureRequestOptions({ ...validOptions(), signers: [] });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.body.error.code).toBe("invalid_request");
  });

  it("rejects too many signers", () => {
    const signers = Array.from({ length: MAX_REQUEST_SIGNERS + 1 }, (_, i) => ({
      name: `Signer ${i}`,
      email: `s${i}@example.com`,
    }));
    const parsed = parseSignatureRequestOptions({ ...validOptions(), signers });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.body.error.code).toBe("invalid_request");
  });

  it("rejects a malformed email", () => {
    const parsed = parseSignatureRequestOptions({
      ...validOptions(),
      signers: [{ name: "Ada", email: "not-an-email" }],
      fields: [{ signer: 0, page: 1, type: "signature", x: 0.1, y: 0.1, width: 0.2, height: 0.05 }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.body.error.code).toBe("invalid_request");
  });

  it("rejects a field that references an unknown signer", () => {
    const parsed = parseSignatureRequestOptions({
      ...validOptions(),
      fields: [{ signer: 5, page: 1, type: "signature", x: 0.1, y: 0.1, width: 0.2, height: 0.05 }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.body.error.code).toBe("invalid_request");
  });

  it("rejects a field with no signers pointing at it", () => {
    const parsed = parseSignatureRequestOptions({ ...validOptions(), fields: [] });
    expect(parsed.ok).toBe(false);
  });

  it("rejects out-of-range fractional coordinates", () => {
    const parsed = parseSignatureRequestOptions({
      ...validOptions(),
      fields: [{ signer: 0, page: 1, type: "signature", x: 0.9, y: 0.1, width: 0.4, height: 0.05 }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.body.error.code).toBe("invalid_request");
  });

  it("rejects a non-positive page", () => {
    const parsed = parseSignatureRequestOptions({
      ...validOptions(),
      fields: [{ signer: 0, page: 0, type: "signature", x: 0.1, y: 0.1, width: 0.2, height: 0.05 }],
    });
    expect(parsed.ok).toBe(false);
  });

  it("rejects an unknown field type", () => {
    const parsed = parseSignatureRequestOptions({
      ...validOptions(),
      fields: [{ signer: 0, page: 1, type: "notarize", x: 0.1, y: 0.1, width: 0.2, height: 0.05 }],
    });
    expect(parsed.ok).toBe(false);
  });

  it("rejects too many fields", () => {
    const fields = Array.from({ length: MAX_REQUEST_FIELDS + 1 }, () => ({
      signer: 0,
      page: 1,
      type: "signature",
      x: 0.1,
      y: 0.1,
      width: 0.1,
      height: 0.03,
    }));
    const parsed = parseSignatureRequestOptions({ ...validOptions(), fields });
    expect(parsed.ok).toBe(false);
  });

  it("rejects a non-object options bag", () => {
    expect(parseSignatureRequestOptions([] as unknown as Record<string, unknown>).ok).toBe(false);
  });
});

describe("signatureRequestOutputName", () => {
  it("derives a deterministic package name from the source", () => {
    expect(signatureRequestOutputName("Master Services Agreement.pdf")).toBe(
      "Master Services Agreement-signature-request.zip",
    );
  });

  it("falls back to a neutral stem when nothing survives sanitization", () => {
    expect(signatureRequestOutputName("")).toBe("document-signature-request.zip");
  });
});
