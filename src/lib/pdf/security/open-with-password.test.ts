// @native-canvas
import { describe, expect, it } from "vitest";
import {
  FIXTURE_OPEN_PASSWORD,
  GRANT_FIXTURE_TEXT,
  OPEN_PASSWORD_FIXTURE,
  OPEN_PASSWORD_RESTRICTED_FIXTURE,
  RESTRICTED_FIXTURES,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { openWithPassword } from "./open-with-password";
import { ProtectedPdf } from "./protected-pdf";

/**
 * Opening an encrypted PDF with a password the person types, in the browser
 * (audit grayscale-pdf#6): which password it was (the open password or the
 * owner password), what the author grants, and the decrypted copy — read
 * back by pdf.js with NO password, which proves it is no longer encrypted.
 * The fixtures were encrypted by pypdf and qpdf, never by this handler.
 */

async function pdfjsText(bytes: Uint8Array): Promise<string> {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = lib.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    return content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  } finally {
    await task.destroy();
  }
}

describe("openWithPassword", () => {
  it("the open password opens it as the user, with the author's grant, decrypted", async () => {
    const result = await openWithPassword(
      readRestrictedFixture(OPEN_PASSWORD_FIXTURE.file),
      FIXTURE_OPEN_PASSWORD,
    );
    expect(result.kind).toBe("opened");
    if (result.kind !== "opened") return;
    expect(result.as).toBe("user");
    expect(Object.values(result.permissions).every(Boolean)).toBe(true);
    expect(await pdfjsText(result.plain)).toContain(GRANT_FIXTURE_TEXT);
  });

  it("the owner password opens it as the owner", async () => {
    for (const fixture of [
      OPEN_PASSWORD_RESTRICTED_FIXTURE,
      RESTRICTED_FIXTURES[0]!,
    ]) {
      const result = await openWithPassword(
        readRestrictedFixture(fixture.file),
        fixture.owner,
      );
      expect(result.kind, fixture.file).toBe("opened");
      if (result.kind === "opened") expect(result.as).toBe("owner");
    }
  });

  it("the open password of a restricted file reports what the author withholds", async () => {
    const result = await openWithPassword(
      readRestrictedFixture(OPEN_PASSWORD_RESTRICTED_FIXTURE.file),
      FIXTURE_OPEN_PASSWORD,
    );
    expect(result.kind).toBe("opened");
    if (result.kind !== "opened") return;
    expect(result.as).toBe("user");
    expect(result.permissions.modify).toBe(false);
    expect(result.permissions.copy).toBe(true);
  });

  it("a wrong password is told apart from an unreadable file", async () => {
    const result = await openWithPassword(
      readRestrictedFixture(OPEN_PASSWORD_FIXTURE.file),
      "not-the-password",
    );
    expect(result.kind).toBe("wrong-password");
    const plain = await openWithPassword(new Uint8Array([1, 2, 3]), "x");
    expect(plain.kind).toBe("unsupported");
  });
});

describe("one in-browser opener", () => {
  // Review of audit grayscale-pdf#6: openWithPassword was ProtectedPdf.open
  // copied with a password parameter added. Now ProtectedPdf.open takes the
  // password, and openWithPassword is a view of what it returns.
  it("ProtectedPdf.open takes the open password, and says which password it was", async () => {
    const bytes = readRestrictedFixture(OPEN_PASSWORD_FIXTURE.file);
    expect((await ProtectedPdf.open(bytes)).kind).toBe("needs-password");
    const opened = await ProtectedPdf.open(bytes, FIXTURE_OPEN_PASSWORD);
    expect(opened.kind).toBe("opened");
    if (opened.kind !== "opened") return;
    expect(opened.pdf.authenticatedAs).toBe("user");
    expect(await pdfjsText(opened.pdf.plain)).toContain(GRANT_FIXTURE_TEXT);
  });

  it("openWithPassword answers from ProtectedPdf.open", async () => {
    const calls: unknown[][] = [];
    const real = ProtectedPdf.open.bind(ProtectedPdf);
    const spy = (...args: Parameters<typeof ProtectedPdf.open>) => {
      calls.push(args);
      return real(...args);
    };
    const original = ProtectedPdf.open;
    ProtectedPdf.open = spy;
    try {
      const bytes = readRestrictedFixture(OPEN_PASSWORD_FIXTURE.file);
      const result = await openWithPassword(bytes, FIXTURE_OPEN_PASSWORD);
      expect(result.kind).toBe("opened");
      expect(calls).toEqual([[bytes, FIXTURE_OPEN_PASSWORD]]);
    } finally {
      ProtectedPdf.open = original;
    }
  });
});
