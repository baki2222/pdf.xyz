// @native-canvas
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_PAGE_TEXT,
  RESTRICTED_FIXTURES,
  VIEW_ONLY_FIXTURE,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { exportEditedPdf } from "../editor-export";
import { DEFAULT_TEXT_STYLE, type EditorObject } from "../editor/model";
import { loadPdfLib } from "../pdf-lib";
import { readXref } from "./document";
import { RestrictedChangeError } from "./incremental";
import { openProtectedPdf, type ProtectedPdf } from "./protected-pdf";
import { StandardSecurityHandler } from "./standard-handler";

/**
 * Comments on a restricted PDF: an author who withholds "change the
 * document" (/P bit 4) but grants "add or modify annotations" (/P bit 6,
 * value 32) lets a viewer add highlights and notes. The editor saves them
 * as an incremental update — the original bytes untouched, the page
 * dictionary rewritten with its new /Annots (an annotation change, which
 * the grant covers), its content stream NOT touched, every new object
 * encrypted with the document's own key.
 *
 * Read back by pdf.js, which shares no code with the handler.
 */

async function pdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

interface Read {
  encrypted: boolean;
  permissions: number[] | null;
  annotations: { subtype: string; contents: string }[];
  text: string;
}

async function readAsViewer(bytes: Uint8Array): Promise<Read> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  try {
    const { info } = await doc.getMetadata();
    const page = await doc.getPage(1);
    const annotations = (
      (await page.getAnnotations()) as Record<string, unknown>[]
    ).map((a) => ({
      subtype: String(a.subtype),
      contents: (a.contentsObj as { str?: string } | undefined)?.str ?? "",
    }));
    const content = await page.getTextContent();
    return {
      encrypted:
        (info as { EncryptFilterName?: unknown }).EncryptFilterName != null,
      permissions: await doc.getPermissions(),
      annotations,
      text: content.items.map((i) => ("str" in i ? i.str : "")).join(" "),
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

const NOTE = "Reviewed: restricted comment";

const MARKUPS: EditorObject[] = [
  {
    id: "h",
    kind: "highlight",
    page: 0,
    x: 60,
    y: 60,
    width: 220,
    height: 24,
    color: "#facc15",
    opacity: 0.4,
  },
  {
    id: "n",
    kind: "note",
    page: 0,
    x: 320,
    y: 60,
    width: 180,
    text: NOTE,
    fill: "#fef08a",
    ...DEFAULT_TEXT_STYLE,
    size: 11,
  },
];

async function comment(pdf: ProtectedPdf, objects = MARKUPS) {
  const edited = await exportEditedPdf(pdf.plain, objects, undefined, {
    markups: "comments",
  });
  return pdf.saveChanges(edited.bytes);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(RESTRICTED_FIXTURES)(
  "$file: comments under the author's encryption",
  (fixture) => {
    it("adds a highlight and a note: same encryption and grant, original bytes a prefix, comments read back", async () => {
      expect(fixture.permissions).toContain(32);
      const original = readRestrictedFixture(fixture.file);
      const pdf = await open(fixture.file);
      expect(pdf.canAnnotate).toBe(true);
      const out = await comment(pdf);
      expect(
        Buffer.from(out.bytes.subarray(0, original.length)).equals(
          Buffer.from(original),
        ),
      ).toBe(true);

      const read = await readAsViewer(out.bytes);
      expect(read.encrypted).toBe(true);
      expect(read.permissions).toEqual(fixture.permissions);
      expect(read.annotations.map((a) => a.subtype)).toEqual(
        expect.arrayContaining(["Highlight", "FreeText"]),
      );
      expect(
        read.annotations.find((a) => a.subtype === "FreeText")?.contents,
      ).toBe(NOTE);
      // The page's own text is still there, and the note is not page text.
      expect(read.text).toContain(FIXTURE_PAGE_TEXT);
      expect(read.text).not.toContain(NOTE);

      // The page's content stream was not rewritten: every object the
      // update carries that the original had is the page dictionary or an
      // annotation array — never a stream the page draws.
      const lib = await loadPdfLib();
      const before = await readXref(lib, original);
      const after = await readXref(lib, out.bytes);
      const rewritten = [...after.entries.keys()].filter((n) => {
        const a = after.entries.get(n);
        const b = before.entries.get(n);
        return b && a && a.type === 1 && a.offset >= original.length;
      });
      const doc = await lib.PDFDocument.load(pdf.plain);
      const page = doc.getPage(0);
      const contents = page.node.get(lib.PDFName.of("Contents"));
      const contentNums = new Set<number>();
      if (contents instanceof lib.PDFRef)
        contentNums.add(contents.objectNumber);
      if (contents instanceof lib.PDFArray)
        for (const r of contents.asArray())
          if (r instanceof lib.PDFRef) contentNums.add(r.objectNumber);
      expect(contentNums.size).toBeGreaterThan(0);
      for (const n of rewritten) expect(contentNums.has(n)).toBe(false);
      expect(rewritten).toContain(page.ref.objectNumber);

      // Still restricted, and the owner password is still the owner's.
      const again = await openProtectedPdf(out.bytes);
      expect(again.kind).toBe("opened");
      if (again.kind === "opened")
        expect(await again.pdf.unlock(fixture.owner)).toBe(true);
    });
  },
);

describe("restricted comments: what can fail", () => {
  const fixture = RESTRICTED_FIXTURES[0]!;

  it("CONTROL: the same comments written UNENCRYPTED do not read back", async () => {
    const spy = vi
      .spyOn(StandardSecurityHandler.prototype, "encrypt")
      .mockImplementation(async (_kind, _num, _gen, data) => data);
    const pdf = await open(fixture.file);
    const out = await comment(pdf);
    // The mutation landed: the writer went through the stub.
    expect(spy.mock.calls.length).toBeGreaterThan(3);
    let notes: string[] = [];
    try {
      notes = (await readAsViewer(out.bytes)).annotations
        .filter((a) => a.subtype === "FreeText")
        .map((a) => a.contents);
    } catch {
      notes = [];
    }
    expect(notes).not.toContain(NOTE);
  });

  it("a grant WITHOUT comments (view only): no annotate, and the writer refuses the update", async () => {
    const pdf = await open(VIEW_ONLY_FIXTURE.file);
    expect(VIEW_ONLY_FIXTURE.permissions).not.toContain(32);
    expect(pdf.canAnnotate).toBe(false);
    await expect(comment(pdf)).rejects.toBeInstanceOf(RestrictedChangeError);
  });

  it("comments allowed is not page content allowed: a text box is still refused", async () => {
    const pdf = await open(fixture.file);
    expect(pdf.canAnnotate).toBe(true);
    const edited = await exportEditedPdf(
      pdf.plain,
      [
        ...MARKUPS,
        {
          ...DEFAULT_TEXT_STYLE,
          id: "t1",
          kind: "text",
          page: 0,
          x: 72,
          y: 300,
          width: 200,
          text: "added to the page",
        },
      ],
      undefined,
      { markups: "comments" },
    );
    await expect(pdf.saveChanges(edited.bytes)).rejects.toBeInstanceOf(
      RestrictedChangeError,
    );
  });

  it("a flattened highlight (page content) is refused even though comments are allowed", async () => {
    const pdf = await open(fixture.file);
    const edited = await exportEditedPdf(pdf.plain, MARKUPS);
    await expect(pdf.saveChanges(edited.bytes)).rejects.toBeInstanceOf(
      RestrictedChangeError,
    );
  });
});
