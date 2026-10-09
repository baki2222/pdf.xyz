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

/**
 * A fake exec that answers each successive call with the next result, and
 * records each call's argv together with the at-file's content AT THAT MOMENT
 * (a follow-up call rewrites the at-file, so reading `writes` afterwards shows
 * only the last one).
 */
function seqExec(
  results: readonly QpdfExecResult[],
  writes: Map<string, Uint8Array>,
) {
  const calls: { args: string[]; argfile: string[] | null }[] = [];
  const exec: QpdfExec = async (_command, args) => {
    const at = args[0]?.startsWith("@") ? args[0].slice(1) : null;
    const content = at === null ? undefined : writes.get(at);
    calls.push({
      args: [...args],
      argfile:
        content === undefined
          ? null
          : new TextDecoder().decode(content).split("\n"),
    });
    const result = results[calls.length - 1];
    if (!result) throw new Error(`unexpected qpdf call #${calls.length}`);
    return result;
  };
  return { exec, calls };
}

const OK: QpdfExecResult = { code: 0, timedOut: false };
const EXIT = (code: number): QpdfExecResult => ({ code, timedOut: false });
const TIMEOUT: QpdfExecResult = { code: -1, timedOut: true };

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

  /**
   * INVERTED at the merge of wave1/l06-copy-other (2026-09-28), history kept.
   * That lane made a blank password emit no `--password`, so qpdf opened an
   * owner-only file with the empty user password and `--decrypt` lifted its
   * printing/copying/editing locks without the owner password. The integrated
   * product keeps L02's rule (a50c54c): restrictions go only with the owner
   * password that set them. The parser refuses a blank password before any job
   * exists; here, no password shape reaches qpdf as a bare `--decrypt`.
   */
  it("every decrypt passes --password, even an empty one — never a bare --decrypt", () => {
    expect(unlockArgs("/in", "/out", { password: "" })).toEqual([
      "--password=",
      "--decrypt",
      "/in",
      "/out",
    ]);
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

  // INVERTED, not deleted. Until 2026-09 this was "maps exit 2 → not
  // encrypted", on the exit status alone. qpdf's 2 is ALSO "could not open the
  // file at all" — a broken file, or an encryption scheme qpdf does not support —
  // so such a file was told "This PDF isn't password-protected, so there's
  // nothing to unlock", and a decrypt output qpdf could not read passed the
  // engine's "no longer encrypted" proof. Exit 2 now gets a second question:
  // does the file open, with no password, at all?
  it.each([0, QPDF_EXIT_WARNINGS])(
    "maps exit 2 → not encrypted only when the file then opens (open-check exit %i)",
    async (openCheck) => {
      const { fs, writes, rmCount } = fakeFs(pdf());
      const { exec, calls } = seqExec(
        [EXIT(QPDF_EXIT_ERROR), EXIT(openCheck)],
        writes,
      );
      const runner = createNativeQpdfRunner(config(), { exec, fs });
      expect(await runner.isEncrypted(pdf())).toBe(false);
      expect(calls).toHaveLength(2);
      expect(calls[1]!.args[0]).toBe("--show-npages");
      expect(calls[1]!.args[1]).toMatch(/input\.pdf$/);
      expect(calls[1]!.argfile).toBeNull();
      expect(rmCount()).toBe(1);
    },
  );

  it("throws on exit 2 when the file does not open either (never 'not encrypted')", async () => {
    const { fs, writes, rmCount } = fakeFs(pdf());
    const { exec } = seqExec(
      [EXIT(QPDF_EXIT_ERROR), EXIT(QPDF_EXIT_ERROR)],
      writes,
    );
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    await expect(runner.isEncrypted(pdf())).rejects.toThrow();
    expect(rmCount()).toBe(1);
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

  // INVERTED, not deleted. Until 2026-09 this was "maps exit 2 → wrong
  // password (not a throw)". qpdf has no exit status for a wrong password: 2 is
  // its status for ANY error. So a damaged encrypted PDF, or one whose
  // encryption qpdf cannot open, was reported as "The password is incorrect"
  // — the user retyped a correct password and re-uploaded, and could never
  // succeed. A wrong password is now established POSITIVELY: the same password
  // is put to `--requires-password`, which answers 0 only when a password is
  // needed and the one supplied does not open the file.
  it("exit 2 is a wrong password only when qpdf then says that password does not open it", async () => {
    const { fs, writes, rmCount } = fakeFs(pdf());
    const { exec, calls } = seqExec([EXIT(QPDF_EXIT_ERROR), OK], writes);
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    expect(await runner.unlock(pdf(), { password: "P4SS-SENTINEL" })).toEqual({
      ok: false,
      reason: "wrong-password",
    });
    expect(calls).toHaveLength(2);
    // The check carries the password too, so it goes through the at-file.
    expect(calls[1]!.args).toHaveLength(1);
    expect(JSON.stringify(calls[1]!.args)).not.toContain("P4SS");
    expect(calls[1]!.argfile).toEqual([
      "--password=P4SS-SENTINEL",
      "--requires-password",
      expect.stringMatching(/input\.pdf$/),
    ]);
    // It asks, it does not write: no --decrypt, no output path.
    expect(calls[1]!.argfile!.join("\n")).not.toMatch(/--decrypt|output\.pdf/);
    expect(rmCount()).toBe(1);
  });

  it("exit 2 whose password check says the file cannot be opened at all → unreadable, not a wrong password", async () => {
    const { fs, writes } = fakeFs(pdf());
    const { exec } = seqExec(
      [EXIT(QPDF_EXIT_ERROR), EXIT(QPDF_EXIT_ERROR)],
      writes,
    );
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    expect(await runner.unlock(pdf(), { password: "x" })).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it.each([
    [
      "the password opens it (3), yet the decrypt failed",
      EXIT(QPDF_EXIT_WARNINGS),
    ],
    ["an unexpected status", EXIT(1)],
    ["a timeout", TIMEOUT],
  ])(
    "exit 2 followed by %s throws (an engine failure, never a user error)",
    async (_label, check) => {
      const { fs, writes, rmCount } = fakeFs(pdf());
      const { exec } = seqExec([EXIT(QPDF_EXIT_ERROR), check], writes);
      const runner = createNativeQpdfRunner(config(), { exec, fs });
      await expect(runner.unlock(pdf(), { password: "x" })).rejects.toThrow();
      expect(rmCount()).toBe(1);
    },
  );

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
    [QPDF_EXIT_WARNINGS, "opens-freely"],
  ] as const)("maps exit %i → %s", async (code, expected) => {
    const { fs } = fakeFs(pdf());
    const { exec } = fakeExec({ code, timedOut: false });
    const runner = createNativeQpdfRunner(config(), { exec, fs });
    expect(await runner.requiresPassword(pdf())).toBe(expected);
  });

  // Exit 2 is "not encrypted" OR "could not open the file". Until 2026-09 it
  // was mapped to "not-encrypted" alone, so Unlock told the owner of a damaged
  // or unsupported-encryption PDF that it "isn't password-protected".
  it.each([
    [0, "not-encrypted"],
    [QPDF_EXIT_WARNINGS, "not-encrypted"],
    [QPDF_EXIT_ERROR, "unreadable"],
  ] as const)(
    "maps exit 2 by whether the file then opens (open-check exit %i → %s)",
    async (openCheck, expected) => {
      const { fs, writes } = fakeFs(pdf());
      const { exec, calls } = seqExec(
        [EXIT(QPDF_EXIT_ERROR), EXIT(openCheck)],
        writes,
      );
      const runner = createNativeQpdfRunner(config(), { exec, fs });
      expect(await runner.requiresPassword(pdf())).toBe(expected);
      expect(calls[1]!.args[0]).toBe("--show-npages");
      expect(calls[1]!.argfile).toBeNull();
    },
  );

  it.each([[EXIT(1)], [TIMEOUT]])(
    "throws when the open check after exit 2 answers %o",
    async (openCheck) => {
      const { fs, writes, rmCount } = fakeFs(pdf());
      const { exec } = seqExec([EXIT(QPDF_EXIT_ERROR), openCheck], writes);
      const runner = createNativeQpdfRunner(config(), { exec, fs });
      await expect(runner.requiresPassword(pdf())).rejects.toThrow();
      expect(rmCount()).toBe(1);
    },
  );

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
