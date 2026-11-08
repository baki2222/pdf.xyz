// @native-canvas
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { openProtectedCopy } from "@/components/tools/runner/open-protected";
import { classifyPdfAccess, type PdfjsForAccess } from "@/lib/pdf/encryption";
import { loadPdfLib } from "@/lib/pdf/pdf-lib";
import { readXref } from "@/lib/pdf/security/document";
import { openProtectedPdf } from "@/lib/pdf/security/protected-pdf";
import { objectOffsets } from "./security-bounds.fixtures";
import {
  ONE_PAGE,
  latin1,
  onePageWith,
  ownerOnlyEncrypted,
  rawPdf,
  text,
  xrefStreamPdf,
} from "./security-in-browser.fixtures";

// Lane l02 of the hostile-input matrix: verdicts read from values nobody
// checked. Each case here settles quickly on the old code too (the hangs and
// bombs are in `security-bounds.test.ts`), so they run in-process.

const req = createRequire(import.meta.url);
let pdfjsPromise: Promise<PdfjsForAccess> | null = null;
function pdfjs(): Promise<PdfjsForAccess> {
  pdfjsPromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      req.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href
  ) as Promise<PdfjsForAccess>;
  return pdfjsPromise;
}

async function plainPages(bytes: Uint8Array): Promise<number | string> {
  const r = await openProtectedPdf(bytes);
  if (r.kind !== "opened") return r.kind;
  return (await PDFDocument.load(r.pdf.plain)).getPageCount();
}

/** `bytes` with object `n`'s xref-table offset replaced by object `to`'s. */
function pointXrefAt(bytes: Uint8Array, n: number, to: number): Uint8Array {
  const at = objectOffsets(bytes);
  const t = text(bytes);
  const table = t.lastIndexOf("\nxref\n");
  const row = (o: number) => `${String(o).padStart(10, "0")} 00000 n \n`;
  const from = t.indexOf(row(at.get(n)!), table);
  if (from < 0) throw new Error("row not found");
  const out = bytes.slice();
  out.set(latin1(row(at.get(to)!)), from);
  return out;
}

const T = 30_000;

describe("SIB-02: the xref-stream reader's two bounds, each on its own", () => {
  async function readError(bytes: Uint8Array): Promise<string> {
    try {
      const x = await readXref(await loadPdfLib(), bytes);
      return `entries=${x.entries.size}`;
    } catch (err) {
      return (err as Error).name;
    }
  }

  test(
    "SIB-02: zero-width rows are refused even over a small /Index",
    async () => {
      const bytes = xrefStreamPdf({
        objects: ONE_PAGE,
        w: "[0 0 0]",
        index: "[0 10]",
      });
      expect(await readError(bytes)).toBe("UnreadablePdfError");
    },
    T,
  );

  test(
    "SIB-02: more entries than the file can hold are refused (rows that DO exist)",
    async () => {
      // 200,000 two-byte free rows in a 1 KB file: the bound is 65,536.
      const bytes = xrefStreamPdf({
        objects: ONE_PAGE,
        w: "[1 1 0]",
        index: "[0 200000]",
        xrefBody: new Uint8Array(deflateSync(Buffer.alloc(400_000))),
        xrefDict: "/Filter /FlateDecode",
      });
      expect(bytes.length).toBeLessThan(4096);
      expect(await readError(bytes)).toBe("UnreadablePdfError");
    },
    T,
  );

  test(
    "control: an honest xref stream reads every row",
    async () => {
      expect(await readError(xrefStreamPdf({ objects: ONE_PAGE }))).toBe(
        "entries=6",
      );
    },
    T,
  );
});

describe("SIB-07: an owner-only page that cannot be parsed is never dropped silently", () => {
  test(
    "control: the honest file opens with its one page",
    async () => {
      expect(await plainPages(ownerOnlyEncrypted(ONE_PAGE))).toBe(1);
    },
    T,
  );

  test(
    "control: an xref row pointing at the wrong object is recovered by scanning, page kept",
    async () => {
      const bytes = pointXrefAt(ownerOnlyEncrypted(ONE_PAGE), 3, 2);
      expect(await plainPages(bytes)).toBe(1);
    },
    T,
  );

  for (const box of ["[0 0 1e309 200]", "[0 0 200 --5]"]) {
    test(
      `SIB-07: MediaBox ${box} is refused, not opened as a copy with fewer pages`,
      async () => {
        const bytes = ownerOnlyEncrypted(
          onePageWith({
            3: `<< /Type /Page /Parent 2 0 R /MediaBox ${box} /Contents 4 0 R >>`,
          }),
        );
        const r = await openProtectedPdf(bytes);
        expect(r.kind).toBe("unsupported");
        // The composed chain the editors hit: no empty board for a 1-page file.
        const file = new File([bytes.slice()], "x.pdf", {
          type: "application/pdf",
        });
        expect(await openProtectedCopy(file, bytes, "pdf-lib")).toBeNull();
      },
      T,
    );
  }
});

describe("SIB-08: a page count is a positive integer, or no verdict", () => {
  for (const count of ["-1", "0"]) {
    test(
      `SIB-08: /Count ${count} on an owner-only file is not reported as ${count} pages`,
      async () => {
        const bytes = ownerOnlyEncrypted(
          onePageWith({
            2: `<< /Type /Pages /Kids [3 0 R] /Count ${count} >>`,
          }),
        );
        const access = await classifyPdfAccess(bytes, await pdfjs());
        expect(access).toEqual({ kind: "unreadable" });
      },
      T,
    );
  }

  test(
    "control: /Count 1 is restricted with 1 page",
    async () => {
      const access = await classifyPdfAccess(
        ownerOnlyEncrypted(ONE_PAGE),
        await pdfjs(),
      );
      expect(access).toEqual({ kind: "restricted", pageCount: 1 });
    },
    T,
  );
});

describe("SIB-09: a trailer that names /Encrypt is never reported as unencrypted", () => {
  test(
    "SIB-09: a dangling /Encrypt 77 0 R is unreadable",
    async () => {
      const bytes = ownerOnlyEncrypted(ONE_PAGE, {
        encryptEntry: () => "77 0 R",
      });
      expect(text(bytes)).toContain("/Encrypt 77 0 R");
      const access = await classifyPdfAccess(bytes, await pdfjs());
      expect(access).toEqual({ kind: "unreadable" });
    },
    T,
  );

  test(
    "SIB-09: an /Encrypt that refers to a bare reference is unreadable",
    async () => {
      const bytes = ownerOnlyEncrypted([...ONE_PAGE, "5 0 R"], {
        encryptEntry: () => "5 0 R",
      });
      const access = await classifyPdfAccess(bytes, await pdfjs());
      expect(access).toEqual({ kind: "unreadable" });
    },
    T,
  );

  test(
    "control: a plain file is unencrypted, and so is one that says /Encrypt only in a page",
    async () => {
      const lib = await pdfjs();
      expect(
        await classifyPdfAccess(rawPdf({ objects: ONE_PAGE }), lib),
      ).toEqual({ kind: "unencrypted", pageCount: 1 });
      const words = rawPdf({
        objects: onePageWith({
          4: { dict: "", stream: latin1("BT (/Encrypt 5 0 R) Tj ET") },
        }),
      });
      expect(await classifyPdfAccess(words, lib)).toEqual({
        kind: "unencrypted",
        pageCount: 1,
      });
    },
    T,
  );
});

describe("SIB-15: a structural failure is not a password verdict", () => {
  for (const [name, opts] of [
    ["/N 100000", { objStmN: "100000" }],
    ["/First 999999", { objStmFirst: "999999" }],
  ] as const) {
    test(
      `SIB-15: an owner-only object stream with ${name} is not 'password-required'`,
      async () => {
        const bytes = ownerOnlyEncrypted(ONE_PAGE, {
          pack: [1, 2, 3],
          ...opts,
        });
        const access = await classifyPdfAccess(bytes, await pdfjs());
        expect(access.kind).not.toBe("password-required");
        expect(access).toEqual({ kind: "unreadable" });
      },
      T,
    );
  }

  test(
    "control: an honest owner-only object stream is restricted",
    async () => {
      const bytes = ownerOnlyEncrypted(ONE_PAGE, { pack: [1, 2, 3] });
      expect(await classifyPdfAccess(bytes, await pdfjs())).toEqual({
        kind: "restricted",
        pageCount: 1,
      });
    },
    T,
  );

  test(
    "control: a file that really has a user password stays password-required",
    async () => {
      for (const pack of [undefined, [1, 2, 3]]) {
        const bytes = ownerOnlyEncrypted(ONE_PAGE, {
          user: "secret",
          ...(pack ? { pack } : {}),
        });
        expect(await classifyPdfAccess(bytes, await pdfjs())).toEqual({
          kind: "password-required",
        });
      }
    },
    T,
  );
});

describe("SIB-03 / SIB-06: the pdf.js open has a deadline", () => {
  /** A pdf.js whose open never settles, recording whether it was destroyed. */
  function stuckPdfjs() {
    const state = { destroyed: 0 };
    const lib = {
      getDocument: () => ({
        promise: new Promise<never>(() => {}),
        destroy: async () => {
          state.destroyed += 1;
        },
      }),
      PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
    } as unknown as PdfjsForAccess;
    return { lib, state };
  }

  test(
    "SIB-03: an open that never settles is unreadable at the deadline, and the task is destroyed",
    async () => {
      const { lib, state } = stuckPdfjs();
      const t0 = Date.now();
      const access = await classifyPdfAccess(
        ownerOnlyEncrypted(ONE_PAGE),
        lib,
        {
          deadlineMs: 50,
        },
      );
      expect(access).toEqual({ kind: "unreadable" });
      expect(state.destroyed).toBeGreaterThan(0);
      expect(Date.now() - t0).toBeLessThan(5_000);
    },
    T,
  );

  test(
    "control: a real open well inside the deadline is unaffected",
    async () => {
      const access = await classifyPdfAccess(
        ownerOnlyEncrypted(ONE_PAGE),
        await pdfjs(),
        { deadlineMs: 20_000 },
      );
      expect(access).toEqual({ kind: "restricted", pageCount: 1 });
    },
    T,
  );
});
