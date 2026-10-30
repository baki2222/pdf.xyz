// @native-canvas
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  FIXTURE_FIELDS,
  FIXTURE_PAGE_TEXT,
  RESTRICTED_FIXTURES,
  VIEW_ONLY_FIXTURE,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { exportEditedPdf } from "../editor-export";
import { DEFAULT_TEXT_STYLE } from "../editor/model";
import { loadPdfLib } from "../pdf-lib";
import { openHandler, readXref } from "./document";
import { RestrictedChangeError } from "./incremental";
import { openProtectedPdf, type ProtectedPdf } from "./protected-pdf";
import { StandardSecurityHandler } from "./standard-handler";

/**
 * The in-browser Standard security handler, proved against files it did
 * not make (qpdf and pypdf, `src/tests/fixtures/restricted-pdf/`) and read
 * back by a decryptor it does not share code with (pdf.js).
 */

async function pdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

interface ViewerRead {
  encrypted: boolean;
  permissions: number[] | null;
  values: Record<string, unknown>;
  text: string;
}

/** What pdf.js — an independent decryptor — reads with the empty password. */
async function readAsViewer(bytes: Uint8Array): Promise<ViewerRead> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  try {
    const { info } = await doc.getMetadata();
    const fields = (await doc.getFieldObjects()) ?? {};
    const values: Record<string, unknown> = {};
    for (const [name, list] of Object.entries(fields)) {
      const withValue = (list as { value?: unknown }[]).find(
        (f) => f.value !== undefined && f.value !== null,
      );
      values[name] = withValue?.value;
    }
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
    return {
      encrypted:
        (info as { EncryptFilterName?: unknown }).EncryptFilterName != null,
      permissions: await doc.getPermissions(),
      values,
      text,
    };
  } finally {
    await task.destroy();
  }
}

async function open(file: string): Promise<ProtectedPdf> {
  const result = await openProtectedPdf(readRestrictedFixture(file));
  if (result.kind !== "opened")
    throw new Error(`${file}: ${JSON.stringify(result)}`);
  return result.pdf;
}

const FILLS = {
  full_name: "Ada Lovelace",
  email: "ada@example.test",
  agree: true,
  country: "Japan",
} as const;

async function fillAndSave(pdf: ProtectedPdf, fills = FILLS) {
  const edited = await exportEditedPdf(pdf.plain, [], undefined, { fills });
  return pdf.saveChanges(edited.bytes);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(RESTRICTED_FIXTURES)("$file ($producer, V$v R$r)", (fixture) => {
  it("opens with the empty password, as user, with the file's own grant", async () => {
    const bytes = readRestrictedFixture(fixture.file);
    const { handler, params } = await openHandler(bytes);
    expect(handler).not.toBeNull();
    expect(handler!.authenticatedAs).toBe("user");
    expect([params.v, params.r]).toEqual([fixture.v, fixture.r]);
    // What pdf.js reads from the same file.
    expect((await readAsViewer(bytes)).permissions).toEqual(
      fixture.permissions,
    );
  });

  it("derives the right key: the decrypted copy reads like the original", async () => {
    const pdf = await open(fixture.file);
    const viewer = await readAsViewer(readRestrictedFixture(fixture.file));
    const plain = await readAsViewer(pdf.plain);
    expect(plain.encrypted).toBe(false);
    expect(plain.text).toContain(FIXTURE_PAGE_TEXT);
    expect(plain.text).toBe(viewer.text);
    expect(Object.keys(plain.values).sort()).toEqual(
      Object.keys(viewer.values).sort(),
    );
  });

  it("knows its owner password, and only that", async () => {
    const bytes = readRestrictedFixture(fixture.file);
    const { params } = await openHandler(bytes);
    const owner = await StandardSecurityHandler.open(params, fixture.owner);
    expect(owner?.authenticatedAs).toBe("owner");
    expect(
      await StandardSecurityHandler.open(params, `${fixture.owner}-not`),
    ).toBeNull();
    const pdf = await open(fixture.file);
    expect(await pdf.unlock("not-the-owner-password")).toBe(false);
    expect(pdf.unlocked).toBe(false);
    expect(await pdf.unlock("")).toBe(false);
    expect(await pdf.unlock(fixture.owner)).toBe(true);
    expect(pdf.unlocked).toBe(true);
  });

  it("fills the form under the author's encryption: same /Encrypt, same grant", async () => {
    const original = readRestrictedFixture(fixture.file);
    const pdf = await open(fixture.file);
    expect(pdf.canFillForms).toBe(true);
    const out = await fillAndSave(pdf);
    // The original, byte for byte, then the update.
    expect(out.bytes.length).toBeGreaterThan(original.length);
    expect(
      Buffer.from(out.bytes.subarray(0, original.length)).equals(
        Buffer.from(original),
      ),
    ).toBe(true);

    const read = await readAsViewer(out.bytes);
    expect(read.encrypted).toBe(true);
    expect(read.permissions).toEqual(fixture.permissions);
    expect(read.values.full_name).toBe(FILLS.full_name);
    expect(read.values.email).toBe(FILLS.email);
    expect(read.values[FIXTURE_FIELDS.checkbox]).not.toBe("Off");
    expect(read.values.country).toBe(FILLS.country);
    expect(read.text).toContain(FIXTURE_PAGE_TEXT);

    // The /Encrypt the output resolves to is the original's object, and
    // its /O and /U are the original's bytes.
    const lib = await loadPdfLib();
    const before = await readXref(lib, original);
    const after = await readXref(lib, out.bytes);
    const key = lib.PDFName.of("Encrypt");
    expect(String(after.trailer.get(key))).toBe(
      String(before.trailer.get(key)),
    );
    expect(after.trailer.get(lib.PDFName.of("ID"))?.toString()).toBe(
      before.trailer.get(lib.PDFName.of("ID"))?.toString(),
    );
    const encNum = (
      before.trailer.get(key) as unknown as { objectNumber: number }
    ).objectNumber;
    const a = after.entries.get(encNum);
    expect(a?.type === 1 && a.offset).toBeLessThan(original.length);
    const p0 = (await openHandler(original)).params;
    const p1 = (await openHandler(out.bytes)).params;
    expect(Buffer.from(p1.o).equals(Buffer.from(p0.o))).toBe(true);
    expect(Buffer.from(p1.u).equals(Buffer.from(p0.u))).toBe(true);
    expect(p1.p).toBe(p0.p);
    expect(after.usesXrefStream).toBe(before.usesXrefStream);

    // And the copy still opens as restricted, with the owner password
    // still the owner's.
    const again = await openProtectedPdf(out.bytes);
    expect(again.kind).toBe("opened");
    if (again.kind === "opened") {
      expect(await again.pdf.unlock(fixture.owner)).toBe(true);
    }
  });

  it("unlocked with the owner password, saves an unencrypted copy", async () => {
    const pdf = await open(fixture.file);
    expect(await pdf.unlock(fixture.owner)).toBe(true);
    const out = await exportEditedPdf(pdf.plain, [], undefined, {
      fills: FILLS,
    });
    const read = await readAsViewer(out.bytes);
    expect(read.encrypted).toBe(false);
    expect(read.permissions).toBeNull();
    expect(read.values.full_name).toBe(FILLS.full_name);
  });
});

describe("restricted saves: what can fail", () => {
  const fixture = RESTRICTED_FIXTURES[0]!;

  it("CONTROL: the same update written UNENCRYPTED does not read back", async () => {
    // Proves the round-trip assertions above can fail: if the new objects
    // were not encrypted with the document's key, pdf.js would decrypt
    // plaintext into noise and the typed values would not come back.
    const spy = vi
      .spyOn(StandardSecurityHandler.prototype, "encrypt")
      .mockImplementation(async (_kind, _num, _gen, data) => data);
    const pdf = await open(fixture.file);
    const out = await fillAndSave(pdf);
    // The mutation landed: the writer went through the stub.
    expect(spy.mock.calls.length).toBeGreaterThan(3);
    let values: Record<string, unknown> = {};
    try {
      values = (await readAsViewer(out.bytes)).values;
    } catch {
      values = {};
    }
    expect(values.full_name).not.toBe(FILLS.full_name);
    expect(values.email).not.toBe(FILLS.email);
  });

  it("refuses an edit that changes the page, without the owner password", async () => {
    const pdf = await open(fixture.file);
    const edited = await exportEditedPdf(pdf.plain, [
      {
        ...DEFAULT_TEXT_STYLE,
        id: "t1",
        kind: "text",
        page: 0,
        x: 72,
        y: 72,
        width: 200,
        text: "added to the page",
      },
    ]);
    await expect(pdf.saveChanges(edited.bytes)).rejects.toBeInstanceOf(
      RestrictedChangeError,
    );
  });

  it("Fill Forms' writer (applyFormValues, not flattened) saves under the same encryption", async () => {
    const { applyFormValues } = await import("../forms");
    const pdf = await open(fixture.file);
    const filled = await applyFormValues(
      pdf.plain,
      { full_name: "Grace Hopper", agree: true },
      { flatten: false },
    );
    const out = await pdf.saveChanges(filled.bytes);
    const read = await readAsViewer(out.bytes);
    expect(read.encrypted).toBe(true);
    expect(read.permissions).toEqual(fixture.permissions);
    expect(read.values.full_name).toBe("Grace Hopper");
  });

  it("refuses Fill Forms' flatten: it rewrites the page", async () => {
    const { applyFormValues } = await import("../forms");
    const pdf = await open(fixture.file);
    const flat = await applyFormValues(
      pdf.plain,
      { full_name: "Grace Hopper" },
      { flatten: true },
    );
    await expect(pdf.saveChanges(flat.bytes)).rejects.toBeInstanceOf(
      RestrictedChangeError,
    );
  });

  it("a view-only grant does not allow filling", async () => {
    const pdf = await open(VIEW_ONLY_FIXTURE.file);
    expect(pdf.canFillForms).toBe(false);
    expect(pdf.permissions.modify).toBe(false);
    expect(await pdf.unlock(VIEW_ONLY_FIXTURE.owner)).toBe(true);
    expect(pdf.canFillForms).toBe(true);
  });
});
