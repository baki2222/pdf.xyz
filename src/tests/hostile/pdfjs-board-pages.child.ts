// The upload board of every reader:'pdfjs' tool (`readPagesWithPdfjs`, the
// board `use-single-pdf` reads), on page trees of a given shape and size, run
// through runBounded: pdf.js finds each page by walking the tree from its
// root, so a regressed walk over a flat tree runs for minutes, which only a
// child process can be killed out of.
//
//   flat:<pages>      one /Pages node holding every page (what pdf-lib writes)
//   balanced:<pages>  /Pages nodes of 32 kids each, as Acrobat and Word write
//   corpus:<file>     a legit-corpus file: the board pdf.js reads, beside
//                     pdf-lib's reading of the same rotations
//
// and trees whose cost the declared page count does not show (hostile review,
// 2026-11-10; see liarTree, uncountedInner, chainTree, hiddenPadding):
//
//   lie:<count>:<pages>[:<pad>]    /Count <count> over <pages> real pages,
//                                  plus <pad> copies of the first one
//   uncounted:<count>:<pages>      an inner /Pages node with no /Count
//   chain:<pages>                  each node holds [page, next node]
//   objstm|indirect|indirstm|stringy:<count>x<pages>x<pad>
//                                  the padded root hidden from plain text
//
// Every 7th page (index % 7 === 3) carries /Rotate 90, so a board that read
// no rotations (or invented them) is visible in `rotated`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PdfEngineError } from "../../lib/pdf/engine-errors";
import { startMemoryMeter } from "./memory";
import { rawPdf, xrefStreamPdf, type RawObject } from "./page-structure.raw";
import { reportResult } from "./report";

const FAN = 32;

const pageBody = (i: number, parent: number) =>
  `<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 612 792]${i % 7 === 3 ? " /Rotate 90" : ""} >>`;

function flatTree(pages: number): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`);
  const objects: RawObject[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`,
  ];
  for (let i = 0; i < pages; i++) objects.push(pageBody(i, 2));
  return rawPdf({ objects });
}

function balancedTree(pages: number): Uint8Array {
  const parent = new Map<number, number>();
  const body = new Map<number, (p: number) => string>();
  let next = 3;
  let level: { num: number; count: number }[] = [];
  for (let i = 0; i < pages; i++) {
    const num = next++;
    body.set(num, (p) => pageBody(i, p));
    level.push({ num, count: 1 });
  }
  while (level.length > FAN) {
    const up: { num: number; count: number }[] = [];
    for (let at = 0; at < level.length; at += FAN) {
      const kids = level.slice(at, at + FAN);
      const num = next++;
      const count = kids.reduce((n, k) => n + k.count, 0);
      for (const k of kids) parent.set(k.num, num);
      const refs = kids.map((k) => `${k.num} 0 R`).join(" ");
      body.set(
        num,
        (p) =>
          `<< /Type /Pages /Parent ${p} 0 R /Kids [${refs}] /Count ${count} >>`,
      );
      up.push({ num, count });
    }
    level = up;
  }
  for (const k of level) parent.set(k.num, 2);
  const objects: RawObject[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${level.map((k) => `${k.num} 0 R`).join(" ")}] /Count ${pages} >>`,
  ];
  for (let num = 3; num < next; num++) {
    objects.push(body.get(num)!(parent.get(num)!));
  }
  return rawPdf({ objects });
}

/**
 * One /Pages node declaring /Count `count` over `pages` real page objects,
 * followed by `pad` more copies of the first page's reference: the root's
 * /Count is a number the file states about itself, and pdf.js never checks
 * it against the /Kids it walks (hostile review, 2026-11-10).
 */
function liarTree(count: number, pages: number, pad = 0): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`);
  const objects: RawObject[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids.join(" ")}${" 3 0 R".repeat(pad)}] /Count ${count} >>`,
  ];
  for (let i = 0; i < pages; i++) objects.push(pageBody(i, 2));
  return rawPdf({ objects });
}

/**
 * Root /Count `count` over one inner /Pages node with NO /Count holding
 * `pages` pages: pdf.js cannot skip a node whose count it does not know, so
 * every getPage expands it.
 */
function uncountedInner(count: number, pages: number): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 4} 0 R`);
  const objects: RawObject[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [3 0 R] /Count ${count} >>`,
    `<< /Type /Pages /Parent 2 0 R /Kids [${kids.join(" ")}] >>`,
  ];
  for (let i = 0; i < pages; i++) objects.push(pageBody(i, 3));
  return rawPdf({ objects });
}

/**
 * A chain: each /Pages node holds [page_k, node_k+1], every /Count true.
 * getPage(i) descends through i nodes, an awaited fetch at each.
 */
function chainTree(pages: number): Uint8Array {
  const objects: RawObject[] = ["<< /Type /Catalog /Pages 2 0 R >>"];
  for (let k = 0; k < pages; k++) {
    const node = 2 + 2 * k;
    const page = node + 1;
    const parent = k === 0 ? "" : ` /Parent ${node - 2} 0 R`;
    const kids =
      k === pages - 1 ? `${page} 0 R` : `${page} 0 R ${node + 2} 0 R`;
    objects.push(
      `<< /Type /Pages${parent} /Kids [${kids}] /Count ${pages - k} >>`,
    );
    objects.push(pageBody(k, node));
  }
  return rawPdf({ objects });
}

/**
 * The liar's tree with its padded root held where a plain-text search does
 * not see it:
 *
 *   objstm    the root /Pages node packed in a Flate object stream
 *   indirect  the root's /Kids an array OBJECT (`/Kids 3 0 R`), plain text
 *   indirstm  that array object packed in a Flate object stream
 *   stringy   a `]` inside a string element after the real pages, before
 *             the padding (pdf.js pushes it, and never pops it)
 */
function hiddenPadding(
  where: string,
  count: number,
  pages: number,
  pad: number,
): Uint8Array {
  const first = 4; // first page object
  const kids = Array.from({ length: pages }, (_, i) => `${i + first} 0 R`);
  const hide = where === "stringy" ? " (])" : "";
  const padded = `${kids.join(" ")}${hide}${` ${first} 0 R`.repeat(pad)}`;
  const array = `[${padded}]`;
  const root =
    where === "indirect" || where === "indirstm"
      ? `<< /Type /Pages /Kids 3 0 R /Count ${count} >>`
      : `<< /Type /Pages /Kids ${array} /Count ${count} >>`;
  const objects: RawObject[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    root,
    where === "indirect" || where === "indirstm" ? array : "null",
  ];
  for (let i = 0; i < pages; i++) objects.push(pageBody(i, 2));
  if (where === "objstm" || where === "indirstm") {
    return xrefStreamPdf({
      objects,
      pack: [where === "objstm" ? 2 : 3],
      objStmFlate: true,
    });
  }
  return rawPdf({ objects });
}

const CORPUS = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");

async function board(bytes: Uint8Array) {
  const { readPagesWithPdfjs } = await import("../../lib/pdf/pdfjs");
  return readPagesWithPdfjs(bytes);
}

const [kind = "", arg = "", arg2 = "", arg3 = ""] = (
  process.argv[2] ?? ""
).split(":");

void (async () => {
  // pdf.js loads lazily on the first open; that is not this file's cost.
  await board(flatTree(1));
  let bytes: Uint8Array;
  if (kind === "flat") bytes = flatTree(Number(arg));
  else if (kind === "balanced") bytes = balancedTree(Number(arg));
  else if (kind === "lie")
    bytes = liarTree(Number(arg), Number(arg2), Number(arg3 || 0));
  else if (kind === "uncounted")
    bytes = uncountedInner(Number(arg), Number(arg2));
  else if (kind === "chain") bytes = chainTree(Number(arg));
  else if (["objstm", "indirect", "indirstm", "stringy"].includes(kind)) {
    const [count, pages, pad] = arg.split("x").map(Number);
    bytes = hiddenPadding(kind, count!, pages!, pad!);
  } else if (kind === "corpus")
    bytes = new Uint8Array(readFileSync(path.join(CORPUS, arg)));
  else throw new Error(`unknown case ${process.argv[2]}`);
  // Measured from here: the fixture's own build is not the board's cost.
  const meter = startMemoryMeter();
  const t0 = Date.now();
  const measure = () => ({
    bytes: bytes.length,
    ms: Date.now() - t0,
    growthMb: Math.round(meter.growthMb()),
  });
  // What the preflight counted of the page tree (kept per file, so this
  // reads the board's own answer): the test holds each fixture's charge
  // against the bound, so a control AT the bound is shown to be at it.
  const tree = async () => {
    const { preflightPdfjsOpen } = await import("../../lib/pdf/pdfjs-guard");
    return (await preflightPdfjsOpen(bytes).catch(() => null))?.pageTree;
  };
  try {
    const { pageCount, rotations } = await board(bytes);
    const done = measure();
    const extra: Record<string, unknown> = {};
    if (kind === "corpus") {
      const { getPageRotations } = await import("../../lib/pdf/engine");
      extra.pdfLibRotations = await getPageRotations(bytes);
      extra.rotations = rotations;
    }
    reportResult({
      ok: true,
      pageCount,
      rotationCount: rotations.length,
      rotated: rotations.filter((r) => r !== 0).length,
      ...extra,
      ...done,
      tree: await tree(),
    });
  } catch (err) {
    const e = err as { name?: string; message?: string; kind?: string };
    reportResult({
      error: {
        name: e?.name,
        message: e?.message,
        kind: e?.kind,
        typed: err instanceof PdfEngineError,
      },
      ...measure(),
      tree: await tree(),
    });
  }
})();
