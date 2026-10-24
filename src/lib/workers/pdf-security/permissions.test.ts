import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS_ALLOWED,
  PDF_PERMISSION_BITS,
  PDF_PERMISSION_KEYS,
  type PdfPermissions,
} from "@/lib/jobs/pdf-permissions";
import type { ProtectPdfOptions } from "@/lib/jobs/pdf-security";
import { runProtect, type QpdfRunner } from "./engine";
import { protectArgs } from "./native";

const enc = (s: string) => new TextEncoder().encode(s);

/** An "encrypted" output whose /Encrypt carries exactly this /P. */
function encryptedWithP(p: number): Uint8Array {
  return enc(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n9 0 obj\n<< /Filter /Standard /V 5 /R 6 /P ${p} >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 9 0 R >>\n${"0".repeat(64)}\n%%EOF\n`,
  );
}

/** The /P qpdf would write for these permissions (bits 1-2 clear, rest set). */
function pFor(perms: PdfPermissions): number {
  let p = -4;
  for (const key of PDF_PERMISSION_KEYS)
    if (!perms[key])
      for (const bit of PDF_PERMISSION_BITS[key]) p &= ~(1 << (bit - 1));
  return p;
}

const plain = enc(`%PDF-1.7\n${"0".repeat(64)}\n%%EOF\n`);

function qpdf(output: Uint8Array, seen: unknown[] = []): QpdfRunner {
  return {
    isEncrypted: async () => false,
    requiresPassword: async (b) =>
      b === output ? "needs-password" : "not-encrypted",
    protect: async (_b, opts) => {
      seen.push(opts);
      return output;
    },
    unlock: async () => ({ ok: true, output: plain }),
  };
}

const RESTRICTED: PdfPermissions = {
  ...ALL_PERMISSIONS_ALLOWED,
  print: false,
  copy: false,
};
const OPTS: ProtectPdfOptions = {
  password: "open",
  ownerPassword: "owner",
  keyLength: 256,
  permissions: RESTRICTED,
};

describe("protectArgs — restriction flags", () => {
  it("default (all allowed): the argv is exactly what shipped before", () => {
    const args = protectArgs("in", "out", {
      userPassword: "u",
      ownerPassword: "o",
      keyLength: 256,
      permissions: ALL_PERMISSIONS_ALLOWED,
    });
    expect(args).toEqual(["--encrypt", "u", "o", "256", "--", "in", "out"]);
  });

  it("each restriction becomes its qpdf flag, inside --encrypt and before --", () => {
    const args = protectArgs("in", "out", {
      userPassword: "u",
      ownerPassword: "o",
      keyLength: 128,
      permissions: {
        print: false,
        copy: false,
        modify: false,
        annotate: false,
        fillForms: false,
        accessibility: true,
        assemble: false,
      },
    });
    const dashdash = args.indexOf("--");
    const flags = args.slice(4, dashdash);
    expect(flags).toEqual([
      "--use-aes=y",
      "--print=none",
      "--extract=n",
      "--modify-other=n",
      "--annotate=n",
      "--form=n",
      "--assemble=n",
    ]);
    // Accessibility is never written as `n`: qpdf ignores it for AES.
    expect(args.some((a) => a.startsWith("--accessibility"))).toBe(false);
  });
});

describe("runProtect — the output's /P is read back against what was asked", () => {
  it("hands the permissions to the qpdf runner", async () => {
    const seen: { permissions?: PdfPermissions }[] = [];
    await runProtect(plain, OPTS, {
      qpdf: qpdf(encryptedWithP(pFor(RESTRICTED)), seen),
    });
    expect(seen[0]?.permissions).toEqual(RESTRICTED);
  });

  it("succeeds when the output's /P withholds exactly what was asked", async () => {
    const run = await runProtect(plain, OPTS, {
      qpdf: qpdf(encryptedWithP(pFor(RESTRICTED))),
    });
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.meta.restricted).toEqual(["print", "copy"]);
  });

  it("FAILS when qpdf wrote a /P that still allows printing", async () => {
    const run = await runProtect(plain, OPTS, {
      qpdf: qpdf(encryptedWithP(pFor({ ...RESTRICTED, print: true }))),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });

  it("FAILS when the output's /P cannot be read at all", async () => {
    const unreadableP = enc(
      `%PDF-1.7\ntrailer\n<< /Root 1 0 R >>\n${"0".repeat(64)}\n%%EOF\n`,
    );
    const run = await runProtect(plain, OPTS, { qpdf: qpdf(unreadableP) });
    expect(run.ok).toBe(false);
  });

  it("control: with no restrictions the /P is not read, exactly as before", async () => {
    const unreadableP = enc(
      `%PDF-1.7\ntrailer\n<< /Root 1 0 R >>\n${"0".repeat(64)}\n%%EOF\n`,
    );
    const run = await runProtect(
      plain,
      { ...OPTS, permissions: ALL_PERMISSIONS_ALLOWED },
      { qpdf: qpdf(unreadableP) },
    );
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.meta.restricted).toEqual([]);
  });
});
