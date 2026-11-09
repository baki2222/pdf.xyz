import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { addToPage, annot, apStream } from "./annotation-fixtures";
import { decodedScan, markersFound } from "./pdf-decoded-scan";

/**
 * The byte-absence proofs of Remove Annotations rest on this reader, so it
 * gets its own failure modes pinned. Both below were found in review
 * (2026-11-10): the keyword `stream` and the keyword `endobj` were matched
 * ANYWHERE after an object header, inside literal strings included.
 *
 *  - `stream` inside a string, with no real stream after it: the reader took
 *    a plain dictionary for a stream, found no end, searched for `endobj`
 *    from -1 (the FIRST one in the file), moved its cursor BACKWARDS and
 *    looped until the heap ran out.
 *  - `endobj` inside a string: the object was cut there, and the rest of the
 *    string — where a marker can sit — was never read: a false ABSENCE, the
 *    one result this reader exists to make trustworthy.
 */

async function twoNotes(first: string, second: string, laterStream: boolean) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const ctx = doc.context;
  if (laterStream) {
    addToPage(
      doc,
      0,
      annot(ctx, page.ref, "Square", {
        AP: ctx.obj({ N: apStream(ctx, "LATERSTREAMz2") }),
      }),
    );
  }
  addToPage(doc, 0, annot(ctx, page.ref, "Text", { Contents: first }));
  addToPage(doc, 0, annot(ctx, page.ref, "Text", { Contents: second }));
  return doc.save({ useObjectStreams: false });
}

describe("decodedScan reads keywords as tokens, not as substrings", () => {
  it("a string holding the word `stream`, with no stream after it, is read and the scan ends", async () => {
    const bytes = await twoNotes("see the upstream fix", "HIDDENMARKz1", false);
    // The marker is in the raw bytes (positive control on the fixture).
    expect(Buffer.from(bytes).toString("latin1")).toContain("HIDDENMARKz1");
    expect(markersFound(bytes, ["HIDDENMARKz1"])).toEqual(["HIDDENMARKz1"]);
    const { stats } = decodedScan(bytes);
    expect(stats.objects).toBeGreaterThanOrEqual(5);
  });

  it("a string holding the word `endobj` does not hide the rest of the string", async () => {
    const bytes = await twoNotes("endobj AFTERENDOBJz3", "plain", true);
    expect(markersFound(bytes, ["AFTERENDOBJz3", "LATERSTREAMz2"])).toEqual([
      "AFTERENDOBJz3",
      "LATERSTREAMz2",
    ]);
  });

  it("a real stream is still found and decoded (health check)", async () => {
    const bytes = await twoNotes("a", "b", true);
    const { stats } = decodedScan(bytes);
    expect(stats.streams).toBeGreaterThanOrEqual(1);
    expect(stats.decoded).toBeGreaterThanOrEqual(1);
    expect(markersFound(bytes, ["LATERSTREAMz2"])).toEqual(["LATERSTREAMz2"]);
  });
});
