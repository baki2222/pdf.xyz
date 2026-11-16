/**
 * #28 slice 3 (wraps): turn a capture session's JSON lines
 * (`scripts/capture-flow-image.ts`, run inside the worker image) into
 * `src/tests/poppler-samples-image.ts` — every capture as
 * `IMAGE_<NAME>_BBOX = <the xhtml poppler printed>`, byte for byte, plus
 * `IMAGE_CAPTURES`, each capture's kind, generator, shape, page count and
 * the `pdftotext -v` it was taken with.
 *
 * Nothing is trimmed, re-coordinated or CR-stripped: the string literal is
 * `JSON.stringify` of what the binary emitted, and the module is passed
 * through the repository's own Prettier config here, so the committed file
 * IS this script's output (Prettier may change a literal's quotes, never
 * its value; `poppler-samples-image.test.ts` re-reads the capture and
 * compares each export).
 *
 *   npx tsx scripts/write-poppler-image-samples.ts <capture.jsonl>
 *
 * Exit codes: 0 = written; 1 = the capture is malformed (no header, a
 * line that does not parse, a name twice, an empty xhtml).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as prettier from "prettier";

interface Header {
  header: true;
  poppler: string;
  ocrmypdf: string | null;
  tesseract: string | null;
  node: string;
  image: string | null;
  captured: string;
  command: string;
}
interface Capture {
  name: string;
  kind: "synthetic" | "ocr" | "real";
  source: string;
  shape: string;
  pages: number;
  poppler: string;
  xhtml: string;
}

const OUT = "src/tests/poppler-samples-image.ts";

/** A docblock-safe line: no comment terminator can close it early. */
const safe = (text: string) => text.replace(/\*\//g, "*\\/");

async function main(): Promise<number> {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: write-poppler-image-samples.ts <capture.jsonl>");
    return 1;
  }
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const [first, ...rest] = lines.map((l, k) => {
    try {
      return JSON.parse(l) as Header | Capture;
    } catch {
      throw new Error(`line ${k + 1} is not JSON`);
    }
  });
  if (!first || !("header" in first)) {
    console.error("the capture has no header line");
    return 1;
  }
  const header = first;
  const captures = rest as Capture[];
  const seen = new Set<string>();
  for (const c of captures) {
    if (!/^[A-Z0-9_]+$/.test(c.name) || seen.has(c.name) || !c.xhtml) {
      console.error(`malformed capture: ${JSON.stringify(c.name)}`);
      return 1;
    }
    seen.add(c.name);
  }

  const out: string[] = [];
  out.push(
    "/**",
    " * VERBATIM `pdftotext -bbox-layout` output from the PRODUCTION WORKER",
    " * IMAGE's poppler (#28 slice 3, wraps): the first committed captures of",
    " * the binary production jobs meet. Generated; do not hand-edit.",
    " *",
    ` * Captured ${header.captured} in a throwaway container`,
    ` * (\`docker run --rm --network none\`) of ${header.image ?? "an unrecorded image"}`,
    " * — the image the live worker container was running at the time.",
    ` * Command: \`${header.command}\` per page set.`,
    " * `pdftotext -v` (stderr, verbatim):",
    ...header.poppler
      .trimEnd()
      .split("\n")
      .map((l) => ` *   ${safe(l)}`),
    ` * OCR captures: ocrmypdf ${header.ocrmypdf ?? "-"}, ${header.tesseract ?? "-"};`,
    ` * node ${header.node}.`,
    " *",
    " * Regenerate with `scripts/capture-flow-image.ts` (inside the image) +",
    " * `scripts/write-poppler-image-samples.ts <capture.jsonl>`; do not",
    " * hand-edit. Kept apart from `./poppler-samples` (poppler 25.07, the",
    " * Windows dev build): adding these there would move flow.test.ts's",
    " * digest, enrol them in the table detector's exact-tables tests, and",
    " * contradict that module's header.",
    " */",
    "",
  );
  for (const c of captures) {
    out.push(
      `/** \`${safe(c.source)}\` through \`pdftotext -bbox-layout\` on the worker image's poppler (${c.kind}) — ${safe(c.shape)}. */`,
      `export const IMAGE_${c.name}_BBOX = ${JSON.stringify(c.xhtml)};`,
      "",
    );
  }
  out.push(
    "/** What each capture is: kind, generator, shape, pages, and the `pdftotext -v` it was taken with. */",
    "export const IMAGE_CAPTURES: Readonly<",
    "  Record<",
    "    string,",
    "    {",
    '      kind: "synthetic" | "ocr" | "real";',
    "      source: string;",
    "      shape: string;",
    "      pages: number;",
    "      poppler: string;",
    "    }",
    "  >",
    "> = {",
    ...captures.map(
      (c) =>
        `  ${c.name}: ${JSON.stringify({ kind: c.kind, source: c.source, shape: c.shape, pages: c.pages, poppler: c.poppler })},`,
    ),
    "};",
    "",
    "/** The capture session's header line, as the capture script printed it. */",
    `export const IMAGE_CAPTURE_SESSION = ${JSON.stringify({ ...header, file: path.basename(file) })} as const;`,
    "",
  );
  const config = (await prettier.resolveConfig(OUT)) ?? {};
  const formatted = await prettier.format(out.join("\n"), {
    ...config,
    filepath: OUT,
  });
  writeFileSync(OUT, formatted);
  console.log(`wrote ${OUT}: ${captures.length} capture(s) from ${file}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`FAILED — ${(error as Error).message}`);
    process.exit(1);
  },
);
