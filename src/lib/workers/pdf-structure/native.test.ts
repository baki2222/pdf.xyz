// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createNativeQpdfStructureRunner,
  linearizeArgs,
  nativePdfStructureDeps,
  probeQpdfStructureFromConfig,
  repairArgs,
  type QpdfStructureExec,
  type QpdfStructureExecResult,
  type QpdfStructureFs,
} from "./native";
import type { NativePdfStructureConfig } from "./native-config";

function pdf(pad = 40): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(pad)}\n%%EOF\n`);
}

function config(over: Partial<NativePdfStructureConfig> = {}): NativePdfStructureConfig {
  return {
    enabled: true,
    binary: "qpdf",
    overridden: false,
    timeoutMs: 1_000,
    maxInputBytes: 1024 * 1024,
    maxOutputBytes: 1024 * 1024,
    ...over,
  };
}

function fakeFs(output: Uint8Array) {
  const writes = new Map<string, Uint8Array>();
  let rmCount = 0;
  const fs: QpdfStructureFs = {
    mkdtemp: async (prefix) => `${prefix}dir`,
    writeFile: async (file, data) => {
      writes.set(file, data);
    },
    readFile: async () => output,
    rm: async () => {
      rmCount += 1;
    },
  };
  return { fs, writes, rmCount: () => rmCount };
}

function fakeExec(result: QpdfStructureExecResult) {
  const calls: { command: string; args: string[] }[] = [];
  const exec: QpdfStructureExec = async (command, args) => {
    calls.push({ command, args: [...args] });
    return result;
  };
  return { exec, calls };
}

const OK: QpdfStructureExecResult = { code: 0, timedOut: false };

describe("qpdf structure argument builders", () => {
  it("builds the repair/rewrite vector", () => {
    expect(repairArgs("/tmp/in.pdf", "/tmp/out.pdf")).toEqual([
      "/tmp/in.pdf",
      "/tmp/out.pdf",
    ]);
  });

  it("builds the linearization vector", () => {
    expect(linearizeArgs("/tmp/in.pdf", "/tmp/out.pdf")).toEqual([
      "--linearize",
      "/tmp/in.pdf",
      "/tmp/out.pdf",
    ]);
  });
});

describe("createNativeQpdfStructureRunner", () => {
  it("repairs with fixed argv, no shell, and cleans up", async () => {
    const { fs, rmCount } = fakeFs(pdf(64));
    const { exec, calls } = fakeExec(OK);
    const runner = createNativeQpdfStructureRunner(config(), { exec, fs });

    const out = await runner.repair(pdf());

    expect(out).toEqual(pdf(64));
    expect(calls).toEqual([
      {
        command: "qpdf",
        args: [expect.stringMatching(/input\.pdf$/), expect.stringMatching(/output\.pdf$/)],
      },
    ]);
    expect(rmCount()).toBe(1);
  });

  it("linearizes with --linearize and cleans up", async () => {
    const { fs, rmCount } = fakeFs(pdf(80));
    const { exec, calls } = fakeExec(OK);
    const runner = createNativeQpdfStructureRunner(config(), { exec, fs });

    const out = await runner.linearize(pdf());

    expect(out).toEqual(pdf(80));
    expect(calls[0]?.args[0]).toBe("--linearize");
    expect(calls[0]?.args[1]).toMatch(/input\.pdf$/);
    expect(calls[0]?.args[2]).toMatch(/output\.pdf$/);
    expect(rmCount()).toBe(1);
  });

  it("throws and still cleans up on qpdf failure", async () => {
    const { fs, rmCount } = fakeFs(pdf());
    const { exec } = fakeExec({ code: 3, timedOut: false });
    const runner = createNativeQpdfStructureRunner(config(), { exec, fs });
    await expect(runner.repair(pdf())).rejects.toThrow();
    expect(rmCount()).toBe(1);
  });

  it("rejects oversized input before spawning", async () => {
    const { fs, rmCount } = fakeFs(pdf());
    const { exec, calls } = fakeExec(OK);
    const runner = createNativeQpdfStructureRunner(config({ maxInputBytes: 4 }), {
      exec,
      fs,
    });
    await expect(runner.linearize(pdf(64))).rejects.toThrow();
    expect(calls).toHaveLength(0);
    expect(rmCount()).toBe(0);
  });
});

describe("probe/native deps", () => {
  it("probes PATH unless disabled or overridden", () => {
    expect(probeQpdfStructureFromConfig(config({ enabled: false }), { resolveOnPath: () => true })).toBe(false);
    expect(probeQpdfStructureFromConfig(config(), { resolveOnPath: () => true })).toBe(true);
    expect(probeQpdfStructureFromConfig(config(), { resolveOnPath: () => false })).toBe(false);
    expect(
      probeQpdfStructureFromConfig(config({ overridden: true, binary: "/opt/qpdf" }), {
        fileExists: (p) => p === "/opt/qpdf",
      }),
    ).toBe(true);
  });

  it("wires the runner only when qpdf is available", () => {
    const present = nativePdfStructureDeps({}, { resolveOnPath: () => true });
    expect(present.qpdf).toBeDefined();
    expect(present.limits?.maxInputBytes).toBeGreaterThan(0);

    const absent = nativePdfStructureDeps({}, { resolveOnPath: () => false });
    expect(absent.qpdf).toBeUndefined();
    expect(absent.limits?.maxInputBytes).toBeGreaterThan(0);
  });
});
