import { describe, expect, it } from "vitest";
import {
  AES128_PASSWORD_CHARSET_MESSAGE,
  DEFAULT_PDF_KEY_LENGTH,
  MAX_PDF_PASSWORD_BYTES,
  describePdfKeyLength,
  isPdfDocEncodable,
  isPdfKeyLength,
  parseProtectPdfOptions,
  parseUnlockPdfOptions,
  protectedOutputName,
  unlockedOutputName,
} from "./pdf-security";

// A distinctive value so any leak of the password into an error is unmistakable.
const SECRET = "hunter2-SENTINEL-Zx9";

describe("parseProtectPdfOptions", () => {
  it("accepts a password and defaults owner password + key length", () => {
    const parsed = parseProtectPdfOptions({ password: SECRET });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.password).toBe(SECRET);
    // Owner password defaults to the user password (single-password protection).
    expect(parsed.value.ownerPassword).toBe(SECRET);
    expect(parsed.value.keyLength).toBe(DEFAULT_PDF_KEY_LENGTH);
  });

  it("accepts a distinct owner password and a valid key length", () => {
    const parsed = parseProtectPdfOptions({
      password: "open",
      ownerPassword: "owner",
      keyLength: 128,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.ownerPassword).toBe("owner");
    expect(parsed.value.keyLength).toBe(128);
  });

  it("rejects a missing password with invalid_request and no leaked value", () => {
    const parsed = parseProtectPdfOptions({});
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.body.error.code).toBe("invalid_request");
    expect(parsed.error.body.error.details?.[0]?.field).toBe(
      "options.password",
    );
  });

  it("rejects an empty password", () => {
    const parsed = parseProtectPdfOptions({ password: "" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.body.error.code).toBe("invalid_request");
  });

  it("rejects a non-string password", () => {
    const parsed = parseProtectPdfOptions({ password: 1234 });
    expect(parsed.ok).toBe(false);
  });

  it("rejects a control character in the password", () => {
    const parsed = parseProtectPdfOptions({ password: `line1\nline2` });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.body.error.code).toBe("invalid_request");
  });

  it("rejects a password longer than the AES-256 byte limit", () => {
    const long = "a".repeat(MAX_PDF_PASSWORD_BYTES + 1);
    const parsed = parseProtectPdfOptions({ password: long });
    expect(parsed.ok).toBe(false);
  });

  it("bounds by UTF-8 bytes, not characters (multi-byte)", () => {
    // "€" is 3 UTF-8 bytes; 43 of them = 129 bytes > 127.
    const parsed = parseProtectPdfOptions({ password: "€".repeat(43) });
    expect(parsed.ok).toBe(false);
  });

  it("rejects an unknown key length", () => {
    const parsed = parseProtectPdfOptions({ password: "p", keyLength: 512 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.body.error.details?.[0]?.field).toBe(
        "options.keyLength",
      );
    }
  });

  it("never echoes the password in any validation error", () => {
    // Trigger the "too long" branch, which mentions a byte count, with a secret-laden value.
    const parsed = parseProtectPdfOptions({
      password: `${SECRET}${"x".repeat(200)}`,
      keyLength: 9,
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(JSON.stringify(parsed.error)).not.toContain(SECRET);
  });
});

// Audit #12 (2026-11-06). AES-128 (R4) stores the password in PDFDocEncoding,
// which has no Bengali, Cyrillic, Greek or CJK letters. qpdf's default
// password mode only WARNS on such a password and encrypts its raw UTF-8
// bytes, which most readers will not accept when the person types it, and the
// job still reported "protected". Built from code points so no tool layer can
// rewrite the characters.
const BANGLA = String.fromCodePoint(0x09aa, 0x09be, 0x09b8, 0x0993, 0x09df); // a Bangla word
const CYRILLIC = String.fromCodePoint(
  0x043f,
  0x0430,
  0x0440,
  0x043e,
  0x043b,
  0x044c,
);

describe("parseProtectPdfOptions: AES-128 needs a PDFDocEncoding password", () => {
  it("refuses a Bangla open password at 128-bit, without echoing it", () => {
    const password = `${SECRET}${BANGLA}`;
    const parsed = parseProtectPdfOptions({ password, keyLength: 128 });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.body.error.code).toBe("invalid_request");
    expect(parsed.error.body.error.details?.[0]?.field).toBe(
      "options.password",
    );
    expect(parsed.error.body.error.message).toMatch(/AES-256/);
    expect(JSON.stringify(parsed.error)).not.toContain(SECRET);
  });

  it("refuses a non-Latin owner password at 128-bit", () => {
    const parsed = parseProtectPdfOptions({
      password: "open",
      ownerPassword: CYRILLIC,
      keyLength: 128,
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.body.error.details?.[0]?.field).toBe(
      "options.ownerPassword",
    );
  });

  it("accepts the same passwords at AES-256, where UTF-8 is the format", () => {
    const parsed = parseProtectPdfOptions({
      password: BANGLA,
      ownerPassword: CYRILLIC,
      keyLength: 256,
    });
    expect(parsed.ok).toBe(true);
  });

  it("positive control: accented Latin and PDFDocEncoding's own symbols pass at 128-bit", () => {
    // e-acute, u-umlaut, n-tilde, euro sign, em dash, L-stroke, OE ligature
    const latin = String.fromCodePoint(
      0xe9,
      0xfc,
      0xf1,
      0x20ac,
      0x2014,
      0x141,
      0x152,
    );
    expect(isPdfDocEncodable(latin)).toBe(true);
    const parsed = parseProtectPdfOptions({
      password: `pass${latin}`,
      keyLength: 128,
    });
    expect(parsed.ok).toBe(true);
  });

  it("the predicate refuses what PDFDocEncoding has no code for", () => {
    // Latin Extended-A letters beyond the Annex D few (Ł, Œ, Š, Ž, Ÿ, ı) are
    // Latin and still refused: ą ć ę ń ś ź ż (Polish), č ř ě (Czech),
    // ă ș ț (Romanian), ğ ş (Turkish), ő ű (Hungarian). The refusal copy
    // must not promise "Latin letters" (audit #12 review).
    const latinExtendedA = [
      0x105, 0x107, 0x119, 0x144, 0x15b, 0x17a, 0x17c, 0x10d, 0x159, 0x11b,
      0x103, 0x219, 0x21b, 0x11f, 0x15f, 0x151, 0x171,
    ];
    for (const cp of [
      0x09aa,
      0x043f,
      0x03b1,
      0x4e2d,
      0xa0,
      0xad,
      0x1f600,
      ...latinExtendedA,
    ]) {
      expect(isPdfDocEncodable(String.fromCodePoint(cp)), cp.toString(16)).toBe(
        false,
      );
    }
    // Health check: printable ASCII is all in.
    let ascii = "";
    for (let cp = 0x20; cp < 0x7f; cp += 1) ascii += String.fromCodePoint(cp);
    expect(isPdfDocEncodable(ascii)).toBe(true);
  });
});

describe("AES128_PASSWORD_CHARSET_MESSAGE describes the set isPdfDocEncodable accepts", () => {
  // Audit #12 review: the message said "only Latin letters" while the
  // predicate refuses most Latin Extended-A letters, so a Polish password made
  // only of Latin letters was told it may use only Latin letters.
  it("does not promise every Latin letter, and names letters the predicate refuses", () => {
    expect(AES128_PASSWORD_CHARSET_MESSAGE).not.toMatch(/only Latin letters/);
    expect(AES128_PASSWORD_CHARSET_MESSAGE).toMatch(/Western European/);
    const named = [...AES128_PASSWORD_CHARSET_MESSAGE].filter(
      (ch) => ch.codePointAt(0)! > 0x7f && /\p{L}/u.test(ch),
    );
    // Health check: the copy really does name example letters.
    expect(named.length).toBeGreaterThanOrEqual(2);
    for (const ch of named) expect(isPdfDocEncodable(ch), ch).toBe(false);
  });

  it("names both strengths by their catalogue labels", () => {
    expect(AES128_PASSWORD_CHARSET_MESSAGE).toContain(
      `${describePdfKeyLength(128)} passwords`,
    );
    expect(AES128_PASSWORD_CHARSET_MESSAGE).toContain(
      `Choose ${describePdfKeyLength(256)}`,
    );
  });
});

describe("parseUnlockPdfOptions", () => {
  it("accepts a password", () => {
    const parsed = parseUnlockPdfOptions({ password: SECRET });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.password).toBe(SECRET);
  });

  it("rejects a missing password", () => {
    const parsed = parseUnlockPdfOptions({});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.body.error.code).toBe("invalid_request");
  });

  /**
   * INVERTED TWICE — history kept.
   *
   * 1. Originally this parser rejected "" ("an empty password is not a
   *    password").
   * 2. wave1/l06-copy-other (0cf157b) inverted that to "accepts an EMPTY
   *    password — the one that opens a restrictions-only PDF": a blank unlock
   *    ran `qpdf --decrypt` with no `--password`, which strips an owner-only
   *    file's printing/copying/editing locks without the owner password.
   * 3. Inverted back at the merge of that lane (2026-09-28). The other lane
   *    (a50c54c, L02) had already fixed the same dead end without that bypass:
   *    Unlock removes restrictions only with the OWNER password that set them,
   *    names that password in its refusal, and records lifting them without it
   *    as the product owner's decision, not a bug fix. The site states that
   *    rule in the tool description, FAQ and guides ("cannot recover or bypass
   *    a password you do not know"), so the parser keeps refusing "".
   */
  it("refuses an EMPTY password — restrictions go only with the owner password", () => {
    const parsed = parseUnlockPdfOptions({ password: "" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.body.error.code).toBe("invalid_request");
  });

  it("protect refuses an empty password too", () => {
    const parsed = parseProtectPdfOptions({ password: "" });
    expect(parsed.ok).toBe(false);
  });

  it("never echoes the password in the error", () => {
    const parsed = parseUnlockPdfOptions({ password: `${SECRET} ` });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(JSON.stringify(parsed.error)).not.toContain(SECRET);
  });
});

describe("key length helpers", () => {
  it("recognizes supported key lengths", () => {
    expect(isPdfKeyLength(256)).toBe(true);
    expect(isPdfKeyLength(128)).toBe(true);
    expect(isPdfKeyLength(40)).toBe(false);
    expect(isPdfKeyLength("256")).toBe(false);
  });

  it("describes each level", () => {
    expect(describePdfKeyLength(256)).toMatch(/aes-256/i);
    expect(describePdfKeyLength(128)).toMatch(/aes-128/i);
  });
});

describe("output names", () => {
  it("derives a deterministic protected name", () => {
    expect(protectedOutputName("report.pdf")).toBe("report-protected.pdf");
    expect(protectedOutputName("../secret.PDF")).toBe("secret-protected.pdf");
  });

  it("derives a deterministic unlocked name", () => {
    expect(unlockedOutputName("report.pdf")).toBe("report-unlocked.pdf");
    expect(unlockedOutputName("")).toBe("document-unlocked.pdf");
  });

  it("is stable for the same input", () => {
    expect(protectedOutputName("a.pdf")).toBe(protectedOutputName("a.pdf"));
  });
});
