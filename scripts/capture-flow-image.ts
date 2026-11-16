/**
 * #28 slice 3 (wraps): the capture session. Runs every PDF of
 * `CAPTURE_FIXTURES` (`src/tests/poppler-image-fixtures.ts`) through THIS
 * machine's `pdftotext -bbox-layout -q <in> -` and prints what it emitted,
 * verbatim, one JSON line per capture. Meant to run inside a throwaway
 * container of the worker image (`docker run --rm --network none`), so the
 * poppler that answers is the one production jobs meet; the output becomes
 * `src/tests/poppler-samples-image.ts` through
 * `scripts/write-poppler-image-samples.ts`, unedited.
 *
 * Output, on stdout:
 *  1. a header line: `{ header: true, poppler, ocrmypdf, tesseract, node,
 *     image, captured, command }` — `poppler` is `pdftotext -v`'s stderr
 *     verbatim; `image` is `PDFXYZ_CAPTURE_IMAGE` (the caller passes the
 *     image's digest in; a container cannot see its own);
 *  2. per capture: `{ name, kind, source, shape, pages, poppler, xhtml }`,
 *     `poppler` re-read for each capture so that "one session, one binary"
 *     is a checked relationship, not an assumption.
 * `kind: "ocr"` captures run the generated PDF through `ocrmypdf
 * --force-ocr -l eng` first and capture its output. Optional real PDFs are
 * read from `/real/manifest.json` (`[{ name, file, pages: [n], source }]`)
 * when present; none ship with this session.
 *
 * Exit codes: 0 = everything captured; 1 = a capture failed; 2 = a binary
 * is missing (checked up front, not inferred from a failure).
 */
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readNotoTtf } from "@/lib/pdf/noto-source";
import { setFontByteSource } from "@/lib/pdf/unicode-font";
import { CAPTURE_FIXTURES } from "@/tests/poppler-image-fixtures";

const run = promisify(execFile);
const BIG = 64 * 1024 * 1024;

/** A binary's version banner (stdout and stderr), or null when it will not run. */
async function banner(bin: string, args: string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await run(bin, args, { maxBuffer: BIG });
    return `${stdout}${stderr}`;
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: unknown };
    // `pdftotext -v` exits 0 on poppler 22, non-zero on some builds; a
    // banner on either stream still means the binary ran.
    const text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    return typeof e.code === "number" && text ? text : null;
  }
}

/** `pdftotext -v` exactly as the binary printed it on stderr. */
async function popplerLine(): Promise<string | null> {
  try {
    const { stderr } = await run("pdftotext", ["-v"], { maxBuffer: BIG });
    return stderr;
  } catch (error) {
    const e = error as { stderr?: string; code?: unknown };
    return typeof e.code === "number" && e.stderr ? e.stderr : null;
  }
}

async function bbox(file: string, pages?: readonly number[]): Promise<string> {
  const range =
    pages && pages.length
      ? ["-f", String(Math.min(...pages)), "-l", String(Math.max(...pages))]
      : [];
  const { stdout } = await run(
    "pdftotext",
    ["-bbox-layout", "-q", ...range, file, "-"],
    { maxBuffer: BIG, encoding: "utf8" },
  );
  return stdout;
}

const pageCount = (xhtml: string) => (xhtml.match(/<page\b/g) ?? []).length;

async function main(): Promise<number> {
  // What `src/tests/setup.ts` does for the unit tests: draw non-Latin text in
  // the shipped TTF off disk (the image carries the npm package), not over a
  // network this container does not have.
  setFontByteSource(async (pack) => readNotoTtf(pack));

  const poppler = await popplerLine();
  const ocrmypdf = await banner("ocrmypdf", ["--version"]);
  const tesseract = await banner("tesseract", ["--version"]);
  const needsOcr = Object.values(CAPTURE_FIXTURES).some(
    (f) => f.kind === "ocr",
  );
  if (!poppler || !/poppler|pdftotext/i.test(poppler)) {
    console.error("CANNOT CAPTURE: pdftotext (poppler) is not on PATH");
    return 2;
  }
  if (needsOcr && (!ocrmypdf || !tesseract)) {
    console.error("CANNOT CAPTURE: ocrmypdf or tesseract is not on PATH");
    return 2;
  }
  console.log(
    JSON.stringify({
      header: true,
      poppler,
      ocrmypdf: ocrmypdf?.trim() ?? null,
      tesseract: tesseract?.split("\n")[0]?.trim() ?? null,
      node: process.version,
      image: process.env.PDFXYZ_CAPTURE_IMAGE ?? null,
      captured: new Date().toISOString(),
      command: "pdftotext -bbox-layout -q <in> -",
    }),
  );

  const dir = mkdtempSync(path.join(tmpdir(), "flow-capture-"));
  let failed = 0;
  try {
    for (const [name, fixture] of Object.entries(CAPTURE_FIXTURES)) {
      try {
        const input = path.join(dir, `${name}.pdf`);
        writeFileSync(input, await fixture.build());
        let file = input;
        if (fixture.kind === "ocr") {
          file = path.join(dir, `${name}.ocr.pdf`);
          await run(
            "ocrmypdf",
            ["--force-ocr", "-l", "eng", "-q", input, file],
            {
              maxBuffer: BIG,
            },
          );
        }
        const xhtml = await bbox(file);
        console.log(
          JSON.stringify({
            name,
            kind: fixture.kind,
            source: fixture.source,
            shape: fixture.shape,
            pages: pageCount(xhtml),
            poppler: await popplerLine(),
            xhtml,
          }),
        );
      } catch (error) {
        failed += 1;
        console.error(
          `FAILED ${name}: ${(error as Error).message.split("\n")[0]}`,
        );
      }
    }

    const manifest = "/real/manifest.json";
    if (existsSync(manifest)) {
      const entries = JSON.parse(readFileSync(manifest, "utf8")) as {
        name: string;
        file: string;
        pages: number[];
        source: string;
      }[];
      for (const entry of entries) {
        try {
          const xhtml = await bbox(path.join("/real", entry.file), entry.pages);
          console.log(
            JSON.stringify({
              name: entry.name,
              kind: "real",
              source: entry.source,
              shape: `pages ${entry.pages.join(", ")}`,
              pages: pageCount(xhtml),
              poppler: await popplerLine(),
              xhtml,
            }),
          );
        } catch (error) {
          failed += 1;
          console.error(
            `FAILED ${entry.name}: ${(error as Error).message.split("\n")[0]}`,
          );
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`FAILED — ${(error as Error).message.split("\n")[0]}`);
    process.exit(1);
  },
);
