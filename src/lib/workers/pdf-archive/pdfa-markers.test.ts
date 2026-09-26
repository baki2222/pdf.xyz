import { describe, expect, it } from "vitest";
import { inspectPdfAMarkers, proveDeclaredPdfA } from "./pdfa-markers";
import {
  buildPdfAFixture,
  declaredPdfA,
  withoutOutputIntent,
} from "@/tests/pdfa-fixtures";

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

describe("inspectPdfAMarkers — the declaration a PDF/A intake reads", () => {
  it("POSITIVE CONTROL: accepts the Ghostscript-recipe shape (OutputIntent + XMP part 2 / B)", async () => {
    const report = await inspectPdfAMarkers(await declaredPdfA());
    expect(report).toEqual({
      ok: true,
      problems: [],
      part: "2",
      conformance: "B",
    });
  });

  it("NEGATIVE CONTROL: refuses the pre-fix shape — part 2 claimed, no OutputIntent", async () => {
    // What the audit found the old argv producing: `-dPDFA=2` writes the XMP
    // claim, and nothing supplied the OutputIntent. Everything that checked the
    // output before this module (`looksLikePdf`, the proof's `isPdf`) passed it.
    const bytes = await withoutOutputIntent();
    expect(latin1(bytes).startsWith("%PDF-")).toBe(true); // what used to pass
    const report = await inspectPdfAMarkers(bytes);
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual(["the catalog has no /OutputIntents"]);
  });

  it.each([
    [
      "an output intent that is not PDF/A",
      { intent: "wrong-subtype" as const },
      "no output intent has /S /GTS_PDFA1",
    ],
    [
      "a PDF/A output intent with no ICC profile",
      { intent: "no-profile" as const },
      "the /GTS_PDFA1 output intent has no /DestOutputProfile stream",
    ],
    [
      "no XMP metadata",
      { xmp: null },
      "the catalog has no /Metadata XMP stream",
    ],
    [
      "XMP that claims PDF/A-1",
      { xmp: { part: "1" } },
      "the XMP declares PDF/A part 1, not 2",
    ],
    [
      "XMP that claims conformance U",
      { xmp: { conformance: "U" } },
      "the XMP declares conformance U, not B",
    ],
  ])("refuses %s", async (_label, opts, problem) => {
    const report = await inspectPdfAMarkers(await buildPdfAFixture(opts));
    expect(report.ok).toBe(false);
    expect(report.problems).toContain(problem);
  });

  it.each([
    ["element-form XMP", { xmp: { form: "element" as const } }],
    ["double-quoted attributes", { xmp: { quote: '"' as const } }],
    ["the namespace bound to another prefix", { xmp: { prefix: "id" } }],
    ["Flate-compressed metadata", { compressMetadata: true }],
  ])("accepts %s", async (_label, opts) => {
    const report = await inspectPdfAMarkers(await buildPdfAFixture(opts));
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("reads a catalog hidden in an object stream, where a byte search is blind", async () => {
    const bytes = await buildPdfAFixture({ objectStreams: true });
    // Health check on the fixture itself: if the token were visible as bytes,
    // this case would prove nothing about parsing.
    expect(latin1(bytes)).not.toContain("/OutputIntents");
    expect((await inspectPdfAMarkers(bytes)).ok).toBe(true);
  });

  it("is not fooled by the marker tokens appearing as text elsewhere in the file", async () => {
    const bytes = await buildPdfAFixture({
      intent: "none",
      xmp: null,
      strayMarkerText: true,
    });
    // Health check: a byte search WOULD pass this file.
    const text = latin1(bytes);
    expect(text).toContain("/OutputIntents");
    expect(text).toContain("/GTS_PDFA1");
    expect(text).toContain("pdfaid:part='2'");
    const report = await inspectPdfAMarkers(bytes);
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual([
      "the catalog has no /OutputIntents",
      "the catalog has no /Metadata XMP stream",
    ]);
  });

  it("never throws on bytes that are not a PDF", async () => {
    const report = await inspectPdfAMarkers(new TextEncoder().encode("nope"));
    expect(report.ok).toBe(false);
    expect(report.problems.length).toBeGreaterThan(0);
  });
});

describe("proveDeclaredPdfA — the production proof's verdict", () => {
  it("passes the positive control and names the limit of what it proved", async () => {
    const verdict = await proveDeclaredPdfA(await declaredPdfA());
    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toMatch(/PDF\/A-2b/);
    expect(verdict.detail).toMatch(/not validated/);
  });

  it("fails the pre-fix shape with the reason, not just a boolean", async () => {
    const verdict = await proveDeclaredPdfA(await withoutOutputIntent());
    expect(verdict).toEqual({
      ok: false,
      detail: "the catalog has no /OutputIntents",
    });
  });
});
