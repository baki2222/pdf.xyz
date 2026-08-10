// @vitest-environment node
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import type { CompressionOptions } from "./engine";
import type { NativeCompressionConfig } from "./native-config";
import {
  createNativeCompressor,
  nativeArgs,
  nativeCompressionDeps,
  probeNativeTools,
  probeNativeToolsFromConfig,
  type NativeExec,
  type NativeFs,
  type NativeSeams,
} from "./native";

/** A full config with sane defaults; override any field per test. */
function cfg(
  over: Partial<NativeCompressionConfig> = {},
): NativeCompressionConfig {
  return {
    enabled: true,
    binaries: { ghostscript: "gs", qpdf: "qpdf", mutool: "mutool" },
    overridden: { ghostscript: false, qpdf: false, mutool: false },
    timeoutMs: 120_000,
    maxInputBytes: 200 * 1024 * 1024,
    maxOutputBytes: 200 * 1024 * 1024,
    ...over,
  };
}

const DEEP: CompressionOptions = { profile: "deep", targetDpi: 150 };

/** Minimal bytes that satisfy the structural PDF check (header + trailer). */
const VALID_PDF = new TextEncoder().encode(
  `%PDF-1.7\n${"x".repeat(64)}\n%%EOF\n`,
);
const NOT_PDF = new TextEncoder().encode("this is plainly not a pdf document");

interface FsCalls {
  mkdtemp: string[];
  writeFile: { file: string; len: number }[];
  readFile: string[];
  rm: string[];
}

/** A recording fake fs whose readFile returns the given output (or throws). */
function fakeFs(read: () => Uint8Array): { fs: NativeFs; calls: FsCalls } {
  const calls: FsCalls = { mkdtemp: [], writeFile: [], readFile: [], rm: [] };
  const fs: NativeFs = {
    async mkdtemp(prefix) {
      calls.mkdtemp.push(prefix);
      return `${prefix}ab12cd`;
    },
    async writeFile(file, data) {
      calls.writeFile.push({ file, len: data.byteLength });
    },
    async readFile(file) {
      calls.readFile.push(file);
      return read();
    },
    async rm(dir) {
      calls.rm.push(dir);
    },
  };
  return { fs, calls };
}

describe("nativeArgs — fixed argv, no shell interpolation", () => {
  it("builds ghostscript args with the resolved command, DPI, and separate paths", () => {
    const { command, args } = nativeArgs(
      "ghostscript",
      "gs",
      "/tmp/j/input.pdf",
      "/tmp/j/output.pdf",
      150,
    );
    expect(command).toBe("gs");
    expect(args).toContain("-dSAFER");
    expect(args).toContain("-dColorImageResolution=150");
    // Input and output are DISTINCT argv elements — never concatenated into a
    // command string, so a path can never be reinterpreted as a flag or shell.
    expect(args).toContain("-sOutputFile=/tmp/j/output.pdf");
    expect(args).toContain("/tmp/j/input.pdf");
    expect(args[args.length - 1]).toBe("/tmp/j/input.pdf");
  });

  it("passes an override command path through verbatim", () => {
    const { command } = nativeArgs(
      "qpdf",
      "/opt/tools/qpdf",
      "/t/in.pdf",
      "/t/out.pdf",
      150,
    );
    expect(command).toBe("/opt/tools/qpdf");
  });

  it("keeps a path with spaces as a single argv element", () => {
    const { args } = nativeArgs(
      "qpdf",
      "qpdf",
      "/t/a b/in.pdf",
      "/t/a b/out.pdf",
      150,
    );
    // qpdf takes input then output as the final two positional argv elements.
    expect(args.slice(-2)).toEqual(["/t/a b/in.pdf", "/t/a b/out.pdf"]);
  });

  it("builds mutool clean args", () => {
    const { command, args } = nativeArgs(
      "mutool",
      "mutool",
      "/t/in.pdf",
      "/t/out.pdf",
      150,
    );
    expect(command).toBe("mutool");
    expect(args).toEqual(["clean", "-ggg", "-z", "/t/in.pdf", "/t/out.pdf"]);
  });
});

describe("createNativeCompressor — success path", () => {
  it("writes input, runs the engine by argv, returns validated PDF bytes, and cleans up", async () => {
    const execCalls: { command: string; args: string[]; options: unknown }[] =
      [];
    const exec: NativeExec = async (command, args, options) => {
      execCalls.push({ command, args: [...args], options });
    };
    const { fs, calls } = fakeFs(() => VALID_PDF);
    const compressor = createNativeCompressor(cfg({ tmpDir: "/base" }), {
      exec,
      fs,
    });

    const out = await compressor(new Uint8Array([1, 2, 3]), {
      engine: "ghostscript",
      options: DEEP,
    });

    expect(out).toEqual(VALID_PDF);
    // The whole temp lifecycle happened, and the temp dir was removed.
    expect(calls.mkdtemp[0]).toContain(join("/base", "pdfxyz-compress-"));
    expect(calls.writeFile).toHaveLength(1);
    expect(calls.readFile).toHaveLength(1);
    expect(calls.rm).toHaveLength(1);
    // The subprocess was invoked by argv array with the configured timeout.
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0]!.command).toBe("gs");
    expect(Array.isArray(execCalls[0]!.args)).toBe(true);
    expect(execCalls[0]!.options).toMatchObject({
      timeout: 120_000,
      windowsHide: true,
    });
  });

  it("honors an overridden binary path as the command", async () => {
    const execCalls: string[] = [];
    const exec: NativeExec = async (command) => {
      execCalls.push(command);
    };
    const { fs } = fakeFs(() => VALID_PDF);
    const config = cfg({
      binaries: {
        ghostscript: "/opt/gs/bin/gs",
        qpdf: "qpdf",
        mutool: "mutool",
      },
      overridden: { ghostscript: true, qpdf: false, mutool: false },
    });
    await createNativeCompressor(config, { exec, fs })(new Uint8Array([1]), {
      engine: "ghostscript",
      options: DEEP,
    });
    expect(execCalls[0]).toBe("/opt/gs/bin/gs");
  });
});

describe("createNativeCompressor — failure paths always clean up", () => {
  it("propagates a subprocess/timeout error and still removes the temp dir", async () => {
    const exec: NativeExec = async () => {
      throw new Error("Command failed: ETIMEDOUT");
    };
    const { fs, calls } = fakeFs(() => VALID_PDF);
    const compressor = createNativeCompressor(cfg(), { exec, fs });
    await expect(
      compressor(new Uint8Array([1, 2, 3]), { engine: "qpdf", options: DEEP }),
    ).rejects.toThrow();
    // Cleanup on failure is the load-bearing guarantee.
    expect(calls.rm).toHaveLength(1);
    // The raw error text is not something the caller relies on; the engine turns
    // any throw into an honest, content-free failure.
  });

  it("throws when the engine produces non-PDF output, and cleans up", async () => {
    const exec: NativeExec = async () => {};
    const { fs, calls } = fakeFs(() => NOT_PDF);
    await expect(
      createNativeCompressor(cfg(), { exec, fs })(new Uint8Array([1]), {
        engine: "qpdf",
        options: DEEP,
      }),
    ).rejects.toThrow(/usable PDF/i);
    expect(calls.rm).toHaveLength(1);
  });

  it("throws when the engine produces empty output", async () => {
    const exec: NativeExec = async () => {};
    const { fs } = fakeFs(() => new Uint8Array(0));
    await expect(
      createNativeCompressor(cfg(), { exec, fs })(new Uint8Array([1]), {
        engine: "qpdf",
        options: DEEP,
      }),
    ).rejects.toThrow();
  });

  it("throws when the output exceeds the configured max output bytes", async () => {
    const exec: NativeExec = async () => {};
    const big = new TextEncoder().encode(
      `%PDF-1.7\n${"x".repeat(4096)}\n%%EOF\n`,
    );
    const { fs } = fakeFs(() => big);
    await expect(
      createNativeCompressor(cfg({ maxOutputBytes: 1024 }), { exec, fs })(
        new Uint8Array([1]),
        {
          engine: "qpdf",
          options: DEEP,
        },
      ),
    ).rejects.toThrow();
  });

  it("rejects an oversized input before spawning or touching the filesystem", async () => {
    let spawned = false;
    const exec: NativeExec = async () => {
      spawned = true;
    };
    const { fs, calls } = fakeFs(() => VALID_PDF);
    await expect(
      createNativeCompressor(cfg({ maxInputBytes: 2 }), { exec, fs })(
        new Uint8Array([1, 2, 3, 4]),
        {
          engine: "qpdf",
          options: DEEP,
        },
      ),
    ).rejects.toThrow(/maximum size/i);
    expect(spawned).toBe(false);
    expect(calls.mkdtemp).toHaveLength(0);
  });
});

describe("probeNativeToolsFromConfig — config-aware detection", () => {
  const seams = (
    onPath: (b: string) => boolean,
    fileExists?: (p: string) => boolean,
  ): NativeSeams => ({
    resolveOnPath: onPath,
    ...(fileExists ? { fileExists } : {}),
  });

  it("reports nothing when the engine is disabled, even if binaries are on PATH", () => {
    const tools = probeNativeToolsFromConfig(
      cfg({ enabled: false }),
      seams(() => true),
    );
    expect(tools).toEqual({ ghostscript: false, qpdf: false, mutool: false });
  });

  it("auto-detects by PATH for non-overridden engines", () => {
    const tools = probeNativeToolsFromConfig(
      cfg(),
      seams((bin) => bin === "qpdf"),
    );
    expect(tools).toEqual({ ghostscript: false, qpdf: true, mutool: false });
  });

  it("considers only the pinned engine", () => {
    const tools = probeNativeToolsFromConfig(
      cfg({ engine: "mutool" }),
      seams(() => true),
    );
    expect(tools).toEqual({ ghostscript: false, qpdf: false, mutool: true });
  });

  it("probes an overridden engine by absolute-path existence, not PATH", () => {
    const config = cfg({
      binaries: { ghostscript: "/opt/gs", qpdf: "qpdf", mutool: "mutool" },
      overridden: { ghostscript: true, qpdf: false, mutool: false },
    });
    const tools = probeNativeToolsFromConfig(
      config,
      seams(
        () => false, // nothing on PATH
        (p) => p === "/opt/gs", // the override exists
      ),
    );
    expect(tools).toEqual({ ghostscript: true, qpdf: false, mutool: false });
  });
});

describe("probeNativeTools / nativeCompressionDeps — from the environment", () => {
  it("returns no engines when native compression is disabled via env", () => {
    const tools = probeNativeTools(
      { PDFXYZ_NATIVE_COMPRESSION: "off" },
      { resolveOnPath: () => true },
    );
    expect(tools).toEqual({ ghostscript: false, qpdf: false, mutool: false });
  });

  it("wires deps with a config-derived input limit and a native runner", () => {
    const deps = nativeCompressionDeps(
      { PDFXYZ_COMPRESSION_MAX_INPUT_BYTES: "1048576" },
      { resolveOnPath: () => false },
    );
    expect(deps.limits?.maxInputBytes).toBe(1048576);
    expect(typeof deps.native).toBe("function");
    expect(deps.tools).toEqual({
      ghostscript: false,
      qpdf: false,
      mutool: false,
    });
  });
});
