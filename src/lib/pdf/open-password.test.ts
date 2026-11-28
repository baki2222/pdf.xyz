// @vitest-environment node
// @native-canvas
/**
 * `checkOpenPassword` against real encrypted files (pypdf, RC4-128; see
 * `@/tests/fixtures-encrypted`): the open password and the owner password
 * open it, a wrong ASCII password is "wrong", and anything it must not
 * judge is "unknown".
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  OWNER_ONLY_PDF_BASE64,
  USER_PASSWORD_PDF_BASE64,
} from "@/tests/fixtures-encrypted";
import {
  AES256_BOTH_PASSWORDS_FIXTURE,
  FIXTURE_OPEN_PASSWORD,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { classifyPdfAccess } from "./encryption";
import { checkOpenPassword, isPlainAsciiPassword } from "./open-password";

const locked = () =>
  new Uint8Array(Buffer.from(USER_PASSWORD_PDF_BASE64, "base64"));

describe("checkOpenPassword", () => {
  it("health: the fixture is one that needs a password to open", async () => {
    expect((await classifyPdfAccess(locked())).kind).toBe("password-required");
  });

  it("the open password and the owner password both open it", async () => {
    expect(await checkOpenPassword(locked(), "open-sesame")).toBe("opens");
    expect(await checkOpenPassword(locked(), "owner-secret")).toBe("opens");
  });

  it("a wrong plain-ASCII password is wrong, including a near miss", async () => {
    expect(await checkOpenPassword(locked(), "nope")).toBe("wrong");
    expect(await checkOpenPassword(locked(), "Open-sesame")).toBe("wrong");
    expect(await checkOpenPassword(locked(), "open-sesame ")).toBe("wrong");
  });

  it("AES-256 (R6): the open and owner passwords open it, a wrong one is wrong", async () => {
    const aes = readRestrictedFixture(AES256_BOTH_PASSWORDS_FIXTURE.file);
    expect((await classifyPdfAccess(aes)).kind).toBe("password-required");
    expect(await checkOpenPassword(aes, FIXTURE_OPEN_PASSWORD)).toBe("opens");
    expect(
      await checkOpenPassword(aes, AES256_BOTH_PASSWORDS_FIXTURE.owner),
    ).toBe("opens");
    expect(await checkOpenPassword(aes, "open-tesT")).toBe("wrong");
  });

  it("a refused non-ASCII password is unknown: the server decides", async () => {
    expect(await checkOpenPassword(locked(), "öpen-sesame")).toBe("unknown");
  });

  it("a file the handler cannot judge is unknown, never wrong", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(await checkOpenPassword(await doc.save(), "nope")).toBe("unknown");
    expect(
      await checkOpenPassword(new TextEncoder().encode("not a pdf"), "nope"),
    ).toBe("unknown");
  });

  it("control: a restricted file's empty-password open is not mistaken for this password", async () => {
    const restricted = new Uint8Array(
      Buffer.from(OWNER_ONLY_PDF_BASE64, "base64"),
    );
    expect(await checkOpenPassword(restricted, "owner-secret")).toBe("opens");
    expect(await checkOpenPassword(restricted, "nope")).toBe("wrong");
  });

  it("isPlainAsciiPassword: printable ASCII only", () => {
    expect(isPlainAsciiPassword("Abc 123 !~")).toBe(true);
    expect(isPlainAsciiPassword("")).toBe(false);
    expect(isPlainAsciiPassword("pässword")).toBe(false);
    expect(isPlainAsciiPassword("tab\there")).toBe(false);
  });
});
