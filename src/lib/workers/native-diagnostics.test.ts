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

/**
 * Ghostscript's WHOLE stdout+stderr, not the interesting part of it.
 *
 * The first version of this file used the two DOCINFO lines alone, because that
 * is what the brief quoted. A faithful excerpt of a stream is NOT a faithful
 * fixture of the stream: run against the real thing, `363f6ab` reported
 * `hadNotes: true` for a conversion that removed nothing and rendered the AGPL
 * notice as the evidence, and from five pages up the per-page lines pushed the
 * one line that mattered into "N further message(s) not shown."
 *
 * PROVENANCE, stated because it decides how much these tests are worth:
 *  - the banner, copyright, licence, "Processing pages 1 through N." and
 *    "Page N" lines are VERBATIM from a clean production run (gs 10.00.0);
 *  - the two DOCINFO lines and the font line are VERBATIM from the
 *    transparency-document run with the production argv;
 *  - the repetition of "Page N" for N > 1 is EXTRAPOLATED from the documented
 *    one-line-per-page behaviour, not separately captured.
 */
const GS_BANNER = [
  "GPL Ghostscript 10.00.0 (2022-09-21)",
  "Copyright (C) 2022 Artifex Software, Inc. All rights reserved.",
  "This software is supplied under the GNU AGPLv3 and comes with NO WARRANTY:",
  "see the file COPYING for full details.",
];

const GS_DELETION_NOTICE =
  "Text string detected in DOCINFO cannot be represented in XMP for PDF/A1, discarding DOCINFO";

/** The whole stream a run produces WITHOUT `-dQUIET`. */
function gsStreamWithoutQuiet(pages: number, deletions: number): string {
  const stdout = [
    ...GS_BANNER,
    `Processing pages 1 through ${pages}.`,
    ...Array.from({ length: pages }, (_, i) => `Page ${i + 1}`),
  ];
  if (deletions > 0) {
    stdout.push(
      `Loading font Helvetica (or substitute) from ${TMP}/Resource/Font/NimbusSans-Regular`,
    );
  }
  const stderr = Array.from({ length: deletions }, () => GS_DELETION_NOTICE);
  return [...stdout, ...stderr].join("\n");
}

/**
 * The whole stream WITH `-dQUIET` — measured on the production worker: stdout
 * empty, stderr unchanged, both deletion notices still present.
 */
function gsStreamWithQuiet(deletions: number): string {
  return Array.from({ length: deletions }, () => GS_DELETION_NOTICE).join("\n");
}

describe("Ghostscript's whole stream, WITHOUT -dQUIET — why the flag is needed", () => {
  it("a CLEAN conversion produces lines that read as 'something was removed'", () => {
    // This is the defect. Every one of these is boilerplate, and `PdfANotes`
    // rendered them under "The converter changed or removed some content."
    const out = sanitizeNativeDiagnostics(gsStreamWithoutQuiet(1, 0), PATHS);
    expect(out.length).toBeGreaterThan(0);
    expect(out.join(" ")).toContain("GPL Ghostscript");
  });

  it("a 20-page conversion buries the deletion notice under page lines", () => {
    const out = sanitizeNativeDiagnostics(gsStreamWithoutQuiet(20, 2), PATHS);
    // The one line that matters does not survive the bound.
    expect(out).not.toContain(GS_DELETION_NOTICE);
    expect(out[out.length - 1]).toMatch(/further message\(s\) not shown/);
  });
});

describe("Ghostscript's whole stream, WITH -dQUIET — the fix", () => {
  it("a CLEAN conversion produces NOTHING, so hadNotes can be false", () => {
    // The `false` case was unreachable before the flag: there was always a
    // banner. "Nothing was removed" only becomes sayable here.
    expect(sanitizeNativeDiagnostics(gsStreamWithQuiet(0), PATHS)).toEqual([]);
  });

  it("a 1-page conversion with a deletion shows the deletion and nothing else", () => {
    expect(sanitizeNativeDiagnostics(gsStreamWithQuiet(2), PATHS)).toEqual([
      GS_DELETION_NOTICE,
    ]);
  });

  it("a 20-page conversion still shows the deletion, not a count", () => {
    // The page lines are gone at the source, so the bound is nowhere near
    // binding and the notice is visible rather than counted.
    const out = sanitizeNativeDiagnostics(gsStreamWithQuiet(2), PATHS);
    expect(out).toEqual([GS_DELETION_NOTICE]);
    expect(out.join(" ")).not.toMatch(/further message/);
  });

  it("deduplicates the notice repeated once per offending object", () => {
    // gs said this twice for one document. The user needs to know metadata was
    // discarded, not how many objects were involved.
    expect(sanitizeNativeDiagnostics(gsStreamWithQuiet(9), PATHS)).toEqual([
      GS_DELETION_NOTICE,
    ]);
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
  it("keeps a PDF NAME OBJECT, which is the shape that actually dominates", () => {
    // The only keep-assertion here used to be `PDF/A1` — and that is the one
    // shape whose slash sits MID-TOKEN, so it survives every rule this file has
    // ever had, including the two that were wrong. It asserted nothing about the
    // family that matters. A leading name object is the real test.
    const text = "WARNING: /Type key should be /Pages but is not; overriding";
    expect(sanitizeNativeDiagnostics(text, [])).toEqual([text]);
  });

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
