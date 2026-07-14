import { describe, expect, it } from "vitest";
import { buildSecurityCapability, QPDF_OPERATIONS } from "./capability";

describe("buildSecurityCapability", () => {
  it("is available in local-dev only when qpdf was probed present", () => {
    const yes = buildSecurityCapability("local-dev", true);
    expect(yes.available).toBe(true);
    expect(yes.operations).toEqual([...QPDF_OPERATIONS]);
    expect(yes.detail).toMatch(/qpdf/i);
    expect(yes.detail).toMatch(/repair/i);

    const no = buildSecurityCapability("local-dev", false);
    expect(no.available).toBe(false);
    expect(no.detail).toMatch(/qpdf/i);
  });

  it("treats an unknown qpdf probe as unavailable", () => {
    expect(buildSecurityCapability("local-dev", undefined).available).toBe(false);
  });

  it("is never available-from-here in remote-configured (web can't see the worker's engine)", () => {
    const cap = buildSecurityCapability("remote-configured", true);
    expect(cap.available).toBe(false);
    expect(cap.detail).toMatch(/secure worker/i);
  });

  it("is unavailable when disabled", () => {
    const cap = buildSecurityCapability("disabled");
    expect(cap.available).toBe(false);
    // Still names all qpdf-backed operations so the UI can render an honest, complete label.
    expect(cap.operations).toEqual([...QPDF_OPERATIONS]);
  });
});
