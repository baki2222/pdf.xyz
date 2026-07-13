import { describe, expect, it } from "vitest";
import { buildSecurityCapability } from "./capability";

describe("buildSecurityCapability", () => {
  it("is available in local-dev only when qpdf was probed present", () => {
    const yes = buildSecurityCapability("local-dev", true);
    expect(yes.available).toBe(true);
    expect(yes.operations).toEqual(["protect", "unlock"]);
    expect(yes.detail).toMatch(/qpdf/i);

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
    // Still names both operations so the UI can render an honest, complete label.
    expect(cap.operations).toEqual(["protect", "unlock"]);
  });
});
