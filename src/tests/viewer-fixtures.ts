import { rawPdf, type RawObj } from "./hostile/conversion-out.fixtures";

/**
 * The PDF Viewer's proof document, written object by object so every
 * feature the viewer reads is present exactly once and placed where a test
 * can find it:
 *
 *  - three Letter pages, each with a heading line;
 *  - the word {@link VIEWER_PROOF_WORD} MID-LINE on page 3 only (so a
 *    search finds one match, and the highlight must sit inside the line, not
 *    at its start);
 *  - on page 1, a link to page 3 over {@link VIEWER_PROOF_LINK_TEXT}, a web
 *    link, and a `javascript:` link the viewer must drop;
 *  - two bookmarks: "Second page" and "Third page".
 */

export const VIEWER_PROOF_WORD = "zebra";
export const VIEWER_PROOF_LINK_TEXT = "Go to the third page";
export const VIEWER_PROOF_URL = "https://example.com/viewer-proof";
export const VIEWER_PROOF_PAGES = 3;
/** Page 3's line: the word sits after 26 characters, in Helvetica 14 pt. */
export const VIEWER_PROOF_LINE = `The third page holds the ${VIEWER_PROOF_WORD} word in the middle of this line.`;
/** Where page 3's line starts, in PDF points (bottom-left origin). */
export const VIEWER_PROOF_LINE_AT = { x: 72, y: 600, size: 14 };

const HELVETICA = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
const text = (x: number, y: number, size: number, s: string) =>
  `BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET`;

export function viewerProofPdf(): Uint8Array {
  const page = (contents: number, annots = "") =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents ${contents} 0 R ${annots} >>`;
  const objects: RawObj[] = [
    // 1 catalog, 2 pages
    "<< /Type /Catalog /Pages 2 0 R /Outlines 13 0 R /PageMode /UseOutlines >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
    // 3-5 pages
    page(6, "/Annots [10 0 R 11 0 R 12 0 R]"),
    page(7),
    page(8),
    // 6-8 contents
    {
      dict: "",
      stream: [
        text(72, 720, 24, "Viewer proof, page one"),
        text(72, 690, 14, VIEWER_PROOF_LINK_TEXT),
        text(72, 660, 14, "Open the example site"),
        text(72, 630, 14, "A script link that must not be drawn"),
      ].join("\n"),
    },
    {
      dict: "",
      stream: [
        text(72, 720, 24, "Viewer proof, page two"),
        text(72, 690, 14, "Nothing to find on this page."),
      ].join("\n"),
    },
    {
      dict: "",
      stream: [
        text(72, 720, 24, "Viewer proof, page three"),
        text(
          VIEWER_PROOF_LINE_AT.x,
          VIEWER_PROOF_LINE_AT.y,
          VIEWER_PROOF_LINE_AT.size,
          VIEWER_PROOF_LINE,
        ),
      ].join("\n"),
    },
    // 9 font
    HELVETICA,
    // 10 internal link to page 3, 11 web link, 12 script link
    "<< /Type /Annot /Subtype /Link /Rect [72 685 260 706] /Border [0 0 0] /Dest [5 0 R /XYZ 0 792 null] >>",
    `<< /Type /Annot /Subtype /Link /Rect [72 655 260 676] /Border [0 0 0] /A << /S /URI /URI (${VIEWER_PROOF_URL}) >> >>`,
    "<< /Type /Annot /Subtype /Link /Rect [72 625 320 646] /Border [0 0 0] /A << /S /URI /URI (javascript:alert\\(1\\)) >> >>",
    // 13 outline root, 14-15 items
    "<< /Type /Outlines /First 14 0 R /Last 15 0 R /Count 2 >>",
    "<< /Title (Second page) /Parent 13 0 R /Next 15 0 R /Dest [4 0 R /Fit] >>",
    "<< /Title (Third page) /Parent 13 0 R /Prev 14 0 R /Dest [5 0 R /Fit] >>",
  ];
  return rawPdf(objects);
}

/** A one-page PDF whose page holds `n` separate text items. */
export function manyTextItemsPdf(n: number): Uint8Array {
  const ops: string[] = ["BT /F1 2 Tf"];
  for (let i = 0; i < n; i++) {
    const x = 10 + (i % 200) * 3;
    const y = 780 - Math.floor(i / 200) * 2.5;
    ops.push(`1 0 0 1 ${x} ${y.toFixed(1)} Tm (w) Tj`);
  }
  ops.push("ET");
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    { dict: "", stream: ops.join("\n") },
    HELVETICA,
  ]);
}

/** One page whose /Count says 0. */
export function countZeroPdf(): Uint8Array {
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 0 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R >>",
    { dict: "", stream: "0 0 m" },
  ]);
}
