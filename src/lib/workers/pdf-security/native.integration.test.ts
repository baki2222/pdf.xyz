// @vitest-environment node
//
// A real, end-to-end proof of the qpdf runner against an ACTUAL qpdf binary. It
// round-trips encrypt → is-encrypted → decrypt over a genuine PDF, and proves a
// wrong password is rejected. When qpdf is not installed (e.g. CI without the
// worker image, or this dev sandbox) the whole suite SKIPS honestly rather than
// pretending to have verified anything — the unit tests already cover every branch
// with an injected exec.
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { looksLikePdf } from "../compression/engine";
import { createNativeQpdfRunner, resolveOnPath } from "./native";
import { resolveNativePdfSecurityConfig } from "./native-config";

const HAS_QPDF = resolveOnPath("qpdf");
const suite = HAS_QPDF ? describe : describe.skip;

async function realPdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([320, 240]);
  return doc.save();
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
    const attempt = await runner.unlock(encrypted, { password: "not-the-password" });
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
