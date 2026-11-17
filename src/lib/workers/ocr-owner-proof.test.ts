// @vitest-environment node
/**
 * The in-image owner-password proof's JUDGE (`./ocr-owner-proof`), run here
 * over stand-in processors that return the restricted-PDF fixtures (made by
 * qpdf and pypdf), so each check is seen to pass on a right output and to
 * fail on the wrong one it exists for. The engines themselves run only in
 * the image (`pnpm worker:ocr-owner-proof`, container.yml).
 */
import { describe, expect, it } from "vitest";
import { readRestrictedFixture } from "@/tests/restricted-pdf-fixtures";
import { OCR_REFUSAL_MESSAGES } from "./ocr-engine-errors";
import {
  keptBits,
  runOcrOwnerProof,
  type OwnerProofInput,
} from "./ocr-owner-proof";
import { readEncryptPermissions } from "./pdf-security/permission-bits";
import type { Processor, ProcessorResult } from "./processor/types";

const R6 = readRestrictedFixture("pypdf-r6-aes256-no-grant.pdf");
const R6_OWNER = "owner-aes256-test";
const BOTH = readRestrictedFixture("pypdf-r6-aes256-both-passwords.pdf");

const fail = (message: string): ProcessorResult => ({
  ok: false,
  error: { code: "unprocessable_entity", message, retryable: false },
});

/** A processor that behaves like the feature, delivering `output`. */
function processor(output: Uint8Array, completesWrong = false): Processor {
  return {
    id: "ocr",
    tools: ["ocr-pdf"],
    supports: () => true,
    capability: () => ({ id: "ocr", tools: ["ocr-pdf"], ready: true }),
    process: async (input: Parameters<Processor["process"]>[0]) => {
      const pw = input.options.ownerPassword;
      const bytes = input.inputs[0]!.bytes;
      if (bytes === BOTH) return fail(OCR_REFUSAL_MESSAGES.encrypted);
      if (pw === undefined) return fail(OCR_REFUSAL_MESSAGES.restricted);
      if (pw !== R6_OWNER && !completesWrong)
        return fail(OCR_REFUSAL_MESSAGES["wrong-owner-password"]);
      return {
        ok: true,
        artifacts: [
          {
            filename: "restricted-ocr.pdf",
            contentType: "application/pdf",
            bytes: output,
          },
        ],
      };
    },
  } as unknown as Processor;
}

const input = (name: string, r = 6): OwnerProofInput => ({
  name,
  bytes: R6,
  owner: R6_OWNER,
  p: readEncryptPermissions(R6)!,
  r,
  line: null,
});

async function judge(
  ocr: Processor,
  inputs = [input("a"), input("b"), input("c")],
) {
  const lines: string[] = [];
  const code = await runOcrOwnerProof({
    ocr,
    inputs,
    openPassword: { bytes: BOTH, owner: "owner-both-test" },
    requiresPasswordExit: async () => 3,
    decrypt: async (pdf) => pdf,
    pdfText: null,
    log: (line) => lines.push(line),
  });
  return { code, lines };
}

// R6 key derivation (SHA-256/384/512 rounds) is ~0.3 s a test alone and
// overran vitest's default 5 s under the full suite's load (review finding,
// 2026-11-18), as `options-proof.test.ts` does for the same reason.
describe("runOcrOwnerProof — the judge", { timeout: 30_000 }, () => {
  it("POSITIVE CONTROL: every per-input check passes on a right output", async () => {
    const { lines } = await judge(processor(R6));
    for (const name of ["a", "b", "c"])
      for (const check of [
        "instrument",
        "encryption",
        "no open password",
        "owner password",
        "/P bits",
        "wrong password",
        "no password (control)",
      ])
        expect(lines, `${name} ${check}`).toContain(
          lines.find((l) => l.startsWith(`PASS ${name} ${check}:`)),
        );
    expect(
      lines.find((l) => l.startsWith("PASS open-password file")),
    ).toBeDefined();
  });

  it("the corpus health check fails without a revision 2 input", async () => {
    const { code, lines } = await judge(processor(R6));
    expect(code).toBe(1);
    expect(lines.find((l) => l.startsWith("FAIL corpus"))).toBeDefined();
  });

  it("fails a copy whose grant differs", async () => {
    const { lines } = await judge(
      processor(readRestrictedFixture("qpdf-r6-aes256.pdf")),
    );
    expect(lines.some((l) => l.startsWith("FAIL a /P bits"))).toBe(true);
  });

  it("fails a weaker cipher, and a copy that needs a password to open", async () => {
    const weak = await judge(
      processor(readRestrictedFixture("pypdf-r4-aes128-no-grant.pdf")),
    );
    expect(weak.lines.some((l) => l.startsWith("FAIL a encryption"))).toBe(
      true,
    );
    const locked = await judge(processor(BOTH));
    expect(
      locked.lines.some((l) => l.startsWith("FAIL a no open password")),
    ).toBe(true);
  });

  it("fails a worker that completes a wrong password", async () => {
    const { lines } = await judge(processor(R6, true));
    expect(lines.some((l) => l.startsWith("FAIL a wrong password"))).toBe(true);
  });

  it("says it cannot conclude without qpdf (exit 2)", async () => {
    const lines: string[] = [];
    expect(
      await runOcrOwnerProof({
        ocr: processor(R6),
        inputs: [],
        openPassword: { bytes: BOTH, owner: "x" },
        requiresPasswordExit: null,
        decrypt: null,
        pdfText: null,
        log: (l) => lines.push(l),
      }),
    ).toBe(2);
  });
});

describe("keptBits — revision 2 read through ISO 32000-1 Table 22", () => {
  it("bits 9, 11 and 12 come from 6, 4 and 3 in revision 2, raw in 3+", () => {
    // Only bits 3 and 6 granted, with every bit above 6 set (as R2 writers do).
    const p = -1 & ~(1 << 3) & ~(1 << 4);
    expect(keptBits(p, 2)).toEqual({
      3: true,
      4: false,
      5: false,
      6: true,
      9: true,
      11: false,
      12: true,
    });
    expect(keptBits(p, 3)[11]).toBe(true);
  });
});
