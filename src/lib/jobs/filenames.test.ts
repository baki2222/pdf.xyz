import { describe, expect, it } from "vitest";
import {
  MAX_DISPLAY_FILENAME_LENGTH,
  compressedOutputName,
  sanitizeDisplayFilename,
} from "./filenames";

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const DEL = String.fromCharCode(127);
const C1 = String.fromCharCode(0x85); // NEL, a C1 control
const ACUTE = String.fromCharCode(0x301); // combining acute accent (NFD)
const RLO = String.fromCharCode(0x202e); // right-to-left override (bidi spoof)
const ZWSP = String.fromCharCode(0x200b); // zero-width space
const BOM = String.fromCharCode(0xfeff); // zero-width no-break space / BOM

// Non-ASCII fixtures via escapes so the source stays pure ASCII and unambiguous.
const E_ACUTE = "é"; // composed "é"
const REPORT_ACCENT = "r" + E_ACUTE + "port.pdf"; // "réport.pdf" (NFC)
const KEIYAKUSHO = "契約書.pdf"; // Japanese, all non-control

describe("sanitizeDisplayFilename", () => {
  it("keeps an already-clean name intact", () => {
    expect(sanitizeDisplayFilename("report.pdf")).toBe("report.pdf");
    expect(sanitizeDisplayFilename("Q3 Results 2026.pdf")).toBe(
      "Q3 Results 2026.pdf",
    );
  });

  it("strips POSIX and Windows path components, keeping the final segment", () => {
    expect(sanitizeDisplayFilename("/etc/passwd")).toBe("passwd");
    expect(sanitizeDisplayFilename("/var/tmp/report.pdf")).toBe("report.pdf");
    expect(sanitizeDisplayFilename("C:\\Windows\\System32\\evil.pdf")).toBe(
      "evil.pdf",
    );
    expect(sanitizeDisplayFilename("subdir/nested/file.PDF")).toBe("file.pdf");
  });

  it("neutralizes path traversal in every form", () => {
    expect(sanitizeDisplayFilename("../../secret.pdf")).toBe("secret.pdf");
    expect(sanitizeDisplayFilename("..\\..\\secret.pdf")).toBe("secret.pdf");
    // A bare traversal token has no usable name -> the neutral fallback.
    expect(sanitizeDisplayFilename("..")).toBe("document");
    expect(sanitizeDisplayFilename("../")).toBe("document");
    expect(sanitizeDisplayFilename(".")).toBe("document");
  });

  it("removes control characters (NUL, BEL, tab, newline, DEL, C1)", () => {
    expect(sanitizeDisplayFilename("re" + NUL + "port.pdf")).toBe("report.pdf");
    expect(sanitizeDisplayFilename("a" + TAB + "b" + LF + "c.pdf")).toBe(
      "abc.pdf",
    );
    expect(sanitizeDisplayFilename("line" + CR + LF + "break.pdf")).toBe(
      "linebreak.pdf",
    );
    expect(sanitizeDisplayFilename("bell" + BEL + "name.pdf")).toBe(
      "bellname.pdf",
    );
    expect(sanitizeDisplayFilename("del" + DEL + "x.pdf")).toBe("delx.pdf");
    expect(sanitizeDisplayFilename("c1" + C1 + "name.pdf")).toBe("c1name.pdf");
    // A name of only control characters collapses to the fallback.
    expect(sanitizeDisplayFilename(NUL + BEL + DEL)).toBe("document");
  });

  it("strips bidi overrides and zero-width characters (spoof/injection defense)", () => {
    // A right-to-left override is a classic filename spoof; it must not survive.
    const spoof = "annexe" + RLO + "fdp.exe";
    const out = sanitizeDisplayFilename(spoof);
    expect(out).toBe("annexefdp.exe");
    expect(out).not.toContain(RLO);
    // Zero-width space and BOM are removed with no placeholder.
    expect(sanitizeDisplayFilename("in" + ZWSP + "voice.pdf")).toBe(
      "invoice.pdf",
    );
    expect(sanitizeDisplayFilename(BOM + "report.pdf")).toBe("report.pdf");
    // A name of only invisible format characters collapses to the fallback.
    expect(sanitizeDisplayFilename(ZWSP + BOM + RLO)).toBe("document");
  });

  it("removes shell/OS-hostile punctuation without leaving placeholders", () => {
    expect(sanitizeDisplayFilename("my<script>.pdf")).toBe("myscript.pdf");
    expect(sanitizeDisplayFilename('a:b*c?"d".pdf')).toBe("abcd.pdf");
    expect(sanitizeDisplayFilename("pipe|name.pdf")).toBe("pipename.pdf");
  });

  it("preserves and normalizes Unicode (NFC), keeping non-ASCII letters", () => {
    expect(sanitizeDisplayFilename(REPORT_ACCENT)).toBe(REPORT_ACCENT);
    expect(sanitizeDisplayFilename(KEIYAKUSHO)).toBe(KEIYAKUSHO);
    // NFD input (e + combining acute) normalizes to the composed form.
    const nfd = "re" + ACUTE + "sume" + ACUTE + ".pdf";
    const out = sanitizeDisplayFilename(nfd);
    expect(out).toBe(out.normalize("NFC"));
    expect(out.endsWith(".pdf")).toBe(true);
    // Composition fuses each (letter + mark) pair, so the result is shorter.
    expect(out.length).toBeLessThan(nfd.length);
    expect(out).toContain("sum");
  });

  it("bounds a huge name while preserving the extension", () => {
    const huge = "a".repeat(5000) + ".pdf";
    const out = sanitizeDisplayFilename(huge);
    expect(out.length).toBeLessThanOrEqual(MAX_DISPLAY_FILENAME_LENGTH);
    expect(out.endsWith(".pdf")).toBe(true);
    expect(out.startsWith("aaaa")).toBe(true);
  });

  it("handles a missing extension", () => {
    expect(sanitizeDisplayFilename("README")).toBe("README");
    expect(sanitizeDisplayFilename("archive")).toBe("archive");
  });

  it("normalizes the extension (lowercase, alnum only, bounded) on the last dot", () => {
    expect(sanitizeDisplayFilename("Report.PDF")).toBe("Report.pdf");
    // Double extension: only the LAST dot separates the extension.
    expect(sanitizeDisplayFilename("archive.tar.GZ")).toBe("archive.tar.gz");
    expect(sanitizeDisplayFilename("photo.JPEG")).toBe("photo.jpeg");
    // A pathological extension is normalized to its alphanumeric core.
    expect(sanitizeDisplayFilename("file.p*d?f")).toBe("file.pdf");
    // A trailing dot leaves no extension.
    expect(sanitizeDisplayFilename("report.")).toBe("report");
  });

  it("drops leading dots so dotfiles and hidden-name residue can't survive", () => {
    expect(sanitizeDisplayFilename(".env")).toBe("env");
    expect(sanitizeDisplayFilename("...hidden.pdf")).toBe("hidden.pdf");
  });

  it("replaces Windows reserved device names with the fallback stem", () => {
    expect(sanitizeDisplayFilename("CON")).toBe("document");
    expect(sanitizeDisplayFilename("con.pdf")).toBe("document.pdf");
    expect(sanitizeDisplayFilename("NUL.txt")).toBe("document.txt");
    expect(sanitizeDisplayFilename("com1.pdf")).toBe("document.pdf");
    expect(sanitizeDisplayFilename("LPT9.dat")).toBe("document.dat");
    // A reserved word inside a longer stem is fine -- it is not the whole stem.
    expect(sanitizeDisplayFilename("console.pdf")).toBe("console.pdf");
  });

  it("falls back for blank, whitespace-only, and non-string inputs", () => {
    expect(sanitizeDisplayFilename("")).toBe("document");
    expect(sanitizeDisplayFilename("   ")).toBe("document");
    expect(sanitizeDisplayFilename(undefined)).toBe("document");
    expect(sanitizeDisplayFilename(null)).toBe("document");
    expect(sanitizeDisplayFilename(42)).toBe("document");
    expect(sanitizeDisplayFilename({})).toBe("document");
  });

  it("honors a custom fallback stem and max length", () => {
    expect(sanitizeDisplayFilename("", { fallbackStem: "input" })).toBe(
      "input",
    );
    const out = sanitizeDisplayFilename("longname.pdf", { maxLength: 8 });
    expect(out.length).toBeLessThanOrEqual(8);
    expect(out.endsWith(".pdf")).toBe(true);
  });

  it("is idempotent -- sanitizing a sanitized name is a no-op", () => {
    const inputs = ["../../x.PDF", "CON.pdf", "a b.pdf", REPORT_ACCENT];
    for (const raw of inputs) {
      const once = sanitizeDisplayFilename(raw);
      expect(sanitizeDisplayFilename(once)).toBe(once);
    }
  });
});

describe("compressedOutputName", () => {
  it("derives `<base>-compressed.pdf` from the sanitized original", () => {
    expect(compressedOutputName("report.pdf")).toBe("report-compressed.pdf");
    expect(compressedOutputName("Q3 Results.pdf")).toBe(
      "Q3 Results-compressed.pdf",
    );
    expect(compressedOutputName("scan")).toBe("scan-compressed.pdf");
  });

  it("strips paths/traversal and normalizes case before naming", () => {
    expect(compressedOutputName("/tmp/secret.PDF")).toBe(
      "secret-compressed.pdf",
    );
    expect(compressedOutputName("../../etc/report.pdf")).toBe(
      "report-compressed.pdf",
    );
    expect(compressedOutputName("C:\\docs\\Invoice.pdf")).toBe(
      "Invoice-compressed.pdf",
    );
  });

  it("uses the neutral fallback for unusable names", () => {
    expect(compressedOutputName("")).toBe("document-compressed.pdf");
    expect(compressedOutputName("..")).toBe("document-compressed.pdf");
    expect(compressedOutputName("CON.pdf")).toBe("document-compressed.pdf");
    expect(compressedOutputName(undefined)).toBe("document-compressed.pdf");
  });

  it("only strips the final extension (double extensions keep the inner one)", () => {
    expect(compressedOutputName("archive.tar.gz")).toBe(
      "archive.tar-compressed.pdf",
    );
  });

  it("always ends in .pdf and stays within the length bound", () => {
    const out = compressedOutputName("x".repeat(4000) + ".pdf");
    expect(out.endsWith("-compressed.pdf")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(MAX_DISPLAY_FILENAME_LENGTH);
  });
});
