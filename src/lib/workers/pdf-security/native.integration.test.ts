// @vitest-environment node
//
// A real, end-to-end proof of the qpdf runner against an ACTUAL qpdf binary. It
// round-trips encrypt → is-encrypted → decrypt over a genuine PDF, and proves a
// wrong password is rejected. When qpdf is not installed (e.g. CI without the
// worker image, or this dev sandbox) the whole suite SKIPS honestly rather than
// pretending to have verified anything — the unit tests already cover every branch
// with an injected exec.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { looksLikePdf } from "../compression/engine";
import { QPDF_EXIT_ERROR, QPDF_EXIT_WARNINGS } from "../qpdf-exit";
import { runProtect, runUnlock, type PdfSecurityDeps } from "./engine";
import {
  createNativeQpdfRunner,
  resolveOnPath,
  type QpdfExec,
  type QpdfExecResult,
} from "./native";
import { resolveNativePdfSecurityConfig } from "./native-config";
import { parseUnlockPdfOptions } from "@/lib/jobs/pdf-security";
import { spliceStartxrefPastEnd } from "@/tests/damaged-xref";
import { unsupportedEncryptionPdf } from "@/tests/unsupported-encryption";
import {
  ownerOnlyEncryptedPdf,
  userPasswordEncryptedPdf,
} from "@/tests/encrypted-pdf-fixture";

const HAS_QPDF = resolveOnPath("qpdf");
const suite = HAS_QPDF ? describe : describe.skip;

async function realPdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([320, 240]);
  return doc.save();
}

/**
 * A PDF qpdf must REPAIR before it can do anything with it. The builder is
 * shared with the production proof (`scripts/worker-prove-tools.ts`); its shape
 * is checked without qpdf in `src/tests/damaged-xref.test.ts`, and the positive
 * control below checks that qpdf really answers 3 for it.
 */
async function damagedXrefPdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([320, 240]);
  return spliceStartxrefPastEnd(await doc.save({ useObjectStreams: false }));
}

/** Run the real qpdf binary directly (no runner), resolving with its exit code. */
function qpdfDirect(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    execFile("qpdf", args, (error) => {
      if (!error) return resolve(0);
      resolve(typeof error.code === "number" ? error.code : -1);
    });
  });
}

/** Run `fn` in a fresh scratch dir, and always remove the dir. */
async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "pdfxyz-security-it-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** One recorded qpdf run: its argv (at-file expanded) and how it exited. */
interface RecordedCall {
  argv: string[];
  code: number;
}

/**
 * The real exec, recording every run's argv and exit status, so a test can prove
 * WHICH call took which path — a protect that passed on a clean exit 0 proves
 * nothing about 3, and neither does a 3 from some other call (`--requires-password`
 * answers 3 for an owner-only file). The protect argv travels in an at-file,
 * which the runner deletes afterwards, so it is read here, before qpdf runs.
 */
function recordingExec(): { exec: QpdfExec; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const exec: QpdfExec = (command, args, options) => {
    const argv = args.flatMap((arg) =>
      arg.startsWith("@")
        ? readFileSync(arg.slice(1), "utf8").split("\n")
        : [arg],
    );
    return new Promise<QpdfExecResult>((resolve) => {
      execFile(command, [...args], { ...options }, (error) => {
        const result: QpdfExecResult = !error
          ? { code: 0, timedOut: false }
          : {
              code: typeof error.code === "number" ? error.code : -1,
              timedOut: error.killed === true,
            };
        calls.push({ argv, code: result.code });
        resolve(result);
      });
    });
  };
  return { exec, calls };
}

suite("qpdf runner (real binary)", () => {
  const runner = createNativeQpdfRunner(resolveNativePdfSecurityConfig({}));
  // A deliberately awkward password: spaces and an `=` would break a naive argv
  // transport, so a clean round-trip proves the at-file transport is faithful.
  const password = "my secret = pw-2024";

  it("encrypts a plain PDF, reports it encrypted, then decrypts it back", async () => {
    const plain = await realPdf(2);
    expect(await runner.isEncrypted(plain)).toBe(false);

    const encrypted = await runner.protect(plain, {
      userPassword: password,
      ownerPassword: password,
      keyLength: 256,
    });
    expect(looksLikePdf(encrypted)).toBe(true);
    expect(await runner.isEncrypted(encrypted)).toBe(true);

    const unlocked = await runner.unlock(encrypted, { password });
    expect(unlocked.ok).toBe(true);
    if (!unlocked.ok) return;
    expect(await runner.isEncrypted(unlocked.output)).toBe(false);

    // The decrypted result is a genuine, reloadable PDF with the pages intact.
    const reloaded = await PDFDocument.load(unlocked.output);
    expect(reloaded.getPageCount()).toBe(2);
  });

  it("rejects a wrong password without leaking it", async () => {
    const encrypted = await runner.protect(await realPdf(1), {
      userPassword: password,
      ownerPassword: password,
      keyLength: 256,
    });
    const attempt = await runner.unlock(encrypted, {
      password: "not-the-password",
    });
    // Established positively: qpdf's own password check said this password
    // does not open the file — not merely "the decrypt exited 2".
    expect(attempt).toEqual({ ok: false, reason: "wrong-password" });
  });

  /*
   * AMENDED 2026-09-28 at the merge of wave1/l06-copy-other, history kept. That
   * lane (0cf157b) wrote this as the proof of a blank-password Unlock path:
   * qpdf, given an empty password, opens an owner-only file with the empty
   * user password and `--decrypt` removes its locks. That is still what the
   * binary does — and it is exactly why the product never asks it to: Unlock
   * removes restrictions only with the owner password that set them (a50c54c),
   * so parseUnlockPdfOptions refuses "" before any job exists. The fact about
   * the binary stays here, beside the gate that keeps it unreachable.
   */
  it("qpdf WOULD lift an owner-only file's locks with a blank password — so the parser refuses one", async () => {
    const restricted = ownerOnlyEncryptedPdf();
    expect(await runner.isEncrypted(restricted)).toBe(true);
    const unlocked = await runner.unlock(restricted, { password: "" });
    expect(unlocked.ok).toBe(true);
    expect(parseUnlockPdfOptions({ password: "" }).ok).toBe(false);
  });

  it("control: a BLANK password does not open a PDF that needs a password", async () => {
    const attempt = await runner.unlock(userPasswordEncryptedPdf(), {
      password: "",
    });
    // The runner's outcome shape since a50c54c: the refusal says why. (L06
    // wrote `{ wrongPassword: true }`, the shape it was branched from.)
    expect(attempt).toEqual({ ok: false, reason: "wrong-password" });
  });

  it("supports the AES-128 compatibility level", async () => {
    const encrypted = await runner.protect(await realPdf(1), {
      userPassword: password,
      ownerPassword: password,
      keyLength: 128,
    });
    expect(await runner.isEncrypted(encrypted)).toBe(true);
    const unlocked = await runner.unlock(encrypted, { password });
    expect(unlocked.ok).toBe(true);
  });
});

suite("qpdf runner (real binary) — damaged input (exit 3)", () => {
  const config = resolveNativePdfSecurityConfig({});
  const password = "damaged = still protectable";

  it("positive control: the fixture really makes qpdf repair it (exit 3)", async () => {
    const damaged = await damagedXrefPdf();
    // Health check: the engine's preflight admits it, so the tests below reach qpdf.
    expect(looksLikePdf(damaged)).toBe(true);
    const code = await withScratch(async (dir) => {
      const input = path.join(dir, "in.pdf");
      await writeFile(input, damaged);
      return qpdfDirect([input, path.join(dir, "out.pdf")]);
    });
    expect(code).toBe(QPDF_EXIT_WARNINGS);
  });

  it("protects a damaged PDF through the engine, and the result needs the password", async () => {
    const { exec, calls } = recordingExec();
    const qpdf = createNativeQpdfRunner(config, { exec });
    const deps: PdfSecurityDeps = { qpdf };
    const run = await runProtect(
      await damagedXrefPdf(),
      { password, ownerPassword: password, keyLength: 256 },
      deps,
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    // The exit-3 path, not a clean 0, is what this test is about — and it must
    // be the ENCRYPT call that took it, not another run that happened to say 3.
    const encrypts = calls.filter((c) => c.argv.includes("--encrypt"));
    expect(encrypts.map((c) => c.code)).toEqual([QPDF_EXIT_WARNINGS]);
    expect(await qpdf.requiresPassword(run.output)).toBe("needs-password");

    const unlocked = await runUnlock(run.output, { password }, deps);
    expect(unlocked.ok).toBe(true);
    if (!unlocked.ok) return;
    const reloaded = await PDFDocument.load(unlocked.output);
    expect(reloaded.getPageCount()).toBe(2);
  });
});

suite("qpdf runner (real binary) — restrictions-only input", () => {
  const config = resolveNativePdfSecurityConfig({});
  const runner = createNativeQpdfRunner(config);

  /** Empty user password, real owner password: opens freely, permissions locked. */
  async function restrictionsOnlyPdf(): Promise<Uint8Array> {
    return withScratch(async (dir) => {
      const input = path.join(dir, "in.pdf");
      const output = path.join(dir, "out.pdf");
      await writeFile(input, await realPdf(1));
      const code = await qpdfDirect([
        "--encrypt",
        "",
        "owner-only-secret",
        "256",
        "--print=none",
        "--",
        input,
        output,
      ]);
      expect(code).toBe(0);
      return new Uint8Array(await readFile(output));
    });
  }

  it("tells the three answers apart (positive control for requiresPassword)", async () => {
    const plain = await realPdf(1);
    const restricted = await restrictionsOnlyPdf();
    const locked = await runner.protect(plain, {
      userPassword: "open-me",
      ownerPassword: "open-me",
      keyLength: 256,
    });
    // `isEncrypted` cannot separate the two encrypted files …
    expect(await runner.isEncrypted(restricted)).toBe(true);
    expect(await runner.isEncrypted(locked)).toBe(true);
    // … `requiresPassword` can, and that is the question Protect's refusal states.
    expect(await runner.requiresPassword(plain)).toBe("not-encrypted");
    expect(await runner.requiresPassword(restricted)).toBe("opens-freely");
    expect(await runner.requiresPassword(locked)).toBe("needs-password");
  });

  it("unlocks it with the owner password, and the output carries no encryption", async () => {
    const run = await runUnlock(
      await restrictionsOnlyPdf(),
      { password: "owner-only-secret" },
      { qpdf: runner },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(await runner.isEncrypted(run.output)).toBe(false);
    expect(await runner.requiresPassword(run.output)).toBe("not-encrypted");
  });

  it("tells a wrong password on it to use the owner password — not 'The password is incorrect'", async () => {
    // Positive control: the raw decrypt with this password exits 2, which is
    // exactly what used to be reported as a wrong OPEN password.
    const restricted = await restrictionsOnlyPdf();
    const code = await withScratch(async (dir) => {
      const input = path.join(dir, "in.pdf");
      await writeFile(input, restricted);
      return qpdfDirect([
        "--password=not-it",
        "--decrypt",
        input,
        path.join(dir, "out.pdf"),
      ]);
    });
    expect(code).toBe(QPDF_EXIT_ERROR);

    const run = await runUnlock(
      restricted,
      { password: "not-it" },
      {
        qpdf: runner,
      },
    );
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("owner_password_required");
  });

  it("refuses it as restrictions_only — never as 'already password-protected'", async () => {
    const run = await runProtect(
      await restrictionsOnlyPdf(),
      { password: "new", ownerPassword: "new", keyLength: 256 },
      { qpdf: runner },
    );
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("restrictions_only");
  });
});

suite("qpdf runner (real binary) — files qpdf cannot open", () => {
  const runner = createNativeQpdfRunner(resolveNativePdfSecurityConfig({}));

  it("positive control: qpdf answers 2 to both the encryption check and the open check", async () => {
    const bytes = await unsupportedEncryptionPdf();
    // Health check: the engine's preflight admits it, so the tests below reach qpdf.
    expect(looksLikePdf(bytes)).toBe(true);
    const [isEncrypted, opens] = await withScratch(async (dir) => {
      const input = path.join(dir, "in.pdf");
      await writeFile(input, bytes);
      return [
        await qpdfDirect(["--is-encrypted", input]),
        await qpdfDirect(["--show-npages", input]),
      ];
    });
    expect(isEncrypted).toBe(QPDF_EXIT_ERROR);
    expect(opens).toBe(QPDF_EXIT_ERROR);
  });

  it("is unreadable to every question — never 'not encrypted'", async () => {
    const bytes = await unsupportedEncryptionPdf();
    expect(await runner.requiresPassword(bytes)).toBe("unreadable");
    await expect(runner.isEncrypted(bytes)).rejects.toThrow();
    const unlock = await runUnlock(
      bytes,
      { password: "anything" },
      {
        qpdf: runner,
      },
    );
    expect(unlock.ok).toBe(false);
    if (!unlock.ok) expect(unlock.kind).toBe("unreadable");
    const protect = await runProtect(
      bytes,
      { password: "p", ownerPassword: "p", keyLength: 256 },
      { qpdf: runner },
    );
    expect(protect.ok).toBe(false);
    if (!protect.ok) expect(protect.kind).toBe("unreadable");
  });

  it("a damaged ENCRYPTED file is decrypted with the right password (exit 3), not called a wrong one", async () => {
    const password = "right password";
    const damaged = await withScratch(async (dir) => {
      const input = path.join(dir, "in.pdf");
      const output = path.join(dir, "out.pdf");
      await writeFile(input, await realPdf(2));
      // A classic xref table, so the startxref lie can be spliced in.
      const code = await qpdfDirect([
        "--object-streams=disable",
        "--encrypt",
        password,
        password,
        "256",
        "--",
        input,
        output,
      ]);
      expect(code).toBe(0);
      return spliceStartxrefPastEnd(new Uint8Array(await readFile(output)));
    });
    const { exec, calls } = recordingExec();
    const run = await runUnlock(
      damaged,
      { password },
      {
        qpdf: createNativeQpdfRunner(resolveNativePdfSecurityConfig({}), {
          exec,
        }),
      },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    // The decrypt itself took the repair path.
    const decrypts = calls.filter((c) => c.argv.includes("--decrypt"));
    expect(decrypts.map((c) => c.code)).toEqual([QPDF_EXIT_WARNINGS]);
    expect((await PDFDocument.load(run.output)).getPageCount()).toBe(2);
  });
});
