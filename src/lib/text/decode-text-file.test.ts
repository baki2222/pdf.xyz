// @vitest-environment node
/**
 * A .txt or .md file comes out as the text its author wrote — whatever
 * encoding their editor saved it in.
 *
 * The defect: both runners read a picked file with `file.text()`, which is
 * UTF-8 or nothing. A Windows-1252 note became "caf� �q�" and a Notepad
 * "Unicode" save grew U+FFFD and a NUL between every letter, and the PDF was
 * reported as created either way.
 *
 * The corpus is DERIVED where it can be: the Windows-1252 encoder below is the
 * inverse of the platform's own decoder table, so every byte the fallback can
 * meet is exercised, not the three a test author thought of. The byte strings
 * quoted in the finding are kept alongside as excerpts, because an excerpt is
 * what a user's file actually looked like.
 *
 * Every assertion compares against the EXPECTED STRING, never merely "no
 * U+FFFD": an absence check passes when decoding returns "".
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  REPLACEMENT_CHARACTER,
  countReplacementCharacters,
  decodeTextBytes,
  describeDecoding,
  describeReplacementCharacters,
} from "./decode-text-file";
import { textToPdf } from "@/lib/pdf/text-to-pdf";
import { extractPdfText } from "@/lib/pdf/text";

const NUL = String.fromCharCode(0);

/** Every byte the WHATWG Windows-1252 decoder maps, read off the decoder itself. */
function cp1252Table(): Map<string, number> {
  const decoder = new TextDecoder("windows-1252");
  const table = new Map<string, number>();
  for (let byte = 0; byte < 256; byte++) {
    table.set(decoder.decode(new Uint8Array([byte])), byte);
  }
  return table;
}

function encodeCp1252(text: string): Uint8Array {
  const table = cp1252Table();
  return new Uint8Array(
    [...text].map((ch) => {
      const byte = table.get(ch);
      if (byte === undefined) throw new Error(`${ch} is not in Windows-1252`);
      return byte;
    }),
  );
}

function utf16le(text: string, bom: boolean): Uint8Array {
  const body = Buffer.from(text, "utf16le");
  return new Uint8Array(
    bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body,
  );
}

function utf16be(text: string, bom: boolean): Uint8Array {
  const le = Buffer.from(text, "utf16le");
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1]!;
    be[i + 1] = le[i]!;
  }
  return new Uint8Array(
    bom ? Buffer.concat([Buffer.from([0xfe, 0xff]), be]) : be,
  );
}

describe("decodeTextBytes: the file's own encoding, not always UTF-8", () => {
  it("reads the Windows-1252 note from the finding as café “q”", () => {
    // Excerpt: the exact bytes the audit fed through `Blob.text()`.
    const bytes = new Uint8Array([
      0x63, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x71, 0x94,
    ]);
    // The defect, as a positive control on the fixture: UTF-8 decoding of
    // these bytes is what the runner used to show.
    expect(new TextDecoder().decode(bytes)).toContain(REPLACEMENT_CHARACTER);

    const decoded = decodeTextBytes(bytes);
    expect(decoded.text).toBe("café “q”");
    expect(decoded.encoding).toBe("windows-1252");
    expect(decoded.basis).toBe("fallback");
    expect(describeDecoding(decoded)).toMatch(/read as Windows-1252/);
  });

  it("reads a Notepad “Unicode” save (UTF-16LE with a mark) with no mark, no NUL, no U+FFFD", () => {
    // Excerpt: `FF FE 48 00 69 00` from the finding, plus a non-ASCII letter,
    // which is what the old path turned into garbage rather than into NULs.
    const bytes = utf16le("Hi café ✓", true);
    expect(Array.from(bytes.subarray(0, 6))).toEqual([
      0xff, 0xfe, 0x48, 0x00, 0x69, 0x00,
    ]);
    const decoded = decodeTextBytes(bytes);
    expect(decoded.text).toBe("Hi café ✓");
    expect(decoded.encoding).toBe("utf-16le");
    expect(decoded.basis).toBe("bom");
    expect(describeDecoding(decoded)).toBeNull();
  });

  it("reads UTF-16BE with a mark", () => {
    const decoded = decodeTextBytes(utf16be("Grüße → 1", true));
    expect(decoded.text).toBe("Grüße → 1");
    expect(decoded.encoding).toBe("utf-16be");
  });

  it("reads UTF-16 WITHOUT a mark by where its zero bytes sit, and says it guessed", () => {
    const le = decodeTextBytes(utf16le("Hello, world\r\nsecond line é", false));
    expect(le.text).toBe("Hello, world\r\nsecond line é");
    expect(le.encoding).toBe("utf-16le");
    expect(le.basis).toBe("nul-pattern");
    expect(describeDecoding(le)).toMatch(/no byte-order mark.*UTF-16/);

    const be = decodeTextBytes(utf16be("Hello, world", false));
    expect(be.text).toBe("Hello, world");
    expect(be.encoding).toBe("utf-16be");
  });

  it("leaves valid UTF-8 exactly as written (positive controls)", () => {
    for (const text of [
      "café “q”",
      "গোপনীয় নথি\nদ্বিতীয়",
      "plain ascii\r\n\ttab",
      "机密 → ├── x",
    ]) {
      const plain = decodeTextBytes(new TextEncoder().encode(text));
      expect(plain.text, text).toBe(text);
      expect(plain.encoding).toBe("utf-8");
      expect(plain.basis).toBe("valid-utf-8");
      expect(describeDecoding(plain)).toBeNull();

      const withBom = decodeTextBytes(
        new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]),
      );
      expect(withBom.text, `${text} with a UTF-8 mark`).toBe(text);
      expect(withBom.basis).toBe("bom");
    }
    expect(decodeTextBytes(new Uint8Array()).text).toBe("");
  });

  it("round-trips every character Windows-1252 defines above ASCII", () => {
    // Derived from the decoder: 128 high bytes, five of which WHATWG leaves as
    // C1 controls. Bound the corpus so a table that quietly shrank cannot pass.
    const printable = [...cp1252Table().entries()].filter(
      ([ch, byte]) => byte >= 0x80 && ch.charCodeAt(0) > 0x9f,
    );
    expect(printable.length).toBe(123);
    const wrong: string[] = [];
    for (const [ch] of printable) {
      const text = `caf${ch} “${ch}”`;
      const decoded = decodeTextBytes(encodeCp1252(text));
      if (decoded.text !== text || decoded.encoding !== "windows-1252") {
        wrong.push(`${ch} -> ${decoded.text} (${decoded.encoding})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("removes control characters AFTER decoding, and counts them", () => {
    // 0x81 is one of the five bytes WHATWG Windows-1252 maps to a C1 control.
    const decoded = decodeTextBytes(
      new Uint8Array([0x61, 0x81, 0xe9, 0x0c, 0x62]),
    );
    expect(decoded.text).toBe("aéb");
    expect(decoded.removedControls).toBe(2);
    expect(describeDecoding(decoded)).toMatch(
      /2 control characters were removed/,
    );
    // Tab, LF and CR are layout and survive.
    expect(decodeTextBytes(new TextEncoder().encode("a\tb\r\nc")).text).toBe(
      "a\tb\r\nc",
    );
    // A NUL in otherwise-valid UTF-8 is removed and reported, not silently kept.
    const withNul = decodeTextBytes(new TextEncoder().encode(`a${NUL}b`));
    expect(withNul.text).toBe("ab");
    expect(withNul.removedControls).toBe(1);
  });
});

describe("U+FFFD is surfaced whatever path the text came by", () => {
  it("counts and describes replacement characters, and stays silent without them", () => {
    const damaged = `caf${REPLACEMENT_CHARACTER} ${REPLACEMENT_CHARACTER}q${REPLACEMENT_CHARACTER}`;
    expect(countReplacementCharacters(damaged)).toBe(3);
    expect(describeReplacementCharacters(damaged)).toMatch(
      /^3 characters in this text could not be read/,
    );
    expect(describeReplacementCharacters("café")).toBeNull();
  });
});

describe("the composed chain: file bytes -> decoder -> PDF -> text a reader copies out", () => {
  it.each([
    [
      "Windows-1252",
      encodeCp1252("café “quoted” — naïve"),
      "café “quoted” — naïve",
    ],
    [
      "UTF-16LE with a mark",
      utf16le("Hi café — naïve", true),
      "Hi café — naïve",
    ],
  ])(
    "%s",
    async (_label, bytes, expected) => {
      const decoded = decodeTextBytes(bytes);
      const pdf = await textToPdf(decoded.text, { title: "notes" });
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
      const extracted = (await extractPdfText(pdf)).text;
      expect(extracted).toContain(expected);
      expect(countReplacementCharacters(extracted)).toBe(0);
      expect(extracted.includes(NUL)).toBe(false);
    },
    30_000,
  );
});
