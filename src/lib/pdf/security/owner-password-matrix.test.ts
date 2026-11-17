// @native-canvas
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  AES128_NO_GRANT_FIXTURE,
  AES256_BOTH_PASSWORDS_FIXTURE,
  AES256_NO_GRANT_FIXTURE,
  FIXTURE_OPEN_PASSWORD,
  NO_ASSEMBLE_COPY_FIXTURE,
  OPEN_PASSWORD_RESTRICTED_FIXTURE,
  readRestrictedFixture,
  type GrantFixture,
} from "@/tests/restricted-pdf-fixtures";
import {
  OWNER_PASSWORD_TOOLS,
  type OwnerPasswordTool,
} from "@/lib/pdf/owner-password-copy";
import {
  deletePages,
  extractPages,
  mergePdfs,
  setPageRotations,
} from "../engine";
import { extractPdfImages } from "../extract-images";
import type { LoadedPdf } from "@/components/tools/runner/use-single-pdf";
import { unlockWithOwnerPassword } from "@/components/tools/runner/owner-unlock";
import { grantAllows } from "@/components/tools/runner/restricted-grant";
import { openWithPassword } from "./open-with-password";

/**
 * THE OWNER'S RULE as a property (competitor-audit backlog #11): for every
 * tool that carries the owner-password field, every kind of password, and
 * every cipher, ONLY the owner password produces output. The open password
 * — empty, for a file that opens without one — and a wrong password, and no
 * password, never do.
 *
 * Each cell runs the composed chain the page runs: the field's check
 * (`unlockWithOwnerPassword`, `./owner-unlock`, the chunk the field fetches),
 * the tool's own gate where it has one (`grantAllows`), and the tool's own
 * engine call — so a cell is red if any link lets a non-owner through, or
 * if the owner's path stops producing what the tool promises. Rotate PDF's
 * output is read back by pdf.js and must STILL be encrypted under the
 * author's grant: the owner password unlocks the rotation, not the file.
 *
 * Fixtures were encrypted by pypdf (`src/tests/fixtures/restricted-pdf`),
 * never by the handler they test.
 */

type Kind = "owner" | "open" | "wrong" | "none";
const KINDS: readonly Kind[] = ["owner", "open", "wrong", "none"];

interface Case {
  fixture: GrantFixture;
  /** "" when it opens without a password. */
  open: string;
}

const CASES: readonly Case[] = [
  { fixture: NO_ASSEMBLE_COPY_FIXTURE, open: "" },
  { fixture: AES128_NO_GRANT_FIXTURE, open: "" },
  { fixture: AES256_NO_GRANT_FIXTURE, open: "" },
  { fixture: OPEN_PASSWORD_RESTRICTED_FIXTURE, open: FIXTURE_OPEN_PASSWORD },
  { fixture: AES256_BOTH_PASSWORDS_FIXTURE, open: FIXTURE_OPEN_PASSWORD },
];

function passwordFor(kind: Kind, c: Case): string {
  switch (kind) {
    case "owner":
      return c.fixture.owner;
    case "open":
      return c.open;
    case "wrong":
      return "not-the-owner-password";
    case "none":
      return "";
  }
}

async function viewer(bytes: Uint8Array, password: string) {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = lib.getDocument({ data: bytes.slice(), password, verbosity: 0 });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    return {
      pages: doc.numPages,
      rotate: page.rotate,
      permissions: await doc.getPermissions(),
    };
  } finally {
    await task.destroy();
  }
}

async function isUnencrypted(bytes: Uint8Array): Promise<number> {
  // pdf-lib refuses any /Encrypt: loading it is the proof there is none.
  return (await PDFDocument.load(bytes)).getPageCount();
}

/**
 * The tool's own work on an opened file, or null when the tool's own gate
 * refuses it. Throws when the work fails — never a quiet "no output".
 */
async function runTool(
  tool: OwnerPasswordTool,
  pdf: LoadedPdf,
  c: Case,
): Promise<string | null> {
  switch (tool) {
    case "merge-pdf": {
      const out = await mergePdfs([pdf.bytes, pdf.bytes]);
      return `merged ${await isUnencrypted(out)} pages`;
    }
    case "extract-pages": {
      const out = await extractPages(pdf.bytes, [1]);
      return `extracted ${await isUnencrypted(out)} page`;
    }
    case "remove-pages": {
      const out = await deletePages(pdf.bytes, [0]);
      return `kept ${await isUnencrypted(out)} page`;
    }
    case "rotate-pdf": {
      if (!pdf.protection || !grantAllows(pdf.protection, "assemble"))
        return null;
      const rotated = await setPageRotations(pdf.bytes, [90, 0]);
      const out = (await pdf.protection.saveChanges(rotated)).bytes;
      // Still encrypted, under the author's grant, with its open password.
      await expect(PDFDocument.load(out)).rejects.toThrow();
      const read = await viewer(out, c.open);
      expect(read.rotate).toBe(90);
      expect(read.permissions).toEqual(c.fixture.permissions);
      return `rotated, still encrypted, grant ${(read.permissions ?? []).join(",")}`;
    }
    case "extract-images": {
      if (!pdf.protection || !grantAllows(pdf.protection, "copy")) return null;
      const out = await extractPdfImages(pdf.bytes);
      expect(out.images.length).toBeGreaterThan(0);
      return `${out.images.length} image`;
    }
  }
}

/** Does this (tool, kind, case) produce output? And which refusal if not. */
async function cell(tool: OwnerPasswordTool, kind: Kind, c: Case) {
  const bytes = readRestrictedFixture(c.fixture.file);
  const file = new File([bytes.slice()], c.fixture.file, {
    type: "application/pdf",
  });
  const unlocked = await unlockWithOwnerPassword(
    file,
    bytes,
    passwordFor(kind, c),
  );
  if (unlocked.kind !== "opened") return { output: null, why: unlocked.kind };
  const output = await runTool(tool, unlocked.pdf, c);
  return { output, why: output ? "opened" : "gate" };
}

describe("the owner's rule: only the owner password produces output", () => {
  it("health check: 5 tools x 4 kinds x 5 files, three ciphers, both open-password shapes", async () => {
    expect(OWNER_PASSWORD_TOOLS).toHaveLength(5);
    const schemes = new Set<string>();
    for (const c of CASES) {
      const opened = await openWithPassword(
        readRestrictedFixture(c.fixture.file),
        c.fixture.owner,
      );
      expect(opened.kind, c.fixture.file).toBe("opened");
      if (opened.kind !== "opened") continue;
      expect(opened.as).toBe("owner");
      expect(opened.pdf.unlocked).toBe(true);
      // Every fixture withholds what Rotate PDF and Extract Images ask.
      expect(opened.permissions.assemble || opened.permissions.copy).toBe(
        c.fixture === OPEN_PASSWORD_RESTRICTED_FIXTURE,
      );
      schemes.add(
        opened.pdf.scheme.replace(
          new RegExp(`^R[0-9] ${String.fromCodePoint(0xb7)} `),
          "",
        ),
      );
    }
    expect([...schemes].sort()).toEqual(["AES-128", "AES-256", "RC4 128-bit"]);
    expect(CASES.filter((c) => c.open !== "")).toHaveLength(2);
    expect(OWNER_PASSWORD_TOOLS.length * KINDS.length * CASES.length).toBe(100);
  });

  it("POSITIVE CONTROL: a non-owner opening fed straight to each tool DOES produce output: the refusal is the rule's, not a broken tool", async () => {
    // Bypass the rule: open with the open password ("" here) and hand the
    // decrypted copy to the new-file tools. They work, so a refusal in the
    // matrix below cannot be an engine that fails on these files.
    const c = CASES[2]!; // AES-256, opens without a password
    const opened = await openWithPassword(
      readRestrictedFixture(c.fixture.file),
      c.open,
    );
    expect(opened.kind).toBe("opened");
    if (opened.kind !== "opened") return;
    expect(opened.as).toBe("user");
    const pdf: LoadedPdf = {
      file: new File([], c.fixture.file),
      bytes: opened.plain,
      pageCount: 2,
      rotations: [0, 0],
      digitalSignatures: 0,
      protection: opened.pdf,
    };
    for (const tool of ["merge-pdf", "extract-pages", "remove-pages"] as const)
      expect(await runTool(tool, pdf, c), tool).toBeTruthy();
    // …and the grant tools' own gate is what stops them, not the engine.
    expect(await runTool("rotate-pdf", pdf, c)).toBeNull();
    expect(await runTool("extract-images", pdf, c)).toBeNull();
  }, 60_000);

  for (const tool of OWNER_PASSWORD_TOOLS)
    for (const c of CASES)
      it(`${tool} - ${c.fixture.file}`, async () => {
        const seen: Record<string, string> = {};
        for (const kind of KINDS) {
          const { output, why } = await cell(tool, kind, c);
          seen[kind] = output ?? `refused (${why})`;
          if (kind === "owner")
            expect(output, `${tool}: the owner password`).toBeTruthy();
          else expect(output, `${tool}: the ${kind} password`).toBeNull();
        }
        // The refusals say which: a wrong password, a password that opens
        // the file but is not the owner's, and no password at all.
        expect(seen.wrong).toBe("refused (wrong-password)");
        expect(seen.open).toBe("refused (withheld)");
        expect(seen.none).toBe(
          c.open === "" ? "refused (withheld)" : "refused (wrong-password)",
        );
      }, 60_000);
});
