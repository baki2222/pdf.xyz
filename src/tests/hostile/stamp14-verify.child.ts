/**
 * STAMP-14 adversarial verification child. Builds a one-page PDF whose content
 * is `TEXT_OPS` + optional `q 0.1 0 0 0.1 0 0 cm` + `q` x N (never closed), then
 * runs ONE pdfjs phase on it and prints a JSON line. The parent kills it at
 * a time bound, so a hang is a recorded result, not a frozen run.
 *
 * Usage: node --import tsx stamp14-verify.child.ts <text|oplist> <N> <scale:0|1> [order:text-first|q-first]
 */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildPdf, onePageObjects, TEXT_OPS } from "./stamping.fixtures";

const emit = (line: string) =>
  new Promise<void>((resolve) => {
    process.stdout.write(line + "\n", () => resolve());
  });

async function main(): Promise<void> {
  const [phase, nRaw, scaleRaw, order] = process.argv.slice(2) as [
    string,
    string,
    string,
    string | undefined,
  ];
  const n = Number(nRaw);
  const scale = scaleRaw === "1" ? "q 0.1 0 0 0.1 0 0 cm\n" : "";
  const qs = "q\n".repeat(n);
  const content =
    order === "q-first"
      ? `${scale}${qs}${TEXT_OPS}\n`
      : `${TEXT_OPS}\n${scale}${qs}`;
  const bytes =
    process.env.STAMP14_FIXTURE === "conversion-out"
      ? (await import("./conversion-out.fixtures")).unbalancedQPdf()
      : buildPdf({
          objects: onePageObjects("", undefined, content),
        });
  const t0 = performance.now();
  if (phase === "product") {
    const { extractPdfText } = await import("@/lib/pdf/text");
    const legacyReader = () =>
      import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as Promise<
        Pick<typeof import("pdfjs-dist"), "getDocument">
      >;
    const t = await extractPdfText(bytes, legacyReader);
    await emit(
      JSON.stringify({
        phase,
        n,
        sep: process.env.STAMP14_SEP ?? "newline",
        order: order ?? "text-first",
        ms: Math.round(performance.now() - t0),
        text: t.text.slice(0, 40),
      }),
    );
    return;
  }
  if (phase === "text") {
    const { readAsViewer } = await import("../pdfjs-viewer");
    const pages = await readAsViewer(bytes);
    await emit(
      JSON.stringify({
        phase,
        n,
        scale: scaleRaw,
        order: order ?? "text-first",
        ms: Math.round(performance.now() - t0),
        runs: pages[0]?.runs.map((r) => r.str),
      }),
    );
    return;
  }
  // oplist: the canvas render path's parse (what a preview thumbnail does).
  const require = createRequire(import.meta.url);
  const dir = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: bytes.slice(),
    verbosity: 0,
    standardFontDataUrl: `${pathToFileURL(path.join(dir, "standard_fonts")).href}/`,
    useWorkerFetch: false,
    disableFontFace: true,
  }).promise;
  const page = await doc.getPage(1);
  const ops = await page.getOperatorList();
  await emit(
    JSON.stringify({
      phase,
      n,
      scale: scaleRaw,
      order: order ?? "text-first",
      ms: Math.round(performance.now() - t0),
      ops: ops.fnArray.length,
    }),
  );
}

main().then(
  () => process.exit(0),
  async (e) => {
    await emit(JSON.stringify({ error: String((e as Error)?.message ?? e) }));
    process.exit(1);
  },
);
