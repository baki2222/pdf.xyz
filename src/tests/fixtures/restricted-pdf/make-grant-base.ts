/**
 * Step 1 of the GRANT fixture (see `README.md` beside this file): the
 * unencrypted two-page document `make-grant.py` encrypts with pypdf. pdf-lib
 * writes it; the encryption is added by pypdf, never by our own code.
 *
 * Page 1 carries one 8 x 8 RGB picture (an image XObject), so a tool that
 * reads images has something to find; page 2 is text only, so a rotation of
 * one page can be told from a rotation of both.
 *
 *   pnpm exec tsx src/tests/fixtures/restricted-pdf/make-grant-base.ts <out.pdf>
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";

export const GRANT_FIXTURE_TEXT = "RESTRICTED-GRANT-FIXTURE";

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** An 8 x 8 RGB PNG: a red/blue checkerboard. */
export function checkerPng(): Uint8Array {
  const size = 8;
  const rows: number[] = [];
  for (let y = 0; y < size; y += 1) {
    rows.push(0);
    for (let x = 0; x < size; x += 1)
      rows.push(...((x + y) % 2 === 0 ? [220, 30, 30] : [30, 30, 220]));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Uint8Array.from(rows))),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

export async function makeGrantBase(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("pdf.xyz restricted grant fixture");
  doc.setProducer("pdf-lib (pdf.xyz fixture step 1)");
  // Through the one chooser (Western text: the standard sans face).
  const font = await embedDrawingFont(doc, [
    GRANT_FIXTURE_TEXT,
    `${GRANT_FIXTURE_TEXT} page 2`,
  ]);
  const image = await doc.embedPng(checkerPng());
  const first = doc.addPage([612, 792]);
  first.drawText(GRANT_FIXTURE_TEXT, { x: 72, y: 720, size: 18, font });
  first.drawImage(image, { x: 72, y: 560, width: 96, height: 96 });
  const second = doc.addPage([612, 792]);
  second.drawText(`${GRANT_FIXTURE_TEXT} page 2`, {
    x: 72,
    y: 720,
    size: 18,
    font,
  });
  return doc.save({ useObjectStreams: false });
}

const out = process.argv[1]?.endsWith("make-grant-base.ts")
  ? process.argv[2]
  : null;
if (out) void makeGrantBase().then((bytes) => writeFileSync(out, bytes));
