/**
 * The INDEPENDENT readers Translate PDF's language proof judges a printed PDF
 * with — poppler's `pdffonts`, `pdftotext` (UTF-8, and `-bbox`) and
 * `pdftoppm` — run as child processes over a temp file, always cleaned up.
 *
 * Independent of the renderer on purpose: Chromium printing a page says
 * nothing about whether the page carries the script, and pdf-lib (which the
 * renderer uses for metadata) is not a reader of glyphs. These are the tools
 * the worker image already ships (`poppler-utils`, Dockerfile:196).
 *
 * Every parser here is pure and exported, so the unit tests run them over
 * captured output without a binary.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  defaultPdfTextExec,
  resolveOnPath,
  type PdfTextExec,
} from "../pdf-text/native";

/** One row of `pdffonts`. */
export interface PdfFontRow {
  name: string;
  type: string;
  embedded: boolean;
}

/** A word and its left edge, from `pdftotext -bbox`. */
export interface PdfWordBox {
  text: string;
  xMin: number;
}

/** A grey raster of one page, 0 = black. */
export interface GreyRaster {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface PdfProbeReaders {
  fonts(bytes: Uint8Array): Promise<PdfFontRow[]>;
  text(bytes: Uint8Array): Promise<string>;
  words(bytes: Uint8Array): Promise<PdfWordBox[]>;
  /** Absent when this host has no `pdftoppm`: the raster check is skipped. */
  raster?(bytes: Uint8Array, dpi: number): Promise<GreyRaster>;
}

/**
 * `pdffonts` prints fixed-width columns under a row of dashes; the dashes are
 * the only reliable delimiter (a font name has no spaces, a type does).
 */
export function parsePdfFonts(stdout: string): PdfFontRow[] {
  const lines = stdout.split(/\r?\n/);
  const rule = lines.findIndex((l) => /^-+( -+)+\s*$/.test(l));
  if (rule < 0) return [];
  const spans: [number, number][] = [];
  for (const m of lines[rule]!.matchAll(/-+/g))
    spans.push([m.index!, m.index! + m[0].length]);
  const col = (line: string, i: number) =>
    line.slice(spans[i]![0], spans[i]![1]).trim();
  return lines
    .slice(rule + 1)
    .filter((l) => l.trim().length > 0)
    .map((l) => ({
      name: col(l, 0),
      type: col(l, 1),
      embedded: col(l, 3) === "yes",
    }));
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

/** The `<word xMin=…>text</word>` elements of `pdftotext -bbox`, page 1 onward. */
export function parseBboxWords(html: string): PdfWordBox[] {
  const out: PdfWordBox[] = [];
  for (const m of html.matchAll(
    /<word\b[^>]*\bxMin="([\d.]+)"[^>]*>([\s\S]*?)<\/word>/g,
  )) {
    out.push({
      xMin: Number(m[1]),
      text: m[2]!.replace(
        /&(?:amp|lt|gt|quot|apos);/g,
        (e) => XML_ENTITIES[e]!,
      ),
    });
  }
  return out;
}

/** A binary PGM (`P5`, 8-bit) as written by `pdftoppm -gray`. */
export function parsePgm(bytes: Uint8Array): GreyRaster {
  let at = 0;
  const token = (): string => {
    while (at < bytes.length) {
      const c = bytes[at]!;
      if (c === 0x23) {
        while (at < bytes.length && bytes[at] !== 0x0a) at++;
      } else if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) at++;
      else break;
    }
    let s = "";
    while (at < bytes.length && !/\s/.test(String.fromCharCode(bytes[at]!)))
      s += String.fromCharCode(bytes[at++]!);
    return s;
  };
  if (token() !== "P5") throw new Error("not a binary PGM");
  const width = Number(token());
  const height = Number(token());
  const max = Number(token());
  if (!(width > 0 && height > 0 && max > 0 && max < 256))
    throw new Error("unsupported PGM");
  at += 1; // the single whitespace after maxval
  return { width, height, pixels: bytes.subarray(at, at + width * height) };
}

/**
 * Through the pdftotext runner's own subprocess seam (`defaultPdfTextExec`):
 * argv, never a shell, with a timeout and an output ceiling. Not a second
 * `execFile` site, so the worker's spawn guards (`spawn-sites.guard.test.ts`,
 * `engines-honour-abort.test.ts`) see one runner, already driven there.
 */
function run(
  exec: PdfTextExec,
  binary: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<string> {
  return exec(binary, args, {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

async function withPdf<T>(
  bytes: Uint8Array,
  work: (file: string, dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "pdfxyz-tpdf-"));
  try {
    const file = path.join(dir, "in.pdf");
    await writeFile(file, bytes);
    return await work(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The poppler readers on this host's PATH, or null when `pdffonts` or
 * `pdftotext` is missing — the font and text checks are not optional.
 */
export function nativePdfProbeReaders(
  onPath: (binary: string) => boolean = resolveOnPath,
  timeoutMs = 30_000,
  exec: PdfTextExec = defaultPdfTextExec,
): PdfProbeReaders | null {
  if (!onPath("pdffonts") || !onPath("pdftotext")) return null;
  const readers: PdfProbeReaders = {
    fonts: (bytes) =>
      withPdf(bytes, async (file) =>
        parsePdfFonts(await run(exec, "pdffonts", ["--", file], timeoutMs)),
      ),
    text: (bytes) =>
      withPdf(bytes, (file) =>
        run(
          exec,
          "pdftotext",
          ["-enc", "UTF-8", "-q", "--", file, "-"],
          timeoutMs,
        ),
      ),
    words: (bytes) =>
      withPdf(bytes, async (file) =>
        parseBboxWords(
          await run(
            exec,
            "pdftotext",
            ["-bbox", "-enc", "UTF-8", "-q", "--", file, "-"],
            timeoutMs,
          ),
        ),
      ),
  };
  if (onPath("pdftoppm")) {
    readers.raster = (bytes, dpi) =>
      withPdf(bytes, async (file, dir) => {
        await run(
          exec,
          "pdftoppm",
          [
            "-gray",
            "-r",
            String(dpi),
            "-f",
            "1",
            "-l",
            "1",
            "--",
            file,
            path.join(dir, "page"),
          ],
          timeoutMs,
        );
        const name = (await readdir(dir)).find((f) => f.endsWith(".pgm"));
        if (!name) throw new Error("pdftoppm wrote no page");
        return parsePgm(new Uint8Array(await readFile(path.join(dir, name))));
      });
  }
  return readers;
}
