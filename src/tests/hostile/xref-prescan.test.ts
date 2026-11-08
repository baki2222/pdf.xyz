import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  DICT_SPAN_LIMIT,
  FILE_BYTES_PER_ENTRY,
  XREF_ENTRY_FLOOR,
  ZERO_WIDTH_ROW_LIMIT,
  prescanXref,
  scanBudget,
  xrefEntryLimit,
} from "@/lib/pdf/xref-prescan";
import { encryptPdf } from "@/tests/encrypted-pdf";
import {
  HUGE_ROWS,
  flateRows,
  indexEmptyString,
  prevIndirectInteger,
  recoveryPrev,
} from "./xref-rows.fixtures";
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

  test("SIB-03: rows one byte wide over UNFILTERED data are never refused, whatever the count", () => {
    // pdf.js stops at the end of the data ("Invalid XRef byteWidths"), and
    // unfiltered data is no longer than the file. (History: this read
    // "whatever the count" with no filter qualifier, and was false of a
    // FlateDecode stream: see "the rows pdf.js walks" below.)
    for (const w of ["[1 0 0]", "[0 -1 1]", "[0 0 1.0]"])
      expect(
        prescanXref(
          xrefStreamPdf({ objects: ONE_PAGE, w, index: "[0 2147483647]" }),
        ).unbounded,
        w,
      ).toBe(false);
  });

  test("SIB-03: a section reached by /Prev, with no /Type, is checked", () => {
    const head = rawPdf({ objects: ONE_PAGE });
    // An older section: a stream with no /Type, rows zero bytes wide.
    const olderAt = head.length;
    const older = latin1(
      `9 0 obj
<< /W [0 0 0] /Size 2147483647 /Length 0 >>
stream

endstream
endobj
`,
    );
    const tableAt = olderAt + older.length;
    const tail = latin1(
      `xref
0 1
0000000000 65535 f 
trailer
<< /Size 10 /Root 1 0 R /Prev ${olderAt} >>
startxref
${tableAt}
%%EOF
`,
    );
    expect(prescanXref(concatBytes(head, older, tail)).unbounded).toBe(true);
    // Control: the same chain with rows one byte wide (unfiltered, so the
    // walk ends with the stream's zero bytes).
    const fine = concatBytes(
      head,
      latin1(
        `9 0 obj
<< /W [1 0 0] /Size 2147483647 /Length 0 >>
stream

endstream
endobj
`,
      ),
      tail,
    );
    expect(prescanXref(fine).unbounded).toBe(false);
  });

  // History: this test once also wrote `/Prev ${olderAt} 0 R` (a reference
  // whose NUMBER is the offset) and passed because the scan pushed the
  // reference's number. pdf.js never reads it that way: Dict.get resolves the
  // reference, and the integer OBJECT is the offset. That pinned a branch
  // pdf.js does not have and missed the one it does (review 2, attack d).
  test("SIB-03: an indirect /Prev is read as pdf.js reads it: the integer object it names", () => {
    expect(prescanXref(prevIndirectInteger(HUGE_ROWS)).unbounded).toBe(true);
    expect(prescanXref(prevIndirectInteger(6)).unbounded).toBe(false);
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

describe("SIB-03 (review 2): the rows pdf.js walks, by every route it reads", () => {
  test("SIB-03: /Index written as an empty string is pdf.js's [0 /Size]", () => {
    for (const spelling of ["()", "<>"] as const) {
      expect(
        prescanXref(indexEmptyString(spelling, HUGE_ROWS)).unbounded,
        spelling,
      ).toBe(true);
      expect(
        prescanXref(indexEmptyString(spelling, 6)).unbounded,
        `control ${spelling}`,
      ).toBe(false);
    }
  });

  test("SIB-03: a section only a rebuild reaches (/Prev from a scanned /XRef stream) is checked", () => {
    expect(prescanXref(recoveryPrev(HUGE_ROWS)).unbounded).toBe(true);
    expect(prescanXref(recoveryPrev(6)).unbounded).toBe(false);
  });

  test("SIB-03: rows that each read a byte are bounded too, when a filter can make the bytes", () => {
    // 20,000,000 rows over 20 MB of deflated zeros: a 19,887-byte file that
    // peaked pdf.js at 3,312 MB.
    const bomb = flateRows(20_000_000);
    expect(bomb.length).toBeLessThan(40_000);
    expect(prescanXref(bomb).unbounded).toBe(true);
    // At the bound and one past it (a small file: the floor applies).
    expect(xrefEntryLimit(1_000)).toBe(XREF_ENTRY_FLOOR);
    expect(prescanXref(flateRows(XREF_ENTRY_FLOOR)).unbounded).toBe(false);
    expect(prescanXref(flateRows(XREF_ENTRY_FLOOR + 1)).unbounded).toBe(true);
  });

  test("the entry bound grows with the file", () => {
    expect(xrefEntryLimit(FILE_BYTES_PER_ENTRY * XREF_ENTRY_FLOOR * 4)).toBe(
      4 * XREF_ENTRY_FLOOR,
    );
    expect(xrefEntryLimit(FILE_BYTES_PER_ENTRY * XREF_ENTRY_FLOOR - 1)).toBe(
      XREF_ENTRY_FLOOR,
    );
  });

  // Headroom, against the file-size term (the floor would hide it for files
  // this small): real files spend far more than FILE_BYTES_PER_ENTRY bytes
  // per entry, and lex far less than scanBudget. Measured 2026-11-08: the
  // corpus's densest is 478 bytes an entry and its worst lexing 0.26 of the
  // file; 5,000 pdf-lib pages packed in object streams, 94 bytes an entry,
  // and 0.71 of the file lexed without object streams.
  const headroom = (label: string, bytes: Uint8Array) => {
    const scan = prescanXref(bytes);
    expect(scan.unbounded, label).toBe(false);
    if (scan.streams > 0) {
      // Health check: a ledger that counted nothing passes any bound.
      expect(scan.entries, label).toBeGreaterThan(0);
      expect(bytes.length / scan.entries, label).toBeGreaterThan(
        4 * FILE_BYTES_PER_ENTRY,
      );
    }
    expect(scan.lexed, label).toBeGreaterThan(0);
    expect(scan.lexed, label).toBeLessThan(
      (scanBudget(bytes.length) - scanBudget(0)) / 4,
    );
    return scan;
  };

  test("the corpus sits far under both bounds", () => {
    let streams = 0;
    for (const f of FILES)
      streams += headroom(
        f,
        new Uint8Array(readFileSync(path.join(DIR, f))),
      ).streams;
    // Positive control: the corpus does exercise the stream ledger.
    expect(streams).toBeGreaterThanOrEqual(3);
  });

  test("a dense document sits under both bounds, in both layouts", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 5_000; i += 1)
      doc
        .addPage([200, 200])
        .drawText(`p${i}`, { x: 10, y: 10, size: 8, font });
    for (const useObjectStreams of [true, false]) {
      const scan = headroom(
        `objstm ${useObjectStreams}`,
        await doc.save({ useObjectStreams }),
      );
      if (useObjectStreams) expect(scan.entries).toBeGreaterThan(10_000);
    }
  }, 60_000);
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
