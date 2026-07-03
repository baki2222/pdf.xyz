// @vitest-environment node
import { describe, expect, it } from "vitest";
import { downloadHeadersFor } from "./access";
import {
  ARTIFACT_DELIVERY_METHODS,
  ARTIFACT_DELIVERY_OUTCOMES,
  ARTIFACT_DELIVERY_RANGES,
  ARTIFACT_DELIVERY_REASONS,
  DEFAULT_ARTIFACT_DELIVERY_POLICY,
  decideDelivery,
  deliveryMethodFor,
  deliveryOutcomeFor,
  deliveryRangeFor,
  httpErrorForDeliveryReason,
  type ArtifactDeliveryDenyReason,
  type DeliveryInput,
} from "./delivery";
import type { ArtifactOutputKind } from "./types";

/** Build the safe access headers a served PDF/text artifact would carry. */
function pdfHeaders(byteLength: number) {
  return downloadHeadersFor("pdf", "application/pdf", "compress", byteLength);
}

/** A valid delivery input for `n` bytes, overridable per case. */
function input(n: number, over: Partial<DeliveryInput> = {}): DeliveryInput {
  return {
    kind: "pdf",
    headers: pdfHeaders(n),
    decidedLength: n,
    actualLength: n,
    reportedLength: null,
    method: "GET",
    range: "none",
    ...over,
  };
}

describe("decideDelivery — happy path", () => {
  it("delivers a GET with a body, verified Content-Length, and Accept-Ranges: none", () => {
    const d = decideDelivery(input(20));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.reason).toBe("ok");
    expect(d.includeBody).toBe(true);
    expect(d.byteLength).toBe(20);
    expect(d.headers["content-length"]).toBe("20");
    expect(d.headers["accept-ranges"]).toBe("none");
    // The access layer's safe headers survive unchanged.
    expect(d.headers["content-type"]).toBe("application/pdf");
    expect(d.headers["content-disposition"]).toBe('attachment; filename="compressed.pdf"');
    expect(d.headers["cache-control"]).toBe("private, no-store");
    expect(d.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("delivers a HEAD with NO body but the same verified headers (incl Content-Length)", () => {
    const d = decideDelivery(input(20, { method: "HEAD" }));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.includeBody).toBe(false);
    expect(d.headers["content-length"]).toBe("20");
    expect(d.headers["accept-ranges"]).toBe("none");
    expect(d.headers["content-disposition"]).toBe('attachment; filename="compressed.pdf"');
  });

  it("delivers when the provider-declared length matches the actual bytes", () => {
    const d = decideDelivery(input(20, { reportedLength: 20 }));
    expect(d.ok).toBe(true);
  });

  it("delivers a whole-file 200 even when a Range was requested (range ignored)", () => {
    const d = decideDelivery(input(20, { range: "ignored" }));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    // No 206/partial: the whole file, with Accept-Ranges: none, and a body.
    expect(d.includeBody).toBe(true);
    expect(d.byteLength).toBe(20);
    expect(d.headers["accept-ranges"]).toBe("none");
    expect(d.headers["content-length"]).toBe("20");
  });

  it("delivers a zero-provider-length source (local-dev) via the actual bytes alone", () => {
    const d = decideDelivery(input(5, { reportedLength: null }));
    expect(d.ok).toBe(true);
  });

  it("preserves the charset'd Content-Type and generated name for a text sidecar", () => {
    const bytes = 12;
    const d = decideDelivery({
      kind: "text-sidecar",
      headers: downloadHeadersFor("text-sidecar", "text/plain", "ocr", bytes),
      decidedLength: bytes,
      actualLength: bytes,
      reportedLength: bytes,
      method: "GET",
      range: "none",
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(d.headers["content-disposition"]).toBe('attachment; filename="extracted-text.txt"');
    expect(d.headers["accept-ranges"]).toBe("none");
    expect(d.headers["content-length"]).toBe(String(bytes));
  });
});

describe("decideDelivery — length consistency", () => {
  it("denies size_mismatch when the decided length disagrees with the actual bytes", () => {
    const d = decideDelivery(input(20, { decidedLength: 25 }));
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("size_mismatch");
  });

  it("denies size_mismatch when the provider-declared length disagrees with the bytes", () => {
    // A bucket that over-declares (Content-Length: 999) but streamed 20 bytes.
    const d = decideDelivery(input(20, { reportedLength: 999 }));
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("size_mismatch");
  });

  it("denies size_mismatch when the provider under-declares", () => {
    const d = decideDelivery(input(20, { reportedLength: 5 }));
    expect(d.ok).toBe(false);
  });

  it("denies size_mismatch for a non-integer or negative length (defensive)", () => {
    expect(decideDelivery(input(20, { actualLength: 20.5 })).ok).toBe(false);
    expect(decideDelivery(input(20, { actualLength: -1, decidedLength: -1 })).ok).toBe(false);
    expect(decideDelivery(input(20, { reportedLength: 20.5 })).ok).toBe(false);
    expect(decideDelivery(input(20, { actualLength: Number.NaN })).ok).toBe(false);
  });
});

describe("decideDelivery — size ceiling", () => {
  it("denies oversize when the artifact exceeds the delivery ceiling", () => {
    // Use huge lengths (no allocation) against a tiny injected ceiling.
    const big = 2_000_000_000;
    const d = decideDelivery(
      { ...input(0), decidedLength: big, actualLength: big, headers: pdfHeaders(big) },
      { maxBytes: 1_000 },
    );
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("oversize");
  });

  it("delivers exactly at the ceiling (boundary is inclusive)", () => {
    const d = decideDelivery(input(1_000, { headers: pdfHeaders(1_000) }), { maxBytes: 1_000 });
    expect(d.ok).toBe(true);
  });

  it("treats maxBytes: 0 as disabled (no ceiling)", () => {
    const big = 5_000_000_000;
    const d = decideDelivery(
      { ...input(0), decidedLength: big, actualLength: big, headers: pdfHeaders(big) },
      { maxBytes: 0 },
    );
    expect(d.ok).toBe(true);
  });

  it("ships a generous default ceiling well above any real output", () => {
    // 1 GiB default — larger than any realistic single produced artifact.
    expect(DEFAULT_ARTIFACT_DELIVERY_POLICY.maxBytes).toBeGreaterThanOrEqual(64 * 1024 * 1024);
    expect(Number.isSafeInteger(DEFAULT_ARTIFACT_DELIVERY_POLICY.maxBytes)).toBe(true);
  });
});

describe("delivery helpers", () => {
  it("deliveryMethodFor recognizes HEAD case-insensitively, else GET", () => {
    expect(deliveryMethodFor("HEAD")).toBe("HEAD");
    expect(deliveryMethodFor("head")).toBe("HEAD");
    expect(deliveryMethodFor("GET")).toBe("GET");
    expect(deliveryMethodFor("get")).toBe("GET");
    expect(deliveryMethodFor("POST")).toBe("GET");
    expect(deliveryMethodFor(null)).toBe("GET");
    expect(deliveryMethodFor(undefined)).toBe("GET");
  });

  it("deliveryRangeFor marks a present Range as ignored, absent/blank as none", () => {
    expect(deliveryRangeFor("bytes=0-99")).toBe("ignored");
    expect(deliveryRangeFor("bytes=100-")).toBe("ignored");
    expect(deliveryRangeFor("")).toBe("none");
    expect(deliveryRangeFor("   ")).toBe("none");
    expect(deliveryRangeFor(null)).toBe("none");
    expect(deliveryRangeFor(undefined)).toBe("none");
  });

  it("deliveryOutcomeFor folds ok→delivered and every denial→denied", () => {
    expect(deliveryOutcomeFor("ok")).toBe("delivered");
    for (const r of ARTIFACT_DELIVERY_REASONS.filter((x) => x !== "ok")) {
      expect(deliveryOutcomeFor(r)).toBe("denied");
    }
  });

  it("maps every delivery-denial reason to a content-free 503 service_unavailable", () => {
    const denyReasons: ArtifactDeliveryDenyReason[] = ["size_mismatch", "oversize", "stream_error"];
    for (const reason of denyReasons) {
      const { code, message } = httpErrorForDeliveryReason(reason);
      expect(code).toBe("service_unavailable");
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe("decideDelivery — content-free & bounded", () => {
  const FORBIDDEN = [
    "/etc/passwd",
    "Confidential.pdf",
    "X-Amz-Signature",
    "AWS_SECRET_ACCESS_KEY",
    "s3.amazonaws.com",
    "art_abcdefghij0123456789",
    "123-45-6789",
  ];

  it("a delivered decision's headers carry none of the forbidden substrings", () => {
    const d = decideDelivery(input(42));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const blob = Object.entries(d.headers).map(([k, v]) => `${k}: ${v}`).join("\n");
    for (const secret of FORBIDDEN) expect(blob).not.toContain(secret);
  });

  it("a denied decision's detail carries none of the forbidden substrings", () => {
    const d = decideDelivery(input(20, { reportedLength: 999 }));
    expect(d.ok).toBe(false);
    if (d.ok) return;
    for (const secret of FORBIDDEN) expect(d.detail).not.toContain(secret);
  });

  it("the exported enums stay small and closed", () => {
    expect([...ARTIFACT_DELIVERY_METHODS]).toEqual(["GET", "HEAD"]);
    expect([...ARTIFACT_DELIVERY_RANGES]).toEqual(["none", "ignored"]);
    expect([...ARTIFACT_DELIVERY_OUTCOMES]).toEqual(["delivered", "denied"]);
    expect([...ARTIFACT_DELIVERY_REASONS]).toEqual([
      "ok",
      "size_mismatch",
      "oversize",
      "stream_error",
    ]);
  });

  it("preserves the served kind for observability across kinds", () => {
    const kinds: ArtifactOutputKind[] = ["pdf", "text-sidecar", "archive", "image"];
    for (const kind of kinds) {
      const d = decideDelivery(input(10, { kind }));
      expect(d.ok).toBe(true);
    }
  });
});
