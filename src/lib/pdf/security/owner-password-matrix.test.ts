// @native-canvas
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  AES128_NO_GRANT_FIXTURE,
  AES256_BOTH_PASSWORDS_FIXTURE,
  AES256_EMPTY_OWNER_FIXTURE,
  AES256_NO_GRANT_FIXTURE,
  FIXTURE_OPEN_PASSWORD,
  NO_ASSEMBLE_COPY_FIXTURE,
  OPEN_PASSWORD_FIXTURE,
  OPEN_PASSWORD_RESTRICTED_FIXTURE,
  VIEW_ONLY_FIXTURE,
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
import { openWithPassword, type ToolGrant } from "./open-with-password";

/**
 * THE OWNER'S RULE as a property (competitor-audit backlog #11): for every
 * tool that carries the owner-password field, every kind of password, and
 * every cipher, nothing but the owner password lifts a restriction the
 * author set. Merge PDF, Extract Pages and Delete Pages write a new file
 * with no encryption, so for them ONLY the owner password produces output
 * from a file whose author withholds anything. Rotate PDF (written back
 * under the author's encryption) and Extract Images (no PDF written) lift
 * nothing, so the open password serves them exactly when the author grants
 * their one permission, and never otherwise (review 2026-11-17: refusing
 * it there named restrictions rotation does not need). A wrong password,
 * and no password, never produce output from a file that needs one.
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

/** The grant tools' own gate, as each runner hands it to the field. */
const GRANT: Partial<Record<OwnerPasswordTool, ToolGrant>> = {
  "rotate-pdf": {
    key: "assemble",
    allows: (pdf) => grantAllows(pdf, "assemble"),
  },
  "extract-images": { key: "copy", allows: (pdf) => grantAllows(pdf, "copy") },
};

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
  return cellWith(tool, passwordFor(kind, c), c, bytes);
}

async function cellWith(
  tool: OwnerPasswordTool,
  password: string,
  c: Case,
  bytes: Uint8Array,
) {
  const file = new File([bytes.slice()], c.fixture.file, {
    type: "application/pdf",
  });
  const unlocked = await unlockWithOwnerPassword(
    file,
    bytes,
    password,
    GRANT[tool],
  );
  if (unlocked.kind !== "opened") return { output: null, why: unlocked.kind };
  // What the runner takes (it reads the board itself from `plain`).
  const { plain, protection } = unlocked.opened;
  const output = await runTool(
    tool,
    {
      file,
      bytes: plain,
      pageCount: c.fixture.pageCount,
      rotations: Array.from({ length: c.fixture.pageCount }, () => 0),
      digitalSignatures: 0,
      protection,
    },
    c,
  );
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
        // The open password serves only a tool that lifts nothing, and only
        // when the author grants what it does (/P bit 11 = 1024, bit 5 = 16).
        const openServes =
          c.open !== "" &&
          tool in GRANT &&
          c.fixture.permissions.includes(tool === "rotate-pdf" ? 1024 : 16);
        for (const kind of KINDS) {
          const { output, why } = await cell(tool, kind, c);
          seen[kind] = output ?? `refused (${why})`;
          if (kind === "owner" || (kind === "open" && openServes))
            expect(output, `${tool}: the ${kind} password`).toBeTruthy();
          else expect(output, `${tool}: the ${kind} password`).toBeNull();
        }
        // The refusals say which: a wrong password, a password that opens
        // the file but is not the owner's, and no password at all.
        expect(seen.wrong).toBe("refused (wrong-password)");
        if (!openServes) expect(seen.open).toBe("refused (withheld)");
        expect(seen.none).toBe(
          c.open === "" ? "refused (withheld)" : "refused (wrong-password)",
        );
      }, 60_000);
});

/**
 * Review 2026-11-17, rule 2's shape: the open password must not lift a
 * restriction by any OTHER road than the owner password. Two roads were
 * open: an R5/R6 file whose /P was raised by editing it (/P is not
 * encrypted) with a /Perms that no longer verifies, which the handler then
 * trusted as written; and a file whose owner password is EMPTY, which
 * opens "as owner" for anyone.
 */
describe("the owner's rule has no side door", () => {
  const ascii = (text: string) =>
    Uint8Array.from(text, (ch) => ch.codePointAt(0)!);
  function indexOf(bytes: Uint8Array, text: string): number {
    const needle = ascii(text);
    outer: for (let i = 0; i + needle.length <= bytes.length; i += 1) {
      for (let j = 0; j < needle.length; j += 1)
        if (bytes[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }
  /** Flip the first hex digit of /Perms: it no longer decrypts to "adb". */
  function breakPerms(out: Uint8Array) {
    const perms = indexOf(out, "/Perms <");
    expect(perms, "the fixture's /Perms").toBeGreaterThan(0);
    const at = perms + "/Perms <".length;
    out[at] = out[at] === 0x30 ? 0x31 : 0x30;
  }
  /**
   * `from` replaced by `to` (same length, so the xref still lines up) and,
   * unless `keepPerms`, /Perms broken. Health-checked: the mutation landed,
   * and only there.
   */
  function tamper(
    original: Uint8Array,
    from: string,
    to: string,
    keepPerms = false,
  ): Uint8Array {
    expect(to.length).toBe(from.length);
    const out = original.slice();
    const p = indexOf(out, from);
    expect(p, `the fixture's ${from}`).toBeGreaterThan(0);
    out.set(ascii(to), p);
    if (!keepPerms) breakPerms(out);
    let changed = 0;
    for (let i = 0; i < out.length; i += 1)
      if (out[i] !== original[i]) changed += 1;
    expect(out.length).toBe(original.length);
    expect(changed).toBeGreaterThan(keepPerms ? 0 : 1);
    expect(changed).toBeLessThanOrEqual(from.length + (keepPerms ? 0 : 1));
    return out;
  }
  // pypdf writes /P unsigned: 4294965956 is -1340, 4294967292 is -4.
  const RAISE = ["/P 4294965956", "/P 4294967292"] as const;
  const BOTH: Case = {
    fixture: AES256_BOTH_PASSWORDS_FIXTURE,
    open: FIXTURE_OPEN_PASSWORD,
  };
  const NO_OPEN: Case = { fixture: AES256_NO_GRANT_FIXTURE, open: "" };

  it("a raised /P with a broken /Perms: the open password, or none, lifts nothing; the owner password still works", async () => {
    for (const c of [BOTH, NO_OPEN]) {
      const bytes = tamper(readRestrictedFixture(c.fixture.file), ...RAISE);
      // The tamper is real: the file still opens with the open password,
      // and only the fail-closed /Perms check keeps the raised /P out.
      const read = await openWithPassword(bytes, c.open);
      expect(read.kind).toBe("opened");
      if (read.kind !== "opened") continue;
      expect(read.pdf.unlocked).toBe(false);
      expect(Object.values(read.permissions).some(Boolean)).toBe(false);
      for (const tool of OWNER_PASSWORD_TOOLS) {
        expect(
          (await cellWith(tool, c.open, c, bytes)).why,
          `${tool}: ${c.fixture.file}, open password`,
        ).toBe("withheld");
        // The rotated copy keeps the file's /Encrypt byte for byte, and
        // pdf.js reads /P as written: the raised grant is what it reports.
        const asWritten: Case = {
          ...c,
          fixture: {
            ...c.fixture,
            permissions: [4, 8, 16, 32, 256, 512, 1024, 2048],
          },
        };
        expect(
          (await cellWith(tool, c.fixture.owner, asWritten, bytes)).why,
          `${tool}: ${c.fixture.file}, owner password`,
        ).toBe("opened");
      }
    }
  }, 120_000);

  it("CONTROL: a raised /P with /Perms intact is cut back to the sealed grant", async () => {
    const bytes = tamper(
      readRestrictedFixture(BOTH.fixture.file),
      ...RAISE,
      true,
    );
    const read = await openWithPassword(bytes, BOTH.open);
    expect(read.kind).toBe("opened");
    if (read.kind !== "opened") return;
    // The sealed grant, not the raised /P.
    expect(read.permissions.print).toBe(true);
    expect(read.permissions.copy).toBe(false);
    expect(read.permissions.assemble).toBe(false);
    for (const tool of OWNER_PASSWORD_TOOLS)
      expect((await cellWith(tool, BOTH.open, BOTH, bytes)).why, tool).toBe(
        "withheld",
      );
  }, 60_000);

  it("qpdf's R6 view-only file, /P raised and /Perms broken, stays restricted with no password", async () => {
    const bytes = tamper(
      readRestrictedFixture(VIEW_ONLY_FIXTURE.file),
      "/P -1340",
      "/P -0004",
    );
    const c: Case = {
      fixture: { ...VIEW_ONLY_FIXTURE, pageCount: 1 },
      open: "",
    };
    for (const tool of ["merge-pdf", "extract-pages", "remove-pages"] as const)
      expect((await cellWith(tool, "", c, bytes)).why, tool).toBe("withheld");
  }, 60_000);

  it("an EMPTY owner password opens it for anyone, and that lifts nothing", async () => {
    const c: Case = { fixture: AES256_EMPTY_OWNER_FIXTURE, open: "" };
    const bytes = readRestrictedFixture(c.fixture.file);
    // Health check: it IS the shape the review found: "" opens as owner.
    const read = await openWithPassword(bytes, "");
    expect(read.kind).toBe("opened");
    if (read.kind !== "opened") return;
    expect(read.as).toBe("owner");
    expect(read.pdf.unlocked).toBe(false);
    for (const tool of OWNER_PASSWORD_TOOLS)
      expect((await cellWith(tool, "", c, bytes)).why, tool).toBe("withheld");
  }, 60_000);

  it("CONTROL: the open password of a file whose author restricts nothing opens it in every tool", async () => {
    const c: Case = {
      fixture: OPEN_PASSWORD_FIXTURE,
      open: FIXTURE_OPEN_PASSWORD,
    };
    const bytes = readRestrictedFixture(c.fixture.file);
    for (const tool of OWNER_PASSWORD_TOOLS)
      expect((await cellWith(tool, c.open, c, bytes)).why, tool).toBe("opened");
  }, 60_000);
});
