/**
 * EPUB files, BUILT here (nothing committed), for EPUB to PDF's tests and
 * proofs: the unit tests, the real-Chromium test, the in-image proof
 * (`pnpm worker:epub-proof`) and the production proof
 * (`pnpm worker:prove-tools`) all convert these same bytes.
 *
 * Each is what the OCF spec asks for: a ZIP whose FIRST entry is `mimetype`,
 * STORED, reading `application/epub+zip`; then `META-INF/container.xml`
 * naming the package; then the package and its files.
 *
 * The chapter files are named so that their ALPHABETICAL order, their
 * MANIFEST order and their SPINE order all differ: a renderer that printed
 * by file name or by manifest would put the marks in the wrong order.
 */
import JSZip from "jszip";
import { deflateSync } from "node:zlib";

import {
  EPUB_CHAPTER_MARKS,
  EPUB_HEADING_RGB,
  EPUB_REMOTE_IMAGE,
  EPUB_SCRIPT_MARK,
  EPUB_TOC_TITLES,
  EPUB_WEB_LINK,
} from "@/lib/workers/epub/proof";

export {
  EPUB_CHAPTER_MARKS,
  EPUB_HEADING_RGB,
  EPUB_REMOTE_IMAGE,
  EPUB_SCRIPT_MARK,
  EPUB_TOC_TITLES,
};

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

/* A 24x24 solid-colour PNG, built: signature, IHDR, IDAT, IEND. */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
export function solidPng(size = 24, rgb: readonly number[] = [20, 120, 220]) {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array(size * (1 + size * 3));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      raw.set(rgb, y * (1 + size * 3) + 1 + x * 3);
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const xhtml = (title: string, body: string, head = "") =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="utf-8"/><title>${title}</title><link rel="stylesheet" type="text/css" href="../Styles/book.css"/>${head}</head>
<body>${body}</body></html>`;

/** A chapter long enough to fill most of an A5 page, so breaks are visible. */
const chapterBody = (i: number, extra = "") =>
  `<h1 id="c${i}">${EPUB_TOC_TITLES[i]}</h1><p>${EPUB_CHAPTER_MARKS[i]}.</p>${extra}` +
  Array.from({ length: 3 }, (_, k) => `<p>Paragraph ${k + 1}.</p>`).join("");

/** Spine order → file name, chosen so alphabetical/manifest order differ. */
const CHAPTER_FILES = ["m-ch.xhtml", "z-ch.xhtml", "a-ch.xhtml"] as const;

export interface Epub3Options {
  /** Print chapters in the REVERSE spine order (a wrong book, for controls). */
  reverseSpine?: boolean;
  /** Leave the stylesheet out of the ZIP. */
  dropCss?: boolean;
  /** Leave the image out of the ZIP. */
  dropImage?: boolean;
  /** Extra entries, by ZIP path. */
  extra?: Record<string, string | Uint8Array>;
  /** Extra entries written STORED (uncompressed), by ZIP path. */
  storedExtra?: Record<string, Uint8Array>;
  /** Replace the spine with these hrefs (relative to OEBPS/). */
  spineHrefs?: string[];
  /** Add META-INF/encryption.xml with this algorithm over one file. */
  encryption?: { algorithm: string; uri: string };
}

async function packageZip(
  entries: Record<string, string | Uint8Array>,
  stored: Record<string, Uint8Array> = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  for (const [path, body] of Object.entries(entries)) zip.file(path, body);
  for (const [path, body] of Object.entries(stored))
    zip.file(path, body, { compression: "STORE" });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/**
 * The EPUB 3 book padded to EXACTLY `bytes` with a stored file of zeros —
 * for the ceiling probes, which must hand the engine a real book AT the
 * stated ceiling (a book's content is read before it is printed, so bytes
 * of nothing are refused for what they are, not for their size).
 */
export async function epubOfSize(bytes: number): Promise<Uint8Array> {
  const pad = "OEBPS/Misc/padding.bin";
  const base = await epub3Book({ storedExtra: { [pad]: new Uint8Array(0) } });
  if (bytes < base.length)
    throw new Error(`the smallest padded book is ${base.length} bytes`);
  const out = await epub3Book({
    storedExtra: { [pad]: new Uint8Array(bytes - base.length) },
  });
  if (out.length !== bytes)
    throw new Error(`padded book is ${out.length} bytes, not ${bytes}`);
  return out;
}

function encryptionXml(algorithm: string, uri: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData>
</encryption>`;
}

/**
 * An EPUB 3 book: three chapters, a nav document, a stylesheet that colours
 * every h1 and starts each chapter on a fresh page, and a PNG in chapter one.
 * Chapter two links the remote image and carries a script.
 */
export async function epub3Book(options: Epub3Options = {}): Promise<Uint8Array> {
  const [r, g, b] = EPUB_HEADING_RGB;
  const order = options.reverseSpine ? [2, 1, 0] : [0, 1, 2];
  const spine = (
    options.spineHrefs ?? order.map((i) => `Text/${CHAPTER_FILES[i]}`)
  )
    .map((href, k) => `<itemref idref="s${k}"/>`)
    .join("");
  const spineItems = (
    options.spineHrefs ?? order.map((i) => `Text/${CHAPTER_FILES[i]}`)
  )
    .map(
      (href, k) =>
        `<item id="s${k}" href="${href}" media-type="application/xhtml+xml"/>`,
    )
    .join("");
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:12345678-1234-4234-8234-123456789abc</dc:identifier>
    <dc:title>The Lanternfly Proof</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-11-06T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="Styles/book.css" media-type="text/css"/>
    <item id="img" href="Images/blue.png" media-type="image/png"/>
    ${spineItems}
  </manifest>
  <spine>${spine}</spine>
</package>`;
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><h1>Contents</h1><ol>
  <li><a href="Text/${CHAPTER_FILES[0]}">${EPUB_TOC_TITLES[0]}</a></li>
  <li><span>Later parts</span><ol>
    <li><a href="Text/${CHAPTER_FILES[1]}#c1">${EPUB_TOC_TITLES[1]}</a></li>
    <li><a href="Text/${encodeURIComponent(CHAPTER_FILES[2])}">${EPUB_TOC_TITLES[2]}</a></li>
  </ol></li>
</ol></nav></body></html>`;
  const chapters: Record<string, string> = {
    [`OEBPS/Text/${CHAPTER_FILES[0]}`]: xhtml(
      "One",
      chapterBody(
        0,
        `<p><img src="../Images/blue.png" alt="blue" style="width:96px;height:96px"/></p>`,
      ),
    ),
    [`OEBPS/Text/${CHAPTER_FILES[1]}`]: xhtml(
      "Two",
      chapterBody(
        1,
        `<p><img src="${EPUB_REMOTE_IMAGE}" alt="remote"/></p><p id="js"></p><script>document.getElementById("js").textContent = "${EPUB_SCRIPT_MARK}";</script>`,
      ),
    ),
    [`OEBPS/Text/${CHAPTER_FILES[2]}`]: xhtml(
      "Three",
      chapterBody(
        2,
        `<p><a href="${CHAPTER_FILES[0]}">Back to the start</a></p><p><a href="${EPUB_WEB_LINK}">An outside link</a></p>`,
      ),
    ),
  };
  const entries: Record<string, string | Uint8Array> = {
    "META-INF/container.xml": CONTAINER,
    "OEBPS/content.opf": opf,
    "OEBPS/nav.xhtml": nav,
    ...chapters,
    ...(options.dropCss
      ? {}
      : {
          "OEBPS/Styles/book.css": `h1 { color: rgb(${r}, ${g}, ${b}); font-size: 20px; }\nbody { font-family: serif; }`,
        }),
    ...(options.dropImage ? {} : { "OEBPS/Images/blue.png": solidPng() }),
    ...(options.encryption
      ? {
          "META-INF/encryption.xml": encryptionXml(
            options.encryption.algorithm,
            options.encryption.uri,
          ),
        }
      : {}),
    ...options.extra,
  };
  return packageZip(entries, options.storedExtra);
}

/** An EPUB 2 book: an NCX table of contents, no nav document. */
export async function epub2Book(): Promise<Uint8Array> {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="uid">urn:isbn:9780000000002</dc:identifier>
    <dc:title>The NCX Proof</dc:title><dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c2" href="two.html" media-type="application/xhtml+xml"/>
    <item id="c1" href="one.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:isbn:9780000000002"/></head>
  <docTitle><text>The NCX Proof</text></docTitle>
  <navMap>
    <navPoint id="p1" playOrder="1"><navLabel><text>${EPUB_TOC_TITLES[0]}</text></navLabel><content src="one.html"/>
      <navPoint id="p1a" playOrder="2"><navLabel><text>Inside one</text></navLabel><content src="one.html#deep"/></navPoint>
    </navPoint>
    <navPoint id="p2" playOrder="3"><navLabel><text>${EPUB_TOC_TITLES[1]}</text></navLabel><content src="two.html"/></navPoint>
  </navMap>
</ncx>`;
  const page = (mark: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body><h1>${mark}</h1><p id="deep">${mark}.</p></body></html>`;
  return packageZip({
    "META-INF/container.xml": CONTAINER.replace(
      "OEBPS/content.opf",
      "content.opf",
    ),
    "content.opf": opf,
    "toc.ncx": ncx,
    "one.html": page(EPUB_CHAPTER_MARKS[0]),
    "two.html": page(EPUB_CHAPTER_MARKS[1]),
  });
}

/** The two font-obfuscation algorithms, and one that is real encryption. */
export const IDPF_FONT_OBFUSCATION = "http://www.idpf.org/2008/embedding";
export const AES_CBC = "http://www.w3.org/2001/04/xmlenc#aes128-cbc";

/** A book whose embedded font is obfuscated (NOT DRM). */
export function fontObfuscatedBook(): Promise<Uint8Array> {
  return epub3Book({
    extra: { "OEBPS/Fonts/body.otf": new Uint8Array(2048).fill(7) },
    encryption: {
      algorithm: IDPF_FONT_OBFUSCATION,
      uri: "OEBPS/Fonts/body.otf",
    },
  });
}

/** A DRM'd book: a chapter encrypted with AES, as encryption.xml says. */
export function drmBook(): Promise<Uint8Array> {
  return epub3Book({
    encryption: { algorithm: AES_CBC, uri: `OEBPS/Text/${CHAPTER_FILES[0]}` },
  });
}

/**
 * A ZIP bomb in an EPUB's clothes: a valid `mimetype`, then one file of 32 MB
 * of zeros, which deflates about a thousandfold.
 */
export function zipBombBook(): Promise<Uint8Array> {
  return epub3Book({
    extra: { "OEBPS/Images/huge.bin": new Uint8Array(32 * 1024 * 1024) },
  });
}

/** A book whose spine names a file above the book's root. */
export function escapingSpineBook(): Promise<Uint8Array> {
  return epub3Book({
    spineHrefs: [`Text/${CHAPTER_FILES[0]}`, "../../outside.xhtml"],
    // The file it climbs to exists at the ZIP's root, so a reader that clamped
    // `..` at the root instead of refusing would find it — and serve it.
    extra: {
      "outside.xhtml": xhtml("Outside", "<p>Outside the book root.</p>"),
    },
  });
}

/** A Word document, named .epub by whoever sends it. */
export async function docxNamedEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
  );
  zip.file("word/document.xml", "<w:document/>");
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/**
 * A fixed-layout (pre-paginated) book: two pages, each declaring a 600x800
 * viewport, laid out absolutely.
 */
export async function fixedLayoutBook(): Promise<Uint8Array> {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:fixed</dc:identifier><dc:title>Fixed</dc:title><dc:language>en</dc:language>
    <meta property="rendition:layout">pre-paginated</meta>
  </metadata>
  <manifest>
    <item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/>
    <item id="p2" href="p2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="p1"/><itemref idref="p2"/></spine>
</package>`;
  const page = (mark: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>p</title><meta name="viewport" content="width=600, height=800"/>
<style>html,body{margin:0;width:600px;height:800px}p{position:absolute;top:20px;left:20px;margin:0}</style></head>
<body><p>${mark}</p></body></html>`;
  return packageZip({
    "META-INF/container.xml": CONTAINER,
    "OEBPS/content.opf": opf,
    "OEBPS/p1.xhtml": page(EPUB_CHAPTER_MARKS[0]),
    "OEBPS/p2.xhtml": page(EPUB_CHAPTER_MARKS[1]),
  });
}
