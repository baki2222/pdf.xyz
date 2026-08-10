// @vitest-environment node
/**
 * The one invariant that matters for a security control: silence means "no".
 *
 * The scanner lives on the out-of-band worker, so the web tier learns about it only
 * from a heartbeat. Every way of not knowing — no worker deployed, a stale beat, an
 * unreachable broker, a caller that simply did not pass the flag — has to land on
 * "not scanned". The bug this replaced went the other way: a static string asserted
 * scanning unconditionally, so the product claimed a control it did not have.
 */
import { describe, expect, it } from "vitest";
import { buildWorkerStatus } from "../status";
import { buildScanCapability } from "./capability";

describe("scan capability", () => {
  it("claims scanning only when a heartbeat positively reports it", () => {
    expect(buildScanCapability(true).active).toBe(true);
    expect(buildScanCapability(true).detail).toMatch(/scanned for malware/i);
  });

  it.each([
    ["explicitly false", false],
    ["unknown (no observation possible)", undefined],
  ])("reports NOT scanning when the answer is %s", (_label, observed) => {
    const capability = buildScanCapability(observed);
    expect(capability.active).toBe(false);
    // The disclosure must be explicit, not merely an absence of a claim: a user
    // deciding whether to upload a sensitive document should be told.
    expect(capability.detail).toMatch(/not scanned for malware/i);
    // And it must not accidentally read as a promise.
    expect(capability.detail).not.toMatch(/every file is scanned for malware/i);
  });

  it("defaults to not scanning in every worker status the app can build", () => {
    // buildWorkerStatus takes the flag last and optional. A caller that forgets it —
    // which is every caller that cannot observe a worker — must not get a claim.
    for (const mode of [
      "local-dev",
      "remote-configured",
      "disabled",
    ] as const) {
      expect(buildWorkerStatus(mode).scan.active).toBe(false);
    }
  });

  it("surfaces an observed scanner through the status seam", () => {
    const status = buildWorkerStatus(
      "remote-configured",
      undefined,
      undefined,
      {},
      undefined,
      true,
      undefined,
      true,
    );
    expect(status.scan.active).toBe(true);
  });
});
