import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  DICT_SPAN_LIMIT,
  ZERO_WIDTH_ROW_LIMIT,
  prescanXref,
} from "@/lib/pdf/xref-prescan";
import { encryptPdf } from "@/tests/encrypted-pdf";
import {
  ONE_PAGE,
  concatBytes,
  latin1,
  rawPdf,
  xrefStreamPdf,
} from "./security-in-browser.fixtures";

// Lane l02, SIB-03 and SIB-09 after review: `xref-prescan.ts` decides which
// cross-reference sections pdf.js reads and whether one would make it walk
// rows that hold no bytes. The scan itself never loops on a count the file
// states, so these run in-process; the pdf.js side of each case runs through
// `runBounded` in `security-bounds.test.ts`.

const DIR = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith(".pdf"))
  .sort();

describe("xref pre-scan: the real-producer corpus (positive control)", () => {
  test("health check: the corpus is all there, and every file yields a section", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(14);
    for (const f of FILES) {
      const scan = prescanXref(new Uint8Array(readFileSync(path.join(DIR, f))));
      // A scan that found no section would pass every assertion below.
      expect(scan.sections, f).toBeGreaterThanOrEqual(1);
      expect(scan.sections, f).toBeLessThan(10_000);
    }
  });

  test("no real file is refused, and none names /Encrypt", () => {
    for (const f of FILES) {
      const scan = prescanXref(new Uint8Array(readFileSync(path.join(DIR, f))));
      expect(scan, f).toMatchObject({ unbounded: false, namesEncrypt: false });
    }
  });

  test("encrypted owner-only, in both layouts, every file names /Encrypt", async () => {
    for (const f of FILES) {
      const plain = new Uint8Array(readFileSync(path.join(DIR, f)));
      for (const objectStreams of [false, true]) {
        const locked = await encryptPdf(plain, {
          ownerPassword: "owner",
          userPassword: "",
          objectStreams,
        });
        const scan = prescanXref(locked);
        expect(scan, `${f} ${objectStreams}`).toMatchObject({
          unbounded: false,
          namesEncrypt: true,
        });
      }
    }
  }, 120_000);
});

describe("SIB-03: the zero-width rule, at its bound and through the chain", () => {
  const zeroWidth = (index: string) =>
    xrefStreamPdf({ objects: ONE_PAGE, w: "[0 0 0]", index });

  test("SIB-03: zero-width rows up to ZERO_WIDTH_ROW_LIMIT are pdf.js's to read; one more is refused", () => {
    expect(ZERO_WIDTH_ROW_LIMIT).toBe(65_536);
    expect(
      prescanXref(zeroWidth(`[0 ${ZERO_WIDTH_ROW_LIMIT}]`)).unbounded,
    ).toBe(false);
    expect(
      prescanXref(zeroWidth(`[0 ${ZERO_WIDTH_ROW_LIMIT + 1}]`)).unbounded,
    ).toBe(true);
    // Rows are summed over every /Index range, as pdf.js walks them.
    expect(prescanXref(zeroWidth("[0 40000 50000 40000]")).unbounded).toBe(
      true,
    );
    // A range pdf.js rejects (not an integer) stops its walk there.
    expect(prescanXref(zeroWidth("[0 6 10 2147483647.5]")).unbounded).toBe(
      false,
    );
  });

  test("SIB-03: rows one byte wide are never refused, whatever the count", () => {
    // pdf.js stops at the end of the data ("Invalid XRef byteWidths").
    for (const w of ["[1 0 0]", "[0 -1 1]", "[0 0 1.0]"])
      expect(
        prescanXref(
          xrefStreamPdf({ objects: ONE_PAGE, w, index: "[0 2147483647]" }),
        ).unbounded,
        w,
      ).toBe(false);
  });

  test("SIB-03: a section reached by /Prev, with no /Type, is checked (and a /Prev written as a reference)", () => {
    for (const asRef of [false, true]) {
      const head = rawPdf({ objects: ONE_PAGE });
      // An older section: a stream with no /Type, rows zero bytes wide.
      const olderAt = head.length;
      const older = latin1(
        `9 0 obj\n<< /W [0 0 0] /Size 2147483647 /Length 0 >>\nstream\n\nendstream\nendobj\n`,
      );
      const tableAt = olderAt + older.length;
      const prev = asRef ? `${olderAt} 0 R` : `${olderAt}`;
      const tail = latin1(
        `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 10 /Root 1 0 R /Prev ${prev} >>\nstartxref\n${tableAt}\n%%EOF\n`,
      );
      const bytes = concatBytes(head, older, tail);
      expect(prescanXref(bytes).unbounded, `asRef ${asRef}`).toBe(true);
      // Control: the same chain with rows one byte wide.
      const fine = concatBytes(
        head,
        latin1(
          `9 0 obj\n<< /W [1 0 0] /Size 2147483647 /Length 0 >>\nstream\n\nendstream\nendobj\n`,
        ),
        tail,
      );
      expect(prescanXref(fine).unbounded, `control asRef ${asRef}`).toBe(false);
    }
  });

  test("SIB-03: a section dictionary that never closes is refused, not skipped", () => {
    const pad = " ".repeat(DICT_SPAN_LIMIT);
    const bytes = xrefStreamPdf({
      objects: ONE_PAGE,
      w: `[0 0 0]`,
      xrefDict: `/Pad [${pad}`,
    });
    expect(prescanXref(bytes).unbounded).toBe(true);
  });
});

describe("SIB-09: the trailer pdf.js decrypts with", () => {
  test("SIB-09: only the newest section counts while it can be read", () => {
    const bytes = rawPdf({ objects: ONE_PAGE });
    expect(prescanXref(bytes).namesEncrypt).toBe(false);
    // An older revision's trailer named /Encrypt; the newest does not.
    const older = concatBytes(
      bytes,
      latin1("trailer\n<< /Size 5 /Root 1 0 R /Encrypt 9 0 R >>\n"),
    );
    // Re-append a startxref that still points at the newest table.
    const at = new TextDecoder("latin1").decode(bytes).lastIndexOf("startxref");
    const offset = /startxref\s+(\d+)/.exec(
      new TextDecoder("latin1").decode(bytes.subarray(at)),
    )![1];
    const withTail = concatBytes(
      older,
      latin1(`startxref\n${offset}\n%%EOF\n`),
    );
    expect(prescanXref(withTail).namesEncrypt).toBe(false);
  });

  test("SIB-09: with no readable newest section, any trailer with /Encrypt counts (pdf.js's rebuild prefers it)", () => {
    const bytes = rawPdf({
      objects: ONE_PAGE,
      startxref: "999999",
      trailer: "/Encrypt 9 0 R",
    });
    expect(prescanXref(bytes).namesEncrypt).toBe(true);
  });
});
