/**
 * `pnpm measure:docx-pictures` — measure whether a .docx made from a PDF
 * carries that PDF's pictures, with the Word picture instrument
 * (`src/lib/workers/pdf-office-export/docx-fidelity.ts`): every picture
 * found, its pixels, its size, its place between the text around it.
 *
 *   pnpm measure:docx-pictures <source.pdf> [--export] [--docx name=file.docx]…
 *                              [--keep dir]
 *
 *   --export   also run this checkout's PDF to Word engine on the PDF and
 *              measure its .docx (named "pdf.xyz"). The text is poppler's
 *              reading order where this host's `pdftotext` is poppler; where
 *              it is not (Xpdf has no `-bbox-layout`), it is the pdf.js
 *              stand-in the tests use (`src/tests/poppler-flow-standin.ts`),
 *              and the output SAYS which. The pictures are the real page
 *              reader's either way.
 *   --docx     measure a .docx you already have (a production download, a
 *              competitor's), under a name of your choosing. Repeatable.
 *   --keep     keep the exported .docx in `dir`.
 *
 * Prints counts and scores only, never the document's text. The text-only
 * .docx this tool shipped until 2026-10-17 is always measured beside the
 * others, as the control that must fail.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  compareDocxPictures,
  PIXEL_BOUND,
  type DocxPictureReport,
} from "@/lib/workers/pdf-office-export/docx-fidelity";
import { readDocxBody } from "@/lib/workers/pdf-office-export/docx-read";
import {
  runPdfOfficeExport,
  type PdfOfficeExportDeps,
} from "@/lib/workers/pdf-office-export/engine";
import { pdfOfficeExportDeps } from "@/lib/workers/pdf-office-export/native";
import { docxTextOnly20261017 } from "@/tests/docx-text-only-2026-10-17";
import { flowStandIn } from "@/tests/poppler-flow-standin";

function summary(name: string, r: DocxPictureReport): string {
  return `${name.padEnd(18)} ${r.pass ? "PASS" : "FAIL"}  pictures ${r.matched}/${r.sourcePictures} found (docx holds ${r.docxPictures}, ${r.extras.length} unmatched)  pixels max ${r.maxPixelScore.toFixed(3)}  order checked by text ${r.orderChecked}  wrong size ${r.pictures.filter((p) => p.size && !p.size.ok).length}  out of order ${r.pictures.filter((p) => p.placement && !p.placement.ok).length}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const source = args.find((a) => !a.startsWith("--") && a.endsWith(".pdf"));
  if (!source) throw new Error("usage: measure:docx-pictures <source.pdf> …");
  const keep = args.includes("--keep")
    ? args[args.indexOf("--keep") + 1]
    : undefined;
  if (keep) mkdirSync(keep, { recursive: true });
  const pdf = new Uint8Array(readFileSync(source));
  const docs: { name: string; bytes: Uint8Array }[] = [];
  args.forEach((a, i) => {
    if (a !== "--docx") return;
    const [name, file] = args[i + 1]!.split("=");
    docs.push({ name: name!, bytes: new Uint8Array(readFileSync(file!)) });
  });

  const native = pdfOfficeExportDeps(process.env);
  if (args.includes("--export")) {
    const t0 = Date.now();
    let text = "poppler (pdftotext -bbox-layout)";
    let run = native.extractFlow
      ? await runPdfOfficeExport("pdf-to-word", pdf, native)
      : null;
    if (!run || (!run.ok && run.kind !== "no_text")) {
      text =
        "pdf.js STAND-IN for poppler (this host's pdftotext is not poppler)";
      const deps: PdfOfficeExportDeps = { ...native, extractFlow: flowStandIn };
      run = await runPdfOfficeExport("pdf-to-word", pdf, deps);
    }
    if (!run.ok) throw new Error(`the export failed: ${run.kind}`);
    const body = await readDocxBody(run.output);
    console.log(
      `exported in ${Date.now() - t0} ms: ${run.output.length} bytes, ${run.meta.pageCount} pages, ${body.paragraphs.length} paragraphs, ${body.pictures.length} pictures (${new Set(body.pictures.map((p) => p.part)).size} media parts) — text from ${text}`,
    );
    if (keep) writeFileSync(path.join(keep, "pdf.xyz.docx"), run.output);
    docs.push({ name: "pdf.xyz", bytes: run.output });
  }
  // The control: the text-only file, from the same reading order.
  const flow = await (native.extractFlow ?? flowStandIn)(pdf).catch(() =>
    flowStandIn(pdf),
  );
  docs.push({
    name: "text-only (control)",
    bytes: await docxTextOnly20261017(flow.pages),
  });

  console.log(
    `bound: every source picture found, pixels ≤ ${PIXEL_BOUND} cells out of place, size within 1 pt / 1%, between the text above and below it`,
  );
  for (const d of docs) {
    const report = await compareDocxPictures(pdf, d.bytes);
    console.log(summary(d.name, report));
    const lines = report.pictures
      .map(
        (p) =>
          `  p${String(p.page).padStart(3)}#${p.order + 1} ${p.docx === null ? "MISSING" : "found  "} pixels ${p.pixels === null ? "  -  " : p.pixels.toFixed(3)} size ${p.size ? (p.size.ok ? "ok " : "BAD") : " - "} order ${p.placement ? (p.placement.ok ? (p.placement.anchored ? "ok (by text)" : "ok (page)") : "BAD") : "-"}${p.inconclusive ? `  (${p.inconclusive})` : ""}`,
      )
      .join("\n");
    if (args.includes("--verbose")) console.log(lines);
  }
}

main().catch((error: unknown) => {
  console.error(`FAILED — ${(error as Error).message.split("\n")[0]}`);
  process.exit(1);
});
