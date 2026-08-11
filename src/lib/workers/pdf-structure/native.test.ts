// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createNativeQpdfStructureRunner,
  linearizeArgs,
  nativePdfStructureDeps,
  probeQpdfStructureFromConfig,
  repairArgs,
  sanitizeQpdfWarnings,
  type QpdfStructureExec,
  type QpdfStructureExecResult,
  type QpdfStructureFs,
} from "./native";
import type { NativePdfStructureConfig } from "./native-config";

function pdf(pad = 40): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(pad)}\n%%EOF\n`);
}

function config(
  over: Partial<NativePdfStructureConfig> = {},
): NativePdfStructureConfig {
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

    expect(out.bytes).toEqual(pdf(64));
    expect(out.warnings).toEqual([]);
    expect(calls).toEqual([
      {
        command: "qpdf",
        args: [
          expect.stringMatching(/input\.pdf$/),
          expect.stringMatching(/output\.pdf$/),
        ],
      },
    ]);
    expect(rmCount()).toBe(1);
  });

  it("linearizes with --linearize and cleans up", async () => {
    const { fs, rmCount } = fakeFs(pdf(80));
    const { exec, calls } = fakeExec(OK);
    const runner = createNativeQpdfStructureRunner(config(), { exec, fs });

    const out = await runner.linearize(pdf());

    expect(out.bytes).toEqual(pdf(80));
    expect(calls[0]?.args[0]).toBe("--linearize");
    expect(calls[0]?.args[1]).toMatch(/input\.pdf$/);
    expect(calls[0]?.args[2]).toMatch(/output\.pdf$/);
    expect(rmCount()).toBe(1);
  });

  /**
   * INVERTED 2026-08-11, not deleted — the history is the point.
   *
   * This test was named "throws and still cleans up on qpdf failure" and its
   * fixture was `fakeExec({ code: 3 })`. Exit 3 is qpdf's DOCUMENTED "warnings
   * issued, output was created" — for a damaged file, that is what a
   * successful recovery looks like. The test called it a failure, asserted the
   * throw, and so pinned the discarding of the exact repair `repair-pdf`
   * exists to perform. Nothing else in the suite ever touched the throw path,
   * so this one test was the whole of what the repo believed about exit 3.
   *
   * Deleting it would leave no evidence anyone believed that. It now asserts
   * the opposite, on the same fixture.
   */
  it("treats qpdf exit 3 as a RECOVERY, not a failure, and reports the warnings", async () => {
    const { fs, rmCount } = fakeFs(pdf(64));
    const { exec } = fakeExec({
      code: 3,
      timedOut: false,
      stderr:
        "qpdf: file is damaged\nqpdf: reconstructing cross-reference table\n",
    });
    const runner = createNativeQpdfStructureRunner(config(), { exec, fs });

    const out = await runner.repair(pdf());

    expect(out.bytes).toEqual(pdf(64));
    expect(out.warnings).toEqual([
      "file is damaged",
      "reconstructing cross-reference table",
    ]);
    expect(rmCount()).toBe(1);
  });

  it("still throws on a real qpdf error exit, and cleans up", async () => {
    // Exit 2 is qpdf's error status: no usable output. The cleanup half of the
    // original test was always right and is kept.
    const { fs, rmCount } = fakeFs(pdf());
    const { exec } = fakeExec({ code: 2, timedOut: false });
    const runner = createNativeQpdfStructureRunner(config(), { exec, fs });
    await expect(runner.repair(pdf())).rejects.toThrow();
    expect(rmCount()).toBe(1);
  });

  it("rejects oversized input before spawning", async () => {
    const { fs, rmCount } = fakeFs(pdf());
    const { exec, calls } = fakeExec(OK);
    const runner = createNativeQpdfStructureRunner(
      config({ maxInputBytes: 4 }),
      {
        exec,
        fs,
      },
    );
    await expect(runner.linearize(pdf(64))).rejects.toThrow();
    expect(calls).toHaveLength(0);
    expect(rmCount()).toBe(0);
  });
});

describe("probe/native deps", () => {
  it("probes PATH unless disabled or overridden", () => {
    expect(
      probeQpdfStructureFromConfig(config({ enabled: false }), {
        resolveOnPath: () => true,
      }),
    ).toBe(false);
    expect(
      probeQpdfStructureFromConfig(config(), { resolveOnPath: () => true }),
    ).toBe(true);
    expect(
      probeQpdfStructureFromConfig(config(), { resolveOnPath: () => false }),
    ).toBe(false);
    expect(
      probeQpdfStructureFromConfig(
        config({ overridden: true, binary: "/opt/qpdf" }),
        {
          fileExists: (p) => p === "/opt/qpdf",
        },
      ),
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

describe("sanitizeQpdfWarnings", () => {
  it("removes the temp paths qpdf names", () => {
    const dir = "/tmp/pdfxyz-structure-ab12";
    const raw = `qpdf: ${dir}/input.pdf: file is damaged\nqpdf: ${dir}/input.pdf: recovered 3 objects\n`;
    expect(
      sanitizeQpdfWarnings(raw, [`${dir}/input.pdf`, `${dir}/output.pdf`, dir]),
    ).toEqual(["file is damaged", "recovered 3 objects"]);
  });

  it("drops a line it could not fully scrub, and counts it", () => {
    // Fails closed: a half-scrubbed path is still a leak. But a list that
    // quietly shrinks reads as "the document was fine".
    const out = sanitizeQpdfWarnings(
      "qpdf: /var/other/secret.pdf: damaged\nqpdf: recovered\n",
      ["/tmp/pdfxyz-structure-ab12"],
    );
    expect(out).toEqual(["recovered", "1 further qpdf message(s) not shown."]);
  });

  it("deduplicates the same message repeated per object", () => {
    const raw = Array.from(
      { length: 40 },
      () => "qpdf: object stream damaged",
    ).join("\n");
    expect(sanitizeQpdfWarnings(raw, [])).toEqual(["object stream damaged"]);
  });

  it("returns nothing for a clean run", () => {
    expect(sanitizeQpdfWarnings("", [])).toEqual([]);
  });
});
