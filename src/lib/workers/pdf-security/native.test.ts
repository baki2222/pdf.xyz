// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createNativeQpdfRunner,
  isEncryptedArgs,
  nativePdfSecurityDeps,
  probeQpdfFromConfig,
  protectArgs,
  requiresPasswordArgs,
  unlockArgs,
  type QpdfExec,
  type QpdfExecResult,
  type QpdfFs,
} from "./native";
import type { NativePdfSecurityConfig } from "./native-config";
import { QPDF_EXIT_ERROR, QPDF_EXIT_WARNINGS } from "../qpdf-exit";

/** Minimal, structurally-valid PDF bytes (passes `looksLikePdf`). */
function pdf(pad = 40): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(pad)}\n%%EOF\n`);
}

function config(
  over: Partial<NativePdfSecurityConfig> = {},
): NativePdfSecurityConfig {
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

/** A fake fs that records every write and rm, and returns fixed output bytes. */
function fakeFs(output: Uint8Array) {
  const writes = new Map<string, Uint8Array>();
  let rmCount = 0;
  const fs: QpdfFs = {
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

/** A fake exec that records each invocation and returns a fixed result. */
function fakeExec(result: QpdfExecResult) {
  const calls: { command: string; args: string[] }[] = [];
  const exec: QpdfExec = async (command, args) => {
    calls.push({ command, args: [...args] });
    return result;
  };
  return { exec, calls };
}

const OK: QpdfExecResult = { code: 0, timedOut: false };

describe("argument builders", () => {
  it("builds the AES-256 encrypt vector with qpdf positional password operands", () => {
    expect(
      protectArgs("/tmp/in.pdf", "/tmp/out.pdf", {
        userPassword: "u",
        ownerPassword: "o",
        keyLength: 256,
      }),
    ).toEqual([
      "--encrypt",
      "u",
      "o",
      "256",
      "--",
      "/tmp/in.pdf",
      "/tmp/out.pdf",
    ]);
  });

  it("forces AES for the 128-bit level (never RC4)", () => {
    const args = protectArgs("/in", "/out", {
      userPassword: "u",
      ownerPassword: "o",
      keyLength: 128,
    });
    expect(args).toContain("128");
    expect(args).toContain("--use-aes=y");
  });

  it("builds the decrypt and is-encrypted vectors", () => {
    expect(unlockArgs("/in", "/out", { password: "p" })).toEqual([
      "--password=p",
      "--decrypt",
      "/in",
      "/out",
    ]);
    expect(isEncryptedArgs("/in")).toEqual(["--is-encrypted", "/in"]);
  });
});

describe("createNativeQpdfRunner — protect", () => {
  it("passes the password via an at-file, NEVER on the command line, and cleans up", async () => {
    const { fs, writes, rmCount } = fakeFs(pdf(64));
    const { exec, calls } = fakeExec(OK);
    const runner = createNativeQpdfRunner(config(), { exec, fs });

    const out = await runner.protect(pdf(), {
      userPassword: "S3CRET-USER",
      ownerPassword: "S3CRET-OWNER",
      keyLength: 256,
    });
    expect(out).toEqual(pdf(64));

    // qpdf is invoked as `qpdf @<argfile>` — a single argv token, no password.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("qpdf");
    expect(calls[0]!.args).toHaveLength(1);
    expect(calls[0]!.args[0]).toMatch(/^@.*qpdf\.args$/);
    expect(JSON.stringify(calls[0]!.args)).not.toContain("S3CRET");

    // The password only ever lives in the at-file, which is in the wiped temp dir.
    const argfile = [...writes.entries()].find(([p]) =>
      p.endsWith("qpdf.args"),
    );
    expect(argfile).toBeTruthy();
    const content = new TextDecoder().decode(argfile![1]);
    const tokens = content.split("\n");
    expect(tokens).toContain("--encrypt");
    expect(tokens).toContain("S3CRET-USER");
    expect(tokens).toContain("S3CRET-OWNER");
    expect(tokens).toContain("256");

    expect(rmCount()).toBe(1);
  });

  // INVERTED, not deleted. Until 2026-09 this test was "throws and still
  // cleans up when qpdf exits non-zero" and it fed the runner exit 3 — so it
  // pinned the defect: exit 3 is qpdf's "warnings issued, output was created",
  // the status every damaged-but-recoverable input returns, and Protect threw
  // away a correctly encrypted file on exactly those inputs. The repair runner
  // had already learned this; the constant now lives in `../qpdf-exit`.
  it("accepts exit 3 (warnings, output written) and returns the output", async () => {
    const { fs, rmCount } = fakeFs(pdf(64));
    const { exec } = fakeExec({ code: QPDF_EXIT_WARNINGS, timedOut: false });
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    const out = await runner.protect(pdf(), {
      userPassword: "u",
      ownerPassword: "o",
      keyLength: 256,
    });
    expect(out).toEqual(pdf(64));
    expect(rmCount()).toBe(1);
  });

  it.each([1, QPDF_EXIT_ERROR, 4, -1])(
    "throws and still cleans up when qpdf exits %i (no output promised)",
    async (code) => {
      // The output file is readable and valid on purpose: the exit status alone
      // must decide, or a stale file from a failed run could pass as success.
      const { fs, rmCount } = fakeFs(pdf(64));
      const { exec } = fakeExec({ code, timedOut: false });
      const runner = createNativeQpdfRunner(config(), { exec, fs });
      await expect(
        runner.protect(pdf(), {
          userPassword: "u",
          ownerPassword: "o",
          keyLength: 256,
        }),
      ).rejects.toThrow();
      expect(rmCount()).toBe(1);
    },
  );

  it("still throws on exit 3 when the output is empty or not a PDF", async () => {
    for (const output of [new Uint8Array(0), new Uint8Array([1, 2, 3])]) {
      const { fs, rmCount } = fakeFs(output);
      const { exec } = fakeExec({ code: QPDF_EXIT_WARNINGS, timedOut: false });
      const runner = createNativeQpdfRunner(config(), { exec, fs });
      await expect(
        runner.protect(pdf(), {
          userPassword: "u",
          ownerPassword: "o",
          keyLength: 256,
        }),
      ).rejects.toThrow();
      expect(rmCount()).toBe(1);
    }
  });

  it("throws on a timeout", async () => {
    const { fs } = fakeFs(pdf());
    const { exec } = fakeExec({ code: -1, timedOut: true });
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    await expect(
      runner.protect(pdf(), {
        userPassword: "u",
        ownerPassword: "o",
        keyLength: 256,
      }),
    ).rejects.toThrow();
  });

  it("throws when the produced output is not a usable PDF", async () => {
    const { fs } = fakeFs(new Uint8Array([1, 2, 3]));
    const { exec } = fakeExec(OK);
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    await expect(
      runner.protect(pdf(), {
        userPassword: "u",
        ownerPassword: "o",
        keyLength: 256,
      }),
    ).rejects.toThrow();
  });

  it("rejects an oversized input before spawning anything", async () => {
    const { fs, rmCount } = fakeFs(pdf());
    const { exec, calls } = fakeExec(OK);
    const runner = createNativeQpdfRunner(config({ maxInputBytes: 4 }), {
      exec,
      fs,
    });
    await expect(
      runner.protect(pdf(64), {
        userPassword: "u",
        ownerPassword: "o",
        keyLength: 256,
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
    expect(rmCount()).toBe(0);
  });
});

describe("createNativeQpdfRunner — isEncrypted", () => {
  it("maps exit 0 → encrypted and passes no password (direct argv)", async () => {
    const { fs } = fakeFs(pdf());
    const { exec, calls } = fakeExec(OK);
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    expect(await runner.isEncrypted(pdf())).toBe(true);
    expect(calls[0]!.args[0]).toBe("--is-encrypted");
    expect(calls[0]!.args[1]).toMatch(/input\.pdf$/);
  });

  it("maps exit 2 → not encrypted", async () => {
    const { fs } = fakeFs(pdf());
    const { exec } = fakeExec({ code: 2, timedOut: false });
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    expect(await runner.isEncrypted(pdf())).toBe(false);
  });

  it("throws on any other exit status", async () => {
    const { fs } = fakeFs(pdf());
    const { exec } = fakeExec({ code: 1, timedOut: false });
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    await expect(runner.isEncrypted(pdf())).rejects.toThrow();
  });
});

describe("createNativeQpdfRunner — unlock", () => {
  it("returns output on success, with the password only in the at-file", async () => {
    const { fs, writes } = fakeFs(pdf(64));
    const { exec, calls } = fakeExec(OK);
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    const res = await runner.unlock(pdf(), { password: "P4SS-SENTINEL" });
    expect(res).toEqual({ ok: true, output: pdf(64) });
    expect(JSON.stringify(calls[0]!.args)).not.toContain("P4SS");
    const argfile = [...writes.entries()].find(([p]) =>
      p.endsWith("qpdf.args"),
    );
    expect(new TextDecoder().decode(argfile![1])).toContain(
      "--password=P4SS-SENTINEL",
    );
  });

  it("maps exit 2 → wrong password (not a throw)", async () => {
    const { fs } = fakeFs(pdf());
    const { exec } = fakeExec({ code: 2, timedOut: false });
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    expect(await runner.unlock(pdf(), { password: "x" })).toEqual({
      ok: false,
      wrongPassword: true,
    });
  });

  it("throws on any other non-zero exit", async () => {
    const { fs } = fakeFs(pdf());
    const { exec } = fakeExec({ code: 1, timedOut: false });
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    await expect(runner.unlock(pdf(), { password: "x" })).rejects.toThrow();
  });

  it("accepts exit 3 (a damaged file decrypted with warnings) and returns the output", async () => {
    const { fs } = fakeFs(pdf(64));
    const { exec } = fakeExec({ code: QPDF_EXIT_WARNINGS, timedOut: false });
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    expect(await runner.unlock(pdf(), { password: "x" })).toEqual({
      ok: true,
      output: pdf(64),
    });
  });

  it("still throws on exit 3 when the output is not a PDF", async () => {
    const { fs } = fakeFs(new Uint8Array([1, 2, 3]));
    const { exec } = fakeExec({ code: QPDF_EXIT_WARNINGS, timedOut: false });
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    await expect(runner.unlock(pdf(), { password: "x" })).rejects.toThrow();
  });
});

describe("createNativeQpdfRunner — requiresPassword", () => {
  it("asks qpdf --requires-password with a direct argv (no password, no at-file)", async () => {
    const { fs, writes } = fakeFs(pdf());
    const { exec, calls } = fakeExec(OK);
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    await runner.requiresPassword(pdf());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0]).toBe("--requires-password");
    expect(calls[0]!.args[1]).toMatch(/input\.pdf$/);
    expect([...writes.keys()].some((p) => p.endsWith("qpdf.args"))).toBe(false);
    expect(requiresPasswordArgs("/in")).toEqual(["--requires-password", "/in"]);
  });

  // qpdf's documented answers: 0 = a password is needed to open it, 2 = not
  // encrypted, 3 = encrypted but it opens with the empty user password (only
  // its permissions are restricted). `--is-encrypted` answers 0 for BOTH of
  // the encrypted cases, which is how a print-restricted bank statement was
  // refused as "already password-protected".
  it.each([
    [0, "needs-password"],
    [QPDF_EXIT_ERROR, "not-encrypted"],
    [QPDF_EXIT_WARNINGS, "opens-freely"],
  ] as const)("maps exit %i → %s", async (code, expected) => {
    const { fs } = fakeFs(pdf());
    const { exec } = fakeExec({ code, timedOut: false });
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    expect(await runner.requiresPassword(pdf())).toBe(expected);
  });

  it.each([
    [{ code: 1, timedOut: false }],
    [{ code: 4, timedOut: false }],
    [{ code: -1, timedOut: false }],
    [{ code: -1, timedOut: true }],
  ])("throws on %o", async (result) => {
    const { fs, rmCount } = fakeFs(pdf());
    const { exec } = fakeExec(result);
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    await expect(runner.requiresPassword(pdf())).rejects.toThrow();
    expect(rmCount()).toBe(1);
  });
});

describe("probeQpdfFromConfig", () => {
  it("is false when disabled (the kill switch)", () => {
    expect(
      probeQpdfFromConfig(config({ enabled: false }), {
        resolveOnPath: () => true,
      }),
    ).toBe(false);
  });

  it("probes PATH for the default command", () => {
    expect(probeQpdfFromConfig(config(), { resolveOnPath: () => true })).toBe(
      true,
    );
    expect(probeQpdfFromConfig(config(), { resolveOnPath: () => false })).toBe(
      false,
    );
  });

  it("probes existence for an absolute-path override", () => {
    expect(
      probeQpdfFromConfig(config({ overridden: true, binary: "/opt/qpdf" }), {
        fileExists: (p) => p === "/opt/qpdf",
        resolveOnPath: () => false,
      }),
    ).toBe(true);
  });
});

describe("nativePdfSecurityDeps", () => {
  it("wires the qpdf runner only when qpdf is available", () => {
    const present = nativePdfSecurityDeps({}, { resolveOnPath: () => true });
    expect(present.qpdf).toBeDefined();
    expect(present.limits?.maxInputBytes).toBeGreaterThan(0);

    const absent = nativePdfSecurityDeps({}, { resolveOnPath: () => false });
    expect(absent.qpdf).toBeUndefined();
    expect(absent.limits?.maxInputBytes).toBeGreaterThan(0);
  });

  it("leaves qpdf off when the kill switch disables it", () => {
    const deps = nativePdfSecurityDeps(
      { PDFXYZ_PDF_SECURITY: "off" },
      { resolveOnPath: () => true },
    );
    expect(deps.qpdf).toBeUndefined();
  });
});
