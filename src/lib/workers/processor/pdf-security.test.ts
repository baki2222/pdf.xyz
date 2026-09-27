// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PdfSecurityDeps, QpdfRunner } from "../pdf-security/engine";
import { createPdfSecurityProcessor } from "./pdf-security";
import type { ProcessorInputFile, ProcessorResult } from "./types";

/** Minimal, structurally-valid PDF bytes (passes `looksLikePdf`). */
function pdf(pad = 40): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(pad)}\n%%EOF\n`);
}

function file(name = "report.pdf", bytes = pdf()): ProcessorInputFile {
  return {
    fileId: "f_1234567890",
    filename: name,
    contentType: "application/pdf",
    bytes,
  };
}

/**
 * A fake qpdf runner whose `isEncrypted` answers by byte identity, and whose
 * `requiresPassword` agrees with it unless a test spells out the disagreement.
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

const wired = (over: Partial<QpdfRunner> = {}): PdfSecurityDeps => ({
  qpdf: fakeQpdf(over),
});

// A distinctive password so any leak into meta/results/errors is unmistakable.
const SECRET = "SENTINEL-PW-42";

/** Assert the secret never appears anywhere in a serialized processor result. */
function assertNoSecret(result: ProcessorResult): void {
  expect(JSON.stringify(result)).not.toContain(SECRET);
}

describe("pdf-security processor — routing & capability", () => {
  it("owns protect-pdf and unlock-pdf", () => {
    const proc = createPdfSecurityProcessor(wired());
    expect(proc.tools).toEqual(["protect-pdf", "unlock-pdf"]);
    expect(proc.supports("protect-pdf")).toBe(true);
    expect(proc.supports("unlock-pdf")).toBe(true);
    expect(proc.supports("compress-pdf")).toBe(false);
  });

  it("is ready only when a qpdf runner is wired", () => {
    expect(createPdfSecurityProcessor(wired()).capability().ready).toBe(true);
    const notReady = createPdfSecurityProcessor({}).capability();
    expect(notReady.ready).toBe(false);
    expect(notReady.detail).toMatch(/qpdf/i);
  });

  it("refuses a tool it does not own", async () => {
    const result = await createPdfSecurityProcessor(wired()).process({
      tool: "compress-pdf",
      options: {},
      inputs: [file()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_implemented");
  });

  it("fails as not_implemented when qpdf is not wired", async () => {
    const result = await createPdfSecurityProcessor({}).process({
      tool: "protect-pdf",
      options: { password: SECRET },
      inputs: [file()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_implemented");
      expect(result.error.retryable).toBe(false);
    }
    assertNoSecret(result);
  });
});

describe("pdf-security processor — protect", () => {
  it("encrypts and returns a named artifact + content-free meta (no password)", async () => {
    const encrypted = pdf(80);
    const proc = createPdfSecurityProcessor(
      wired({
        isEncrypted: async (b) => b === encrypted,
        protect: async () => encrypted,
      }),
    );
    const result = await proc.process({
      tool: "protect-pdf",
      options: { password: SECRET, keyLength: 256 },
      inputs: [file("statement.pdf")],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifacts[0]?.filename).toBe("statement-protected.pdf");
    expect(result.artifacts[0]?.contentType).toBe("application/pdf");
    expect(result.artifacts[0]?.bytes).toBe(encrypted);
    expect(result.meta?.engine).toBe("qpdf");
    expect(result.meta?.operation).toBe("protect");
    expect(result.meta?.keyLength).toBe(256);
    assertNoSecret(result);
  });

  it("rejects an already-encrypted input honestly (non-retryable)", async () => {
    const proc = createPdfSecurityProcessor(
      wired({ isEncrypted: async () => true }),
    );
    const result = await proc.process({
      tool: "protect-pdf",
      options: { password: SECRET },
      inputs: [file()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unprocessable_entity");
      expect(result.error.retryable).toBe(false);
    }
    assertNoSecret(result);
  });

  // What the user reads is `job.error.message`, so this is asserted at the job
  // error the processor returns, not at the engine's constant.
  it("tells a restrictions-only PDF the truth (non-retryable), not 'already password-protected'", async () => {
    const proc = createPdfSecurityProcessor(
      wired({
        isEncrypted: async () => true,
        requiresPassword: async () => "opens-freely",
      }),
    );
    const result = await proc.process({
      tool: "protect-pdf",
      options: { password: SECRET },
      inputs: [file("statement.pdf")],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unprocessable_entity");
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toMatch(/opens without a password/);
    expect(result.error.message).not.toMatch(/already password-protected/i);
    assertNoSecret(result);
  });

  it("rejects a missing password with invalid_request before running", async () => {
    const proc = createPdfSecurityProcessor(wired());
    const result = await proc.process({
      tool: "protect-pdf",
      options: {},
      inputs: [file()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("rejects an invalid PDF input as unprocessable_entity", async () => {
    const proc = createPdfSecurityProcessor(wired());
    const result = await proc.process({
      tool: "protect-pdf",
      options: { password: SECRET },
      inputs: [file("junk.pdf", new Uint8Array([1, 2, 3, 4]))],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
    assertNoSecret(result);
  });

  it("requires exactly one input file", async () => {
    const proc = createPdfSecurityProcessor(wired());
    const zero = await proc.process({
      tool: "protect-pdf",
      options: { password: SECRET },
      inputs: [],
    });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error.code).toBe("unprocessable_entity");
    const two = await proc.process({
      tool: "protect-pdf",
      options: { password: SECRET },
      inputs: [file(), file("b.pdf")],
    });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.error.code).toBe("unprocessable_entity");
  });
});

describe("pdf-security processor — unlock", () => {
  it("decrypts and returns a named artifact (no password in result)", async () => {
    const enc = pdf(48);
    const dec = pdf(96);
    const proc = createPdfSecurityProcessor(
      wired({
        isEncrypted: async (b) => b === enc,
        unlock: async () => ({ ok: true, output: dec }),
      }),
    );
    const result = await proc.process({
      tool: "unlock-pdf",
      options: { password: SECRET },
      inputs: [{ ...file("locked.pdf"), bytes: enc }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifacts[0]?.filename).toBe("locked-unlocked.pdf");
    expect(result.artifacts[0]?.bytes).toBe(dec);
    expect(result.meta?.operation).toBe("unlock");
    assertNoSecret(result);
  });

  it("maps a wrong password to a non-retryable unprocessable_entity with no leak", async () => {
    const enc = pdf();
    const proc = createPdfSecurityProcessor(
      wired({
        isEncrypted: async (b) => b === enc,
        unlock: async () => ({ ok: false, reason: "wrong-password" }),
      }),
    );
    const result = await proc.process({
      tool: "unlock-pdf",
      options: { password: SECRET },
      inputs: [{ ...file(), bytes: enc }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unprocessable_entity");
      expect(result.error.retryable).toBe(false);
    }
    assertNoSecret(result);
  });

  // What the user reads is `job.error.message`, so both new refusals are
  // asserted at the job error the processor returns.
  it("tells the owner of a restrictions-only PDF which password Unlock needs (non-retryable)", async () => {
    const proc = createPdfSecurityProcessor(
      wired({
        isEncrypted: async () => true,
        requiresPassword: async () => "opens-freely",
        unlock: async () => ({ ok: false, reason: "wrong-password" }),
      }),
    );
    const result = await proc.process({
      tool: "unlock-pdf",
      options: { password: SECRET },
      inputs: [file("statement.pdf")],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unprocessable_entity");
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toMatch(/owner \(permissions\) password/);
    expect(result.error.message).not.toMatch(/password is incorrect/i);
    assertNoSecret(result);
  });

  it.each([
    [
      "before the decrypt",
      { requiresPassword: async () => "unreadable" as const },
    ],
    [
      "at the decrypt",
      {
        isEncrypted: async () => true,
        unlock: async () => ({
          ok: false as const,
          reason: "unreadable" as const,
        }),
      },
    ],
  ])(
    "reports a PDF qpdf cannot open (%s) as a non-retryable job error, not a crash to re-run",
    async (_where, over) => {
      const proc = createPdfSecurityProcessor(wired(over));
      const result = await proc.process({
        tool: "unlock-pdf",
        options: { password: SECRET },
        inputs: [file("damaged.pdf")],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("unprocessable_entity");
      expect(result.error.retryable).toBe(false);
      expect(result.error.message).toMatch(/damaged/);
      expect(result.error.message).not.toMatch(
        /incorrect|isn't password-protected/i,
      );
      assertNoSecret(result);
    },
  );

  it("reports a non-encrypted input honestly", async () => {
    const proc = createPdfSecurityProcessor(
      wired({ isEncrypted: async () => false }),
    );
    const result = await proc.process({
      tool: "unlock-pdf",
      options: { password: SECRET },
      inputs: [file()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
    assertNoSecret(result);
  });

  it("rejects a missing password with invalid_request", async () => {
    const proc = createPdfSecurityProcessor(wired());
    const result = await proc.process({
      tool: "unlock-pdf",
      options: {},
      inputs: [file()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });
});
