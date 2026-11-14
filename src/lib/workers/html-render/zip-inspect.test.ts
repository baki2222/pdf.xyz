// @vitest-environment jsdom
/**
 * The browser's check of a picked ZIP (`./zip-inspect`), against the
 * worker's own reading of the same bytes (`./zip-site`). Hostile review
 * 2026-11-14 found the check built on JSZip, which inflates whatever a
 * stream yields and keeps the LAST of two same-named entries, while the
 * worker keeps the first: a bomb the user picked could take their tab, and
 * the missing-files note could describe a file the worker never serves.
 * And a stylesheet the page reaches through `@import` was never read, so
 * its missing pictures went unmentioned.
 */
import JSZip from "jszip";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { handZip } from "@/tests/hand-zip";
import { htmlDocumentContentType } from "./charset";
import {
  HTML_ZIP_MAX_ENTRY_RATIO,
  HTML_ZIP_MAX_UNPACKED_BYTES,
  htmlZipRefusalMessage,
} from "./zip-config";
import { inspectHtmlZip, readEntryWithin } from "./zip-inspect";
import { openHtmlZip, zipEntryUrl } from "./zip-site";
import { readZipDirectory } from "../epub/zip-directory";
import { HTML_ZIP_LIMITS } from "./zip-config";

const enc = (s: string) => new TextEncoder().encode(s);
const MIB = 1024 * 1024;
const blob = (bytes: Uint8Array) => new Blob([bytes as BlobPart]);

async function zipOf(files: Record<string, string | Uint8Array>) {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function noteOf(bytes: Uint8Array, entry = "index.html") {
  const inspection = await inspectHtmlZip(blob(bytes));
  if (!inspection.ok) throw new Error(inspection.message);
  return inspection.note(entry);
}

describe("the browser judges a picked ZIP as the worker does", () => {
  it("refuses a bomb by its directory, in the worker's words, before inflating it", async () => {
    // 2 MiB of zeros deflates past 1,000-fold: the worker's ratio refusal.
    const bytes = await zipOf({
      "index.html": "<p>x</p>",
      "zeros.bin": new Uint8Array(2 * MIB),
    });
    expect(openHtmlZip(bytes, undefined, htmlDocumentContentType)).toEqual({
      ok: false,
      refusal: { kind: "bomb", limit: "ratio" },
    });
    expect(await inspectHtmlZip(blob(bytes))).toEqual({
      ok: false,
      message: htmlZipRefusalMessage({ kind: "bomb", limit: "ratio" }),
    });
  });

  it("refuses records that share one data region, as the worker does", async () => {
    const page = enc("<p>x</p>");
    const unpacked = 2 * MIB;
    const packed = new Uint8Array(
      Math.ceil(unpacked / HTML_ZIP_MAX_ENTRY_RATIO),
    );
    packed.set(deflateRawSync(new Uint8Array(unpacked)));
    const bytes = handZip([
      { name: "index.html", data: page, unpacked: page.length, method: 0 },
      { name: "a.bin", data: packed, unpacked, method: 8 },
      { name: "b.bin", at: "a.bin", data: packed, unpacked, method: 8 },
    ]);
    expect(await inspectHtmlZip(blob(bytes))).toEqual({
      ok: false,
      message: htmlZipRefusalMessage({ kind: "unreadable" }),
    });
  });

  it("never inflates past the size the directory declared: a lying entry is stopped, not read", async () => {
    // 1 MiB of zeros, declared as 1 KiB: within every directory bound
    // (under the ratio floor), and a lie the inflate must stop at.
    const stream = deflateRawSync(new Uint8Array(MIB));
    const bytes = handZip([
      { name: "index.html", data: stream, unpacked: 1024, method: 8 },
    ]);
    const read = readZipDirectory(bytes, HTML_ZIP_LIMITS);
    if (!read.ok) throw new Error(read.refusal.why);
    expect(
      await readEntryWithin(bytes, read.directory.entries.get("index.html")!),
    ).toBeNull();
    // POSITIVE CONTROL: the same stream declared at its true size is read.
    const honest = handZip([
      { name: "index.html", data: stream, unpacked: MIB, method: 8 },
    ]);
    const ok = readZipDirectory(honest, HTML_ZIP_LIMITS);
    if (!ok.ok) throw new Error(ok.refusal.why);
    expect(
      (await readEntryWithin(honest, ok.directory.entries.get("index.html")!))
        ?.byteLength,
    ).toBe(MIB);
    // The page check stays quiet on the lie instead of reading it.
    expect(await noteOf(bytes)).toBeNull();
  });

  it("of two entries with one name, describes the FIRST — the one the worker serves", async () => {
    const first = enc('<img src="first-missing.png">');
    const second = enc('<img src="second-missing.png">');
    const bytes = handZip([
      { name: "index.html", data: first, unpacked: first.length, method: 0 },
      { name: "index.html", data: second, unpacked: second.length, method: 0 },
    ]);
    // The worker's answer, read from the worker's own reader.
    const opened = openHtmlZip(bytes, undefined, htmlDocumentContentType);
    if (!opened.ok) throw new Error(opened.refusal.kind);
    expect(
      new TextDecoder().decode(
        opened.site.serve(zipEntryUrl("index.html"))!.body,
      ),
    ).toContain("first-missing.png");
    const note = await noteOf(bytes);
    expect(note).toContain("first-missing.png");
    expect(note).not.toContain("second-missing.png");
  });

  it("refuses a declared total past the bound without reading a byte of it", async () => {
    // Health: the bound this test is about is the one the worker uses.
    expect(HTML_ZIP_LIMITS.maxUnpackedBytes).toBe(HTML_ZIP_MAX_UNPACKED_BYTES);
    const page = enc("<p>x</p>");
    const bytes = handZip([
      { name: "index.html", data: page, unpacked: page.length, method: 0 },
      // Stored, so not a ratio question: only the declared total is past.
      {
        name: "big.bin",
        data: new Uint8Array(0),
        unpacked: HTML_ZIP_MAX_UNPACKED_BYTES,
        method: 0,
      },
    ]);
    expect(await inspectHtmlZip(blob(bytes))).toEqual({
      ok: false,
      message: htmlZipRefusalMessage({ kind: "bomb", limit: "unpacked" }),
    });
  });
});

describe("the missing-files note follows @import, as Chromium does", () => {
  it("names a picture missing from a stylesheet the linked one @imports (url() form)", async () => {
    const bytes = await zipOf({
      "index.html": '<link rel="stylesheet" href="css/a.css"><p>i</p>',
      "css/a.css": "@import url(b.css); p{color:red}",
      "css/b.css": ".x{background:url(../img/missing.png)}",
    });
    expect(await noteOf(bytes)).toContain("../img/missing.png");
  });

  it("follows a quoted @import from an inline <style>, two levels deep, and a cycle ends", async () => {
    const bytes = await zipOf({
      "index.html": '<style>@import "css/a.css";</style><p>i</p>',
      "css/a.css": '@import "b.css";',
      "css/b.css": '@import "a.css"; .y{background:url(deep-gone.png)}',
    });
    expect(await noteOf(bytes)).toContain("deep-gone.png");
  });

  it("POSITIVE CONTROL: the same chain with the picture present says nothing", async () => {
    const bytes = await zipOf({
      "index.html": '<link rel="stylesheet" href="css/a.css"><p>i</p>',
      "css/a.css": "@import url(b.css);",
      "css/b.css": ".x{background:url(../img/here.png)}",
      "img/here.png": "png",
    });
    expect(await noteOf(bytes)).toBeNull();
  });
});
