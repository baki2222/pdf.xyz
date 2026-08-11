// @vitest-environment node
/**
 * Pinned against the REAL output of the real binaries, captured on the
 * production worker on 2026-08-11 — not against strings invented here.
 *
 * qpdf 11.3.0 recovering a PDF with its `startxref` removed, and Ghostscript
 * 10.00.0 converting a transparency-bearing PDF with the production PDF/A argv.
 */
import { describe, expect, it } from "vitest";
import { sanitizeNativeDiagnostics } from "./native-diagnostics";

const TMP = "/tmp/pdfxyz-pdfa-ab12";
const PATHS = [`${TMP}/input.pdf`, `${TMP}/output.pdf`, TMP];

describe("real qpdf output", () => {
  // Captured from the deployed worker. Note the doubled colon this used to
  // leave behind: "WARNING: : file is damaged".
  const RAW = [
    `WARNING: ${TMP}/input.pdf: file is damaged`,
    `WARNING: ${TMP}/input.pdf: can't find startxref`,
    `WARNING: ${TMP}/input.pdf: Attempting to reconstruct cross-reference table`,
    "qpdf: operation succeeded with warnings; resulting file may have some problems",
  ].join("\n");

  it("removes the temp path without leaving orphaned punctuation", () => {
    const out = sanitizeNativeDiagnostics(RAW, PATHS, /^\s*qpdf:\s*/i);
    expect(out).toEqual([
      "WARNING: file is damaged",
      "WARNING: can't find startxref",
      "WARNING: Attempting to reconstruct cross-reference table",
      "operation succeeded with warnings; resulting file may have some problems",
    ]);
    // The defect this fixes: a doubled colon, read by someone who has just
    // watched a file break.
    expect(out.join(" ")).not.toMatch(/:\s*:/);
  });

  it("tidies the double space in the offset variant", () => {
    // Also real: "WARNING:  (offset 9999999): xref not found"
    const out = sanitizeNativeDiagnostics(
      `WARNING: ${TMP}/input.pdf (offset 9999999): xref not found`,
      PATHS,
    );
    expect(out).toEqual(["WARNING: (offset 9999999): xref not found"]);
  });
});

describe("real Ghostscript PDF/A output", () => {
  // Captured with the exact production argv, gs 10.00.0, exit 0.
  const RAW = [
    "Text string detected in DOCINFO cannot be represented in XMP for PDF/A1, discarding DOCINFO",
    "Text string detected in DOCINFO cannot be represented in XMP for PDF/A1, discarding DOCINFO",
    `Loading font Helvetica (or substitute) from ${TMP}/Resource/Font/NimbusSans-Regular`,
  ].join("\n");

  it("keeps the deletion notice and drops the line that is all path", () => {
    const out = sanitizeNativeDiagnostics(RAW, PATHS);
    expect(out).toEqual([
      "Text string detected in DOCINFO cannot be represented in XMP for PDF/A1, discarding DOCINFO",
      // The font line named a path outside our temp dir; it fails closed and is
      // counted rather than half-scrubbed.
      "1 further message(s) not shown.",
    ]);
  });

  it("deduplicates the message repeated once per offending object", () => {
    // gs said this twice for one document. The user needs to know metadata was
    // discarded, not how many objects were involved.
    const out = sanitizeNativeDiagnostics(
      "discarding DOCINFO\ndiscarding DOCINFO\ndiscarding DOCINFO",
      [],
    );
    expect(out).toEqual(["discarding DOCINFO"]);
  });
});

describe("the two rules that pull against each other", () => {
  it("drops a line that still holds a path, and counts it", () => {
    const out = sanitizeNativeDiagnostics(
      "/var/other/secret.pdf: something happened\nsomething else happened",
      [TMP],
    );
    expect(out).toEqual([
      "something else happened",
      "1 further message(s) not shown.",
    ]);
  });

  it("counts overflow rather than silently truncating", () => {
    const raw = Array.from({ length: 25 }, (_, i) => `message ${i}`).join("\n");
    const out = sanitizeNativeDiagnostics(raw, []);
    expect(out).toHaveLength(11);
    expect(out[10]).toBe("15 further message(s) not shown.");
  });

  it("returns nothing for a clean run", () => {
    expect(sanitizeNativeDiagnostics("", [])).toEqual([]);
    expect(sanitizeNativeDiagnostics("\n\n  \n", [])).toEqual([]);
  });

  it("does not classify — an unrecognised message still gets through", () => {
    // The whole point: gs and qpdf change their wording between versions, and a
    // classifier that stopped matching would report "nothing happened".
    const out = sanitizeNativeDiagnostics(
      "some future gs release says something nobody predicted",
      [],
    );
    expect(out).toEqual([
      "some future gs release says something nobody predicted",
    ]);
  });
});

describe("the path rule is about paths, not about slashes", () => {
  it("keeps a message whose only slash is a standard's name", () => {
    // The rule's first version dropped this real Ghostscript line whole, because
    // "PDF/A1" has a slash. A rule that deletes the messages it exists to
    // surface is worse than no rule.
    expect(
      sanitizeNativeDiagnostics(
        "cannot be represented in XMP for PDF/A1, discarding DOCINFO",
        [],
      ),
    ).toEqual(["cannot be represented in XMP for PDF/A1, discarding DOCINFO"]);
  });

  // The separators are BUILT, not typed. A backslash in a fixture is one
  // careless escape away from not being a separator at all — `"C:\temp"` is
  // `C:<tab>emp`, and the test would then pass while proving nothing. This is
  // the second time in two tasks; hence the constant.
  const B = String.fromCharCode(92);

  it.each([
    ["absolute posix", "reading from /etc/passwd now"],
    ["windows drive", `reading from C:${B}Users${B}me${B}secret.pdf`],
    ["unc share", `reading from ${B}${B}host${B}share${B}secret.pdf`],
    ["relative fragment", "font from Resource/Font/NimbusSans-Regular"],
  ])("drops a %s path", (_label, line) => {
    expect(sanitizeNativeDiagnostics(line, [])).toEqual([
      "1 further message(s) not shown.",
    ]);
  });
});
