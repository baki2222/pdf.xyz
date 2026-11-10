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
// Every 7th page (index % 7 === 3) carries /Rotate 90, so a board that read
// no rotations (or invented them) is visible in `rotated`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PdfEngineError } from "../../lib/pdf/engine-errors";
import { startMemoryMeter } from "./memory";
import { rawPdf, type RawObject } from "./page-structure.raw";
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

const CORPUS = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");

async function board(bytes: Uint8Array) {
  const { readPagesWithPdfjs } = await import("../../lib/pdf/pdfjs");
  return readPagesWithPdfjs(bytes);
}

const [kind = "", arg = ""] = (process.argv[2] ?? "").split(":");

void (async () => {
  // pdf.js loads lazily on the first open; that is not this file's cost.
  await board(flatTree(1));
  let bytes: Uint8Array;
  if (kind === "flat") bytes = flatTree(Number(arg));
  else if (kind === "balanced") bytes = balancedTree(Number(arg));
  else if (kind === "corpus")
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
    });
  }
})();
