import { describe, expect, it } from "vitest";
import {
  parseUnlockPdfOptions,
  type ProtectPdfOptions,
  type UnlockPdfOptions,
} from "@/lib/jobs/pdf-security";
import {
  runProtect,
  runUnlock,
  type PdfSecurityDeps,
  type QpdfRunner,
} from "./engine";

/** Minimal, structurally-valid PDF bytes (passes `looksLikePdf`). */
function pdf(pad = 32): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(pad)}\n%%EOF\n`);
}

const PROTECT: ProtectPdfOptions = {
  password: "open-sesame",
  ownerPassword: "owner-sesame",
  keyLength: 256,
};
const UNLOCK: UnlockPdfOptions = { password: "open-sesame" };

/**
 * A fake qpdf runner whose `isEncrypted` answers by byte identity. Unless a test
 * overrides it, `requiresPassword` agrees with `isEncrypted` the way a file with
 * a real open password does ("encrypted" ⇒ "needs-password"); the
 * restrictions-only case, where the two disagree, is always spelled out.
 */
function fakeQpdf(over: Partial<QpdfRunner> = {}): QpdfRunner {
  const isEncrypted = over.isEncrypted ?? (async () => false);
  return {
    isEncrypted,
    requiresPassword: async (b) =>
      (await isEncrypted(b)) ? "needs-password" : "not-encrypted",
    protect: async () => pdf(64),
    unlock: async () => ({ ok: true, output: pdf(64) }),
    ...over,
  };
}

describe("runProtect", () => {
  it("is unsupported when no qpdf runner is wired", async () => {
    const run = await runProtect(pdf(), PROTECT, {});
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("unsupported");
  });

  it("rejects an oversized input before touching the engine", async () => {
    let called = false;
    const deps: PdfSecurityDeps = {
      qpdf: fakeQpdf({
        isEncrypted: async () => {
          called = true;
          return false;
        },
      }),
      limits: { maxInputBytes: 8 },
    };
    const run = await runProtect(pdf(64), PROTECT, deps);
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("too_large");
    expect(called).toBe(false);
  });

  it("rejects an unreadable PDF", async () => {
    const run = await runProtect(new Uint8Array([1, 2, 3, 4]), PROTECT, {
      qpdf: fakeQpdf(),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("invalid_pdf");
  });

  // INVERTED, not deleted. This was "refuses to re-encrypt an already-encrypted
  // input", driven by `isEncrypted` — which qpdf answers "yes" for ANY
  // encryption, including a file that opens with no password and only restricts
  // printing or copying. Those files were refused as "already
  // password-protected", which the user had just seen to be false. The gate is
  // now the property the message states: a password is needed to OPEN it.
  it("refuses a PDF that already needs a password to open", async () => {
    let protectCalls = 0;
    const run = await runProtect(pdf(), PROTECT, {
      qpdf: fakeQpdf({
        isEncrypted: async () => true,
        requiresPassword: async () => "needs-password",
        protect: async () => {
          protectCalls += 1;
          return pdf(64);
        },
      }),
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("already_encrypted");
    expect(run.message).toMatch(/needs a password to open/);
    expect(protectCalls).toBe(0);
  });

  it("refuses a restrictions-only PDF truthfully — never as 'already password-protected'", async () => {
    let protectCalls = 0;
    const run = await runProtect(pdf(), PROTECT, {
      qpdf: fakeQpdf({
        // qpdf --is-encrypted says yes; --requires-password says it opens freely.
        isEncrypted: async () => true,
        requiresPassword: async () => "opens-freely",
        protect: async () => {
          protectCalls += 1;
          return pdf(64);
        },
      }),
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("restrictions_only");
    expect(run.message).toMatch(/opens without a password/);
    expect(run.message).not.toMatch(/already password-protected/i);
    expect(run.message).not.toMatch(/needs a password to open/);
    // The owner-password rule: its protection is not changed without it.
    expect(protectCalls).toBe(0);
  });

  it("refuses a PDF qpdf cannot open as unreadable (non-retryable) without trying to encrypt it", async () => {
    let protectCalls = 0;
    const run = await runProtect(pdf(), PROTECT, {
      qpdf: fakeQpdf({
        requiresPassword: async () => "unreadable",
        protect: async () => {
          protectCalls += 1;
          return pdf(64);
        },
      }),
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("unreadable");
    expect(protectCalls).toBe(0);
  });

  it("fails when the engine cannot tell whether the input needs a password", async () => {
    const run = await runProtect(pdf(), PROTECT, {
      qpdf: fakeQpdf({
        requiresPassword: async () => {
          throw new Error("qpdf exit 1");
        },
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });

  it("encrypts and returns bytes + content-free meta", async () => {
    const input = pdf();
    const encrypted = pdf(80);
    const run = await runProtect(input, PROTECT, {
      qpdf: fakeQpdf({
        // input not encrypted, produced output IS encrypted.
        isEncrypted: async (b) => b === encrypted,
        protect: async () => encrypted,
      }),
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.output).toBe(encrypted);
    expect(run.meta.engine).toBe("qpdf");
    expect(run.meta.operation).toBe("protect");
    expect(run.meta.keyLength).toBe(256);
    expect(run.meta.inputBytes).toBe(input.byteLength);
    expect(run.meta.outputBytes).toBe(encrypted.byteLength);
  });

  it("fails when the engine throws", async () => {
    const run = await runProtect(pdf(), PROTECT, {
      qpdf: fakeQpdf({
        protect: async () => {
          throw new Error("boom");
        },
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("failed");
      expect(run.message).not.toContain("boom");
    }
  });

  it("fails when the produced output is not a valid PDF", async () => {
    const run = await runProtect(pdf(), PROTECT, {
      qpdf: fakeQpdf({ protect: async () => new Uint8Array([9, 9, 9]) }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });

  it("fails when the output is encrypted but opens without a password", async () => {
    // What the user was promised is "anyone opening the PDF will need this
    // password". `isEncrypted` cannot see the difference between that and a
    // permissions-only file (e.g. a user password that went missing on its way
    // to qpdf), so the output proof asks the promised question instead.
    const input = pdf();
    const output = pdf(80);
    const run = await runProtect(input, PROTECT, {
      qpdf: fakeQpdf({
        isEncrypted: async (b) => b === output,
        requiresPassword: async (b) =>
          b === output ? "opens-freely" : "not-encrypted",
        protect: async () => output,
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });

  it("fails when the produced output is not actually encrypted", async () => {
    // isEncrypted(input)=false and isEncrypted(output)=false → the encryption did
    // not take, so it must fail rather than pass off an unencrypted file.
    const run = await runProtect(pdf(), PROTECT, {
      qpdf: fakeQpdf({
        isEncrypted: async () => false,
        protect: async () => pdf(80),
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });
});

describe("runUnlock", () => {
  it("is unsupported when no qpdf runner is wired", async () => {
    const run = await runUnlock(pdf(), UNLOCK, {});
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("unsupported");
  });

  it("rejects an unreadable PDF", async () => {
    const run = await runUnlock(new Uint8Array([1, 2, 3, 4]), UNLOCK, {
      qpdf: fakeQpdf(),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("invalid_pdf");
  });

  it("reports a non-encrypted input honestly", async () => {
    const run = await runUnlock(pdf(), UNLOCK, {
      qpdf: fakeQpdf({ isEncrypted: async () => false }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("not_encrypted");
  });

  it("reports a wrong password (non-retryable), password-free", async () => {
    const enc = pdf();
    const run = await runUnlock(enc, UNLOCK, {
      qpdf: fakeQpdf({
        isEncrypted: async (b) => b === enc,
        unlock: async () => ({ ok: false, reason: "wrong-password" }),
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("wrong_password");
      expect(run.message).not.toContain(UNLOCK.password);
    }
  });

  // A PDF with only an owner (permissions) password opens for anyone, so the
  // user has no "password that opens it" to type. Until 2026-09 whatever they
  // tried came back as "The password is incorrect" — a dead end with a false
  // diagnosis. The rule stands (the restrictions are removed only with the
  // owner password); the message now names the password that is needed.
  it("tells the owner of a restrictions-only PDF which password it needs — not 'incorrect password'", async () => {
    const run = await runUnlock(pdf(), UNLOCK, {
      qpdf: fakeQpdf({
        isEncrypted: async () => true,
        requiresPassword: async () => "opens-freely",
        unlock: async () => ({ ok: false, reason: "wrong-password" }),
      }),
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("owner_password_required");
    expect(run.message).toMatch(/opens without a password/);
    expect(run.message).toMatch(/owner \(permissions\) password/);
    expect(run.message).not.toMatch(/password is incorrect/i);
    expect(run.message).not.toContain(UNLOCK.password);
  });

  it("unlocks a restrictions-only PDF with its owner password (no refusal before qpdf is asked)", async () => {
    const enc = pdf(48);
    const dec = pdf(96);
    let unlockCalls = 0;
    const run = await runUnlock(enc, UNLOCK, {
      qpdf: fakeQpdf({
        isEncrypted: async (b) => b === enc,
        requiresPassword: async (b) =>
          b === enc ? "opens-freely" : "not-encrypted",
        unlock: async () => {
          unlockCalls += 1;
          return { ok: true, output: dec };
        },
      }),
    });
    expect(unlockCalls).toBe(1);
    expect(run.ok).toBe(true);
  });

  it("reports a PDF qpdf cannot open as unreadable — never 'isn't password-protected'", async () => {
    let unlockCalls = 0;
    const run = await runUnlock(pdf(), UNLOCK, {
      qpdf: fakeQpdf({
        // qpdf --is-encrypted answers 2 for this file too; that is the defect.
        isEncrypted: async () => false,
        requiresPassword: async () => "unreadable",
        unlock: async () => {
          unlockCalls += 1;
          return { ok: true, output: pdf(96) };
        },
      }),
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("unreadable");
    expect(run.message).not.toMatch(/isn't password-protected/);
    expect(unlockCalls).toBe(0);
  });

  it("reports a decrypt qpdf could not open as unreadable — never 'incorrect password'", async () => {
    const enc = pdf();
    const run = await runUnlock(enc, UNLOCK, {
      qpdf: fakeQpdf({
        isEncrypted: async (b) => b === enc,
        unlock: async () => ({ ok: false, reason: "unreadable" }),
      }),
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("unreadable");
    expect(run.message).not.toMatch(/incorrect/i);
  });

  it("fails (never succeeds) when the unlocked output cannot be inspected", async () => {
    const enc = pdf();
    const run = await runUnlock(enc, UNLOCK, {
      qpdf: fakeQpdf({
        isEncrypted: async (b) => {
          if (b === enc) return true;
          throw new Error("qpdf could not open the file.");
        },
        unlock: async () => ({ ok: true, output: pdf(96) }),
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });

  /*
   * INVERTED 2026-09-28 at the merge of wave1/l06-copy-other, history kept.
   * That lane (0cf157b) added "a BLANK password on a file that needs one says a
   * password is needed, not that it was wrong", for a blank-password unlock
   * path. The path lifted a restrictions-only file's locks without its owner
   * password, which the rule this file already pins forbids ("tells the owner
   * of a restrictions-only PDF which password it needs", a50c54c): the parser
   * refuses an empty password, so no job — and no engine run — carries one.
   */
  it("a BLANK password never becomes an unlock job", () => {
    const blank = parseUnlockPdfOptions({ password: "" });
    expect(blank.ok).toBe(false);
    // Control: a typed password parses, so the refusal is about the blank.
    expect(parseUnlockPdfOptions({ password: "p" }).ok).toBe(true);
  });

  it("decrypts and returns bytes + content-free meta", async () => {
    const enc = pdf(48);
    const dec = pdf(96);
    const run = await runUnlock(enc, UNLOCK, {
      qpdf: fakeQpdf({
        // input encrypted, output NOT encrypted.
        isEncrypted: async (b) => b === enc,
        unlock: async () => ({ ok: true, output: dec }),
      }),
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.output).toBe(dec);
    expect(run.meta.operation).toBe("unlock");
    expect(run.meta.keyLength).toBeUndefined();
    expect(run.meta.outputBytes).toBe(dec.byteLength);
  });

  it("fails when the result is still encrypted", async () => {
    const enc = pdf();
    const run = await runUnlock(enc, UNLOCK, {
      qpdf: fakeQpdf({
        // both the input and the "decrypted" output read as encrypted → failure.
        isEncrypted: async () => true,
        unlock: async () => ({ ok: true, output: pdf(96) }),
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });

  it("fails (retryable) when the engine throws unexpectedly", async () => {
    const enc = pdf();
    const run = await runUnlock(enc, UNLOCK, {
      qpdf: fakeQpdf({
        isEncrypted: async (b) => b === enc,
        unlock: async () => {
          throw new Error("kaboom");
        },
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("failed");
      expect(run.message).not.toContain("kaboom");
    }
  });
});
