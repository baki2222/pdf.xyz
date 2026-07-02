// @vitest-environment node
/**
 * The fake scanner is how tests exercise the executor's scan gate across every
 * verdict without shipping a real scanner. These tests pin its behaviors so the
 * gate tests can rely on them.
 */
import { describe, expect, it } from "vitest";
import { fakeScanner } from "./fake";
import {
  scanClean,
  scanError,
  scanInfected,
  scanInvalid,
  type MalwareScanInput,
} from "./types";

const empty: MalwareScanInput = { tool: "t", inputs: [] };

describe("fakeScanner", () => {
  it("reports clean by default and is an active provider", async () => {
    const scanner = fakeScanner();
    expect((await scanner.scan(empty)).verdict).toBe("clean");
    expect(scanner.capability().active).toBe(true);
    expect(scanner.capability().provider).toBe("fake");
  });

  it("returns a fixed programmed verdict", async () => {
    expect((await fakeScanner(scanInfected()).scan(empty)).verdict).toBe("infected");
    expect((await fakeScanner(scanError()).scan(empty)).verdict).toBe("error");
    const invalid = await fakeScanner(scanInvalid()).scan(empty);
    expect(invalid.verdict).toBe("invalid");
    // `invalid`/`error` never claim the bytes were scanned.
    expect(invalid.scanned).toBe(false);
    expect((await fakeScanner(scanError()).scan(empty)).scanned).toBe(false);
  });

  it("computes a verdict from the input and can record calls", async () => {
    const seen: number[] = [];
    const scanner = fakeScanner((i) => {
      seen.push(i.inputs.length);
      return scanClean();
    });
    await scanner.scan({
      tool: "t",
      inputs: [
        { fileId: "f", filename: "x", contentType: "", bytes: new Uint8Array() },
      ],
    });
    expect(seen).toEqual([1]);
  });

  it("allows overriding the reported capability", () => {
    const scanner = fakeScanner(scanClean(), {
      capability: { active: false, provider: "custom" },
    });
    expect(scanner.capability().active).toBe(false);
    expect(scanner.capability().provider).toBe("custom");
  });
});
