// @vitest-environment node
/**
 * The gate wrapper: it reports an honest presence-only capability and delegates
 * `check` to the pure evaluation. The disabled/default convenience gates behave as
 * documented.
 */
import { describe, expect, it } from "vitest";
import type { ProcessorInputFile } from "../processor/types";
import {
  createSoundnessGate,
  defaultSoundnessGate,
  disabledSoundnessGate,
} from "./gate";
import { DEFAULT_SOUNDNESS_POLICY } from "./policy";
import { resolveWorkerSoundness } from "./index";

const enc = (s: string) => new TextEncoder().encode(s);
const VALID_PDF = enc(`%PDF-1.7\n${"0".repeat(64)}\n%%EOF\n`);

function file(bytes: Uint8Array): ProcessorInputFile {
  return { fileId: "f", filename: "n", contentType: "application/pdf", bytes };
}

describe("createSoundnessGate — capability", () => {
  it("reports enabled/active for an enabled policy", () => {
    const cap = createSoundnessGate(DEFAULT_SOUNDNESS_POLICY).capability();
    expect(cap).toMatchObject({ active: true, mode: "enabled" });
    expect(cap.detail).toContain("enabled");
  });

  it("reports disabled/inactive for a disabled policy", () => {
    const cap = createSoundnessGate({
      ...DEFAULT_SOUNDNESS_POLICY,
      enabled: false,
    }).capability();
    expect(cap).toMatchObject({ active: false, mode: "disabled" });
  });

  it("returns the same capability object shape on repeat calls", () => {
    const gate = createSoundnessGate(DEFAULT_SOUNDNESS_POLICY);
    expect(gate.capability()).toEqual(gate.capability());
  });
});

describe("createSoundnessGate — check delegates to the evaluation", () => {
  it("passes a valid PDF and blocks a non-PDF for a PDF tool", () => {
    const gate = createSoundnessGate(DEFAULT_SOUNDNESS_POLICY);
    expect(
      gate.check({ tool: "compress-pdf", inputs: [file(VALID_PDF)] }).verdict,
    ).toBe("sound");
    expect(
      gate.check({ tool: "compress-pdf", inputs: [file(enc("nope"))] }).verdict,
    ).toBe("unsound");
  });
});

describe("convenience gates", () => {
  it("defaultSoundnessGate is enabled with the shipped policy", () => {
    expect(defaultSoundnessGate().capability().active).toBe(true);
  });

  it("disabledSoundnessGate checks nothing and reports disabled", () => {
    const gate = disabledSoundnessGate();
    expect(gate.capability().active).toBe(false);
    expect(
      gate.check({ tool: "compress-pdf", inputs: [file(enc("nope"))] }).verdict,
    ).toBe("skipped");
  });
});

describe("resolveWorkerSoundness — env factory", () => {
  it("with an empty env resolves an enabled gate", () => {
    expect(resolveWorkerSoundness({}).capability().active).toBe(true);
  });

  it("resolves a disabled gate when the operator turns it off", () => {
    const gate = resolveWorkerSoundness({ PDFXYZ_WORKER_SOUNDNESS: "off" });
    expect(gate.capability().active).toBe(false);
  });
});
