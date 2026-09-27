// @vitest-environment node
//
// A real, end-to-end proof of the qpdf runner against an ACTUAL qpdf binary. It
// round-trips encrypt → is-encrypted → decrypt over a genuine PDF, and proves a
// wrong password is rejected. When qpdf is not installed (e.g. CI without the
// worker image, or this dev sandbox) the whole suite SKIPS honestly rather than
// pretending to have verified anything — the unit tests already cover every branch
// with an injected exec.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { looksLikePdf } from "../compression/engine";
import { QPDF_EXIT_WARNINGS } from "../qpdf-exit";
import { runProtect, runUnlock, type PdfSecurityDeps } from "./engine";
import {
  createNativeQpdfRunner,
  resolveOnPath,
  type QpdfExec,
  type QpdfExecResult,
} from "./native";
import { resolveNativePdfSecurityConfig } from "./native-config";

const HAS_QPDF = resolveOnPath("qpdf");
const suite = HAS_QPDF ? describe : describe.skip;

async function realPdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([320, 240]);
  return doc.save();
}

/**
 * A PDF qpdf must REPAIR before it can do anything with it: a classic xref table
 * and trailer (`useObjectStreams: false` — pdf-lib's default xref stream leaves
 * qpdf no trailer to reconstruct from, so it refuses outright), with the
 * `startxref` offset replaced by a lie past the end of the file.
 *
 * The digits are SPLICED, not overwritten in place. A small document's offset
 * has three or four digits, so writing seven over it eats the `%%EOF` that
 * follows — and the engine's preflight (`looksLikePdf`) then refuses the file
 * as `invalid_pdf` before qpdf ever runs: a failure for the wrong reason.
 * Truncating the file has the same problem. The positive control below checks
 * the fixture against the preflight rather than trusting this comment.
 */
async function damagedXrefPdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([320, 240]);
  const whole = Buffer.from(await doc.save({ useObjectStreams: false }));
  const at = whole.lastIndexOf("startxref");
  const offset = /^startxref\s+(\d+)/.exec(
    whole.subarray(at).toString("latin1"),
  );
  if (at < 0 || !offset) throw new Error("fixture has no startxref offset");
  const digitsAt = at + offset[0].length - offset[1]!.length;
  return new Uint8Array(
    Buffer.concat([
      whole.subarray(0, digitsAt),
      Buffer.from(String(whole.length * 10), "latin1"),
      whole.subarray(digitsAt + offset[1]!.length),
    ]),
  );
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

/**
 * The real exec, recording every exit status, so a test can prove WHICH path it
 * exercised — a protect that passed on a clean exit 0 proves nothing about 3.
 */
function recordingExec(): { exec: QpdfExec; codes: number[] } {
  const codes: number[] = [];
  const exec: QpdfExec = (command, args, options) =>
    new Promise<QpdfExecResult>((resolve) => {
      execFile(command, [...args], { ...options }, (error) => {
        const result: QpdfExecResult = !error
          ? { code: 0, timedOut: false }
          : {
              code: typeof error.code === "number" ? error.code : -1,
              timedOut: error.killed === true,
            };
        codes.push(result.code);
        resolve(result);
      });
    });
  return { exec, codes };
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
    expect(attempt).toEqual({ ok: false, wrongPassword: true });
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
    const { exec, codes } = recordingExec();
    const qpdf = createNativeQpdfRunner(config, { exec });
    const deps: PdfSecurityDeps = { qpdf };
    const run = await runProtect(
      await damagedXrefPdf(),
      { password, ownerPassword: password, keyLength: 256 },
      deps,
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    // The exit-3 path, not a clean 0, is what this test is about.
    expect(codes).toContain(QPDF_EXIT_WARNINGS);
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
