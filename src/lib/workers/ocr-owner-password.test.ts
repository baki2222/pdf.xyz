// @vitest-environment node
/**
 * OCR PDF's owner-password check and read-back (`./ocr-owner-password`),
 * over files the in-house handler did NOT make: the restricted-PDF fixtures,
 * encrypted by qpdf and pypdf (their README has how and the owner
 * passwords, which are test values).
 *
 * THE RULE (owner decision): only the OWNER password lifts a restriction.
 * The matrix below derives its subjects from the fixture tables and holds
 * every cipher x password kind; its grant oracle is pdf.js's
 * `getPermissions()` as each table records it, not the function under test.
 */
import { describe, expect, it } from "vitest";
import {
  ASSEMBLE_COPY_FIXTURE,
  NO_ASSEMBLE_COPY_FIXTURE,
  RESTRICTED_FIXTURES,
  VIEW_ONLY_FIXTURE,
  readRestrictedFixture,
  type RestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import {
  OWNER_GRANT_KEPT_KEYS,
  checkOwnerPassword,
  cipherStrength,
  restrictedLike,
} from "./ocr-owner-password";
import { qpdfGrantFromP, type QpdfGrant } from "./pdf-security/permission-bits";
import {
  PROBE_OWNER_PASSWORD,
  PROBE_P,
  restrictedProbePdf,
} from "./ocr-owner-capability";
import type { EncryptParams } from "@/lib/pdf/security/standard-handler";

/** The PR #357 owner-password fixtures, from the folder's README. */
const OWNER_FIXTURES: RestrictedFixture[] = [
  {
    file: "pypdf-r4-aes128-no-grant.pdf",
    producer: "pypdf",
    v: 4,
    r: 4,
    owner: "owner-aes128-test",
    permissions: [4, 512, 2048],
    objectStreams: false,
  },
  {
    file: "pypdf-r6-aes256-no-grant.pdf",
    producer: "pypdf",
    v: 5,
    r: 6,
    owner: "owner-aes256-test",
    permissions: [4, 512, 2048],
    objectStreams: false,
  },
];

const ALL: RestrictedFixture[] = [
  ...RESTRICTED_FIXTURES,
  VIEW_ONLY_FIXTURE,
  ASSEMBLE_COPY_FIXTURE,
  NO_ASSEMBLE_COPY_FIXTURE,
  ...OWNER_FIXTURES,
];

/** pdf.js's permission flags as a grant (R3+ meaning). */
function grantFromPdfjs(flags: readonly number[]): QpdfGrant {
  const has = (n: number) => flags.includes(n);
  return {
    print: !has(4) ? "none" : has(2048) ? "full" : "low",
    modify: has(8),
    copy: has(16),
    annotate: has(32),
    fillForms: has(256),
    accessibility: has(512),
    assemble: has(1024),
  };
}

describe("the subjects (health)", () => {
  it("covers every revision and cipher the handler reads, from the tables", () => {
    expect(ALL.length).toBeGreaterThanOrEqual(10);
    expect(new Set(ALL.map((f) => f.r))).toEqual(new Set([2, 3, 4, 5, 6]));
    expect(new Set(ALL.map((f) => f.producer))).toEqual(
      new Set(["qpdf", "pypdf"]),
    );
  });
});

// R6 key derivation (SHA-256/384/512 rounds) is ~0.3 s a test alone and
// overran vitest's default 5 s under the full suite's load (review finding,
// 2026-11-18), as `options-proof.test.ts` does for the same reason.
describe("checkOwnerPassword", { timeout: 30_000 }, () => {
  for (const fixture of ALL) {
    describe(fixture.file, () => {
      const bytes = readRestrictedFixture(fixture.file);

      it("the owner password: verified, with the author's grant", async () => {
        const check = await checkOwnerPassword(bytes, fixture.owner);
        expect(check.kind).toBe("owner");
        if (check.kind !== "owner") return;
        if (fixture.r >= 3) {
          // Oracle: pdf.js's own reading, recorded in the table.
          const want = grantFromPdfjs(fixture.permissions);
          for (const key of OWNER_GRANT_KEPT_KEYS)
            expect(check.grant[key], key).toBe(want[key]);
        } else {
          // R2 has no bits 9-12 (ISO 32000-1 Table 22): pdf.js reports
          // their raw ones, the spec reads them through bits 3-6.
          expect(check.grant).toMatchObject({
            print: "full",
            modify: false,
            copy: false,
            annotate: true,
            fillForms: true,
            assemble: false,
          });
        }
      });

      it("a wrong password, the empty one, and a near miss: refused", async () => {
        for (const typed of ["not-the-owner", "", `${fixture.owner}x`])
          expect((await checkOwnerPassword(bytes, typed)).kind).toBe(
            "wrong-password",
          );
      });
    });
  }

  it("a file that needs an open password: its owner password lifts nothing here", async () => {
    const bytes = readRestrictedFixture("pypdf-r6-aes256-both-passwords.pdf");
    for (const typed of ["owner-both-test", "open-test"])
      expect((await checkOwnerPassword(bytes, typed)).kind).toBe(
        "needs-open-password",
      );
  });

  it("a file whose owner password is EMPTY: nothing typed is its owner password", async () => {
    const bytes = readRestrictedFixture("pypdf-r6-aes256-empty-owner.pdf");
    for (const typed of ["", "anything", "owner-aes256-test"])
      expect((await checkOwnerPassword(bytes, typed)).kind).toBe(
        "wrong-password",
      );
  });

  it("an unencrypted PDF, and bytes that are no PDF: not read, nothing decrypted", async () => {
    expect(
      (await checkOwnerPassword(readRestrictedFixture("base.pdf"), "x")).kind,
    ).toBe("not-read");
    expect(
      (await checkOwnerPassword(new TextEncoder().encode("not a pdf"), "x"))
        .kind,
    ).toBe("not-read");
  });
});

describe(
  "restrictedLike — the read-back before delivery",
  { timeout: 30_000 },
  () => {
    const r6 = RESTRICTED_FIXTURES.find(
      (f) => f.file === "qpdf-r6-aes256.pdf",
    )!;
    const r6Bytes = readRestrictedFixture(r6.file);

    it("POSITIVE CONTROL: a file is restricted like itself", async () => {
      const check = await checkOwnerPassword(r6Bytes, r6.owner);
      if (check.kind !== "owner") throw new Error("fixture did not verify");
      expect(
        await restrictedLike(r6Bytes, check.grant, r6.owner, check.strength),
      ).toBe(true);
    });

    it("refuses: another owner password, a wider grant, a weaker cipher, a plain file", async () => {
      const check = await checkOwnerPassword(r6Bytes, r6.owner);
      if (check.kind !== "owner") throw new Error("fixture did not verify");
      // Not this owner password.
      expect(
        await restrictedLike(r6Bytes, check.grant, "someone-else", 256),
      ).toBe(false);
      // The grant differs in one kept switch (copying lifted).
      expect(
        await restrictedLike(
          r6Bytes,
          { ...check.grant, copy: true },
          r6.owner,
          256,
        ),
      ).toBe(false);
      // An RC4 copy of an AES-256 original is weaker.
      const r3 = RESTRICTED_FIXTURES.find((f) => f.r === 3)!;
      const r3Bytes = readRestrictedFixture(r3.file);
      const r3Check = await checkOwnerPassword(r3Bytes, r3.owner);
      if (r3Check.kind !== "owner") throw new Error("fixture did not verify");
      expect(await restrictedLike(r3Bytes, r3Check.grant, r3.owner, 256)).toBe(
        false,
      );
      expect(
        await restrictedLike(
          r3Bytes,
          r3Check.grant,
          r3.owner,
          r3Check.strength,
        ),
      ).toBe(true);
      // No encryption at all.
      expect(
        await restrictedLike(
          readRestrictedFixture("base.pdf"),
          check.grant,
          r6.owner,
          0,
        ),
      ).toBe(false);
    });

    // Review finding (2026-11-18): deleting the bit 10 demand left every test
    // green. A copy whose kept switches all match but which withholds
    // accessibility extraction is not what the read-back promises.
    it("refuses a copy whose kept switches all match but whose bit 10 is clear", async () => {
      const original = restrictedProbePdf();
      const check = await checkOwnerPassword(original, PROBE_OWNER_PASSWORD);
      if (check.kind !== "owner") throw new Error("probe did not verify");
      expect(check.grant.accessibility).toBe(true);
      const noAccessibility = PROBE_P & ~(1 << 9);
      expect(noAccessibility).not.toBe(PROBE_P);
      const copy = restrictedProbePdf(noAccessibility);
      // Health: the copy differs from the original ONLY in bit 10.
      const copyGrant = qpdfGrantFromP(noAccessibility, 3);
      expect(copyGrant).toEqual({ ...check.grant, accessibility: false });
      for (const key of OWNER_GRANT_KEPT_KEYS)
        expect(copyGrant[key], key).toBe(check.grant[key]);
      // POSITIVE CONTROL: the same builder, bit 10 set, passes.
      expect(
        await restrictedLike(
          original,
          check.grant,
          PROBE_OWNER_PASSWORD,
          check.strength,
        ),
      ).toBe(true);
      expect(
        await restrictedLike(
          copy,
          check.grant,
          PROBE_OWNER_PASSWORD,
          check.strength,
        ),
      ).toBe(false);
    });

    it("refuses a copy that needs a password to open", async () => {
      const both = readRestrictedFixture("pypdf-r6-aes256-both-passwords.pdf");
      expect(
        await restrictedLike(
          both,
          qpdfGrantFromP(-1340, 6),
          "owner-both-test",
          0,
        ),
      ).toBe(false);
    });
  },
);

// Review finding (2026-11-18): reading fillForms from bit 9 in revision 2
// left every test green, because the qpdf-r2 fixture's /P has bits 6 and 9
// equal. Each case below sets the R2 source bit and its R3+ namesake
// DIFFERENTLY, so only the Table 22 translation passes.
describe("qpdfGrantFromP: revision 2 through ISO 32000-1 Table 22", () => {
  const bit = (n: number) => 1 << (n - 1);
  /** Every bit set but the ones listed: how R2 writers leave 7+ set. */
  const allBut = (...bits: number[]) => bits.reduce((p, n) => p & ~bit(n), -1);

  it("forms come from bit 6, never bit 9", () => {
    expect(qpdfGrantFromP(allBut(9), 2).fillForms).toBe(true);
    expect(qpdfGrantFromP(allBut(6), 2).fillForms).toBe(false);
    // The same /P values read as R3: bit 9 itself.
    expect(qpdfGrantFromP(allBut(9), 3).fillForms).toBe(false);
    expect(qpdfGrantFromP(allBut(6), 3).fillForms).toBe(true);
  });

  it("assembly comes from bit 4, never bit 11", () => {
    expect(qpdfGrantFromP(allBut(11), 2).assemble).toBe(true);
    expect(qpdfGrantFromP(allBut(4), 2).assemble).toBe(false);
    expect(qpdfGrantFromP(allBut(11), 3).assemble).toBe(false);
    expect(qpdfGrantFromP(allBut(4), 3).assemble).toBe(true);
  });

  it("accessibility comes from bit 5, never bit 10", () => {
    expect(qpdfGrantFromP(allBut(10), 2).accessibility).toBe(true);
    expect(qpdfGrantFromP(allBut(5), 2).accessibility).toBe(false);
    expect(qpdfGrantFromP(allBut(10), 3).accessibility).toBe(false);
    expect(qpdfGrantFromP(allBut(5), 3).accessibility).toBe(true);
  });

  it("printing is full from bit 3 alone, never low for want of bit 12", () => {
    expect(qpdfGrantFromP(allBut(12), 2).print).toBe("full");
    expect(qpdfGrantFromP(allBut(3), 2).print).toBe("none");
    expect(qpdfGrantFromP(allBut(12), 3).print).toBe("low");
  });
});

describe("cipherStrength", () => {
  const params = (
    stream: EncryptParams["stream"],
    lengthBits: number,
    string = stream,
  ) => ({ stream, string, lengthBits }) as EncryptParams;

  it("orders RC4 40 < RC4 128 < AES-128 < AES-256, by the weaker filter", () => {
    const order = [
      params("rc4", 40),
      params("rc4", 128),
      params("aesv2", 128),
      params("aesv3", 256),
    ].map(cipherStrength);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(4);
    expect(cipherStrength(params("aesv3", 256, "identity"))).toBe(0);
  });
});
