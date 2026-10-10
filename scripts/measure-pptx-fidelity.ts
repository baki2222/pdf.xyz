/**
 * `pnpm measure:pptx-fidelity` — measure how closely a .pptx made from a PDF
 * looks like that PDF, with the round-trip instrument
 * (`src/lib/workers/pdf-office-export/fidelity.ts`), on any machine with a
 * presentation engine.
 *
 *   pnpm measure:pptx-fidelity <source.pdf> [--export] [--deck name=deck.pptx]…
 *                              [--renderer libreoffice|powerpoint] [--keep dir]
 *
 *   --export     also run this checkout's PDF to PowerPoint engine on the PDF
 *                and measure its deck (named "pdf.xyz").
 *   --deck       measure a deck you already have (a competitor's, an older
 *                export), under a name of your choosing. Repeatable.
 *   --renderer   what turns each deck back into a PDF. `libreoffice` (the
 *                default) is the importer the worker's PowerPoint to PDF runs,
 *                and the one `pnpm worker:pptx-fidelity-proof` holds to the
 *                bound in the worker image; `powerpoint` drives Microsoft
 *                PowerPoint over COM (Windows only), the renderer the bound
 *                was SET from on 2026-10-10 (no LibreOffice was available
 *                then; see FIDELITY_BOUND). Each is labelled in the output. It
 *                opens each deck READ-ONLY with alerts off, saves a PDF copy,
 *                closes it, puts DisplayAlerts back as it found it, and quits
 *                PowerPoint only if it had nothing open.
 *   --keep       keep the round-trip PDFs (and the exported deck) in `dir`.
 *
 * Prints page scores and the bound's verdict: numbers only, never the
 * document's text. A blank deck is always measured beside the others, as the
 * control that must score 1.0 on every page with ink.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compareFidelity,
  FIDELITY_BOUND,
  type FidelityReport,
} from "@/lib/workers/pdf-office-export/fidelity";
import { runPdfOfficeExport } from "@/lib/workers/pdf-office-export/engine";
import { pdfOfficeExportDeps } from "@/lib/workers/pdf-office-export/native";
import { pptxPackage } from "@/lib/workers/pdf-office-export/pptx-package";
import { slideSizeFor } from "@/lib/workers/pdf-office-export/deck-from-scan";
import { nativeOfficeConversionDeps } from "@/lib/workers/office-conversion/native";
import { openNodePdf } from "@/lib/workers/pdf-office-export/pdfjs-node";

const SAVE_AS_PDF = String.raw`
param([string]$ListPath)
$ErrorActionPreference = 'Stop'
$msoTrue = -1; $msoFalse = 0
$app = New-Object -ComObject PowerPoint.Application
$preexisting = $app.Presentations.Count
$alertsBefore = $app.DisplayAlerts
$app.DisplayAlerts = 1 # ppAlertsNone
$done = @()
try {
  foreach ($line in (Get-Content -LiteralPath $ListPath -Encoding UTF8 | Where-Object { $_ })) {
    $pair = ([string]$line).Split('|')
    $p = $app.Presentations.Open($pair[0], $msoTrue, $msoFalse, $msoFalse)
    try { $p.SaveAs($pair[1], 32) } finally { $p.Close() } # 32 = ppSaveAsPDF
    $done += $pair[1]
  }
} finally {
  $app.DisplayAlerts = $alertsBefore
}
$after = [int]$app.DisplayAlerts
if ($preexisting -eq 0 -and $app.Presentations.Count -eq 0) { $app.Quit() }
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
@{ saved = @($done); alertsBefore = [int]$alertsBefore; alertsAfter = $after; version = '' } | ConvertTo-Json -Compress
`;

type Renderer = (decks: { pptx: string; pdf: string }[]) => Promise<void>;

function powerpoint(dir: string): Renderer {
  return async (decks) => {
    if (process.platform !== "win32")
      throw new Error("PowerPoint's COM server exists only on Windows.");
    const script = path.join(dir, "save-as-pdf.ps1");
    const list = path.join(dir, "decks.txt");
    writeFileSync(script, SAVE_AS_PDF, "utf8");
    writeFileSync(
      list,
      decks.map((d) => `${d.pptx}|${d.pdf}`).join("\r\n"),
      "utf8",
    );
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-ListPath",
        list,
      ],
      { encoding: "utf8", timeout: 600_000 },
    );
    const report = JSON.parse(out.slice(out.indexOf("{"))) as {
      saved: string[];
      alertsBefore: number;
      alertsAfter: number;
    };
    if (report.alertsAfter !== report.alertsBefore)
      throw new Error(
        `PowerPoint's DisplayAlerts was ${report.alertsBefore} and is now ${report.alertsAfter}`,
      );
  };
}

function libreoffice(): Renderer {
  const runner = nativeOfficeConversionDeps(process.env).libreoffice;
  return async (decks) => {
    if (!runner) throw new Error("LibreOffice (soffice) is not on PATH.");
    for (const d of decks)
      writeFileSync(
        d.pdf,
        await runner.convertToPdf(
          new Uint8Array(readFileSync(d.pptx)),
          "deck.pptx",
        ),
      );
  };
}

async function blankDeck(source: Uint8Array): Promise<Uint8Array> {
  const { doc, close } = await openNodePdf(source);
  try {
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    const size = slideSizeFor(first.width, first.height);
    return pptxPackage({
      ...size,
      slides: Array.from({ length: doc.numPages }, (_, i) => ({
        name: `Page ${i + 1}`,
        shapes: [],
      })),
    });
  } finally {
    await close();
  }
}

function summary(name: string, r: FidelityReport): string {
  const pictures = Math.max(0, ...r.pictures.map((p) => p.score));
  return `${name.padEnd(14)} ${r.pass ? "PASS" : "FAIL"}  mean ${r.mean.toFixed(3)}  max ${r.max.toFixed(3)}  pictures ${r.pictures.length} max ${pictures.toFixed(3)}  pages ${r.candidatePages}/${r.sourcePages}${r.inconclusive.length ? `  CANNOT CONCLUDE ${r.inconclusive.join(",")}` : ""}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const source = args.find((a) => !a.startsWith("--") && a.endsWith(".pdf"));
  if (!source) throw new Error("usage: measure:pptx-fidelity <source.pdf> …");
  const keep = args.includes("--keep")
    ? args[args.indexOf("--keep") + 1]
    : undefined;
  const dir = keep ?? mkdtempSync(path.join(tmpdir(), "pptx-fidelity-"));
  const rendererName = args.includes("--renderer")
    ? args[args.indexOf("--renderer") + 1]
    : "libreoffice";
  const render =
    rendererName === "powerpoint" ? powerpoint(dir) : libreoffice();
  const pdf = new Uint8Array(readFileSync(source));

  const decks: { name: string; pptx: string; pdf: string }[] = [];
  args.forEach((a, i) => {
    if (a !== "--deck") return;
    const [name, file] = args[i + 1]!.split("=");
    decks.push({
      name: name!,
      pptx: path.resolve(file!),
      pdf: path.join(dir, `${name}.pdf`),
    });
  });
  if (args.includes("--export")) {
    const t0 = Date.now();
    const run = await runPdfOfficeExport(
      "pdf-to-powerpoint",
      pdf,
      pdfOfficeExportDeps(process.env),
    );
    if (!run.ok) throw new Error(`the export failed: ${run.kind}`);
    const file = path.join(dir, "pdf.xyz.pptx");
    writeFileSync(file, run.output);
    console.log(
      `exported in ${Date.now() - t0} ms: ${run.output.length} bytes, ${run.meta.pageCount} slides (engine ${run.meta.engine})`,
    );
    decks.push({
      name: "pdf.xyz",
      pptx: file,
      pdf: path.join(dir, "pdf.xyz.pdf"),
    });
  }
  const blank = path.join(dir, "blank.pptx");
  writeFileSync(blank, await blankDeck(pdf));
  decks.push({
    name: "blank (control)",
    pptx: blank,
    pdf: path.join(dir, "blank.pdf"),
  });

  await render(decks);
  console.log(
    `renderer: ${rendererName}; bound: page ≤ ${FIDELITY_BOUND.page}, mean ≤ ${FIDELITY_BOUND.mean}, picture ≤ ${FIDELITY_BOUND.picture} (set from PowerPoint 16 runs; the worker's proof holds LibreOffice to it)`,
  );
  const reports: [string, FidelityReport][] = [];
  for (const d of decks) {
    const report = await compareFidelity(
      pdf,
      new Uint8Array(readFileSync(d.pdf)),
    );
    reports.push([d.name, report]);
    console.log(summary(d.name, report));
  }
  console.log(
    `\npage  ${reports.map(([n]) => n.slice(0, 10).padStart(11)).join("")}`,
  );
  const pages = reports[0]![1].pages.length;
  for (let i = 0; i < pages; i++)
    console.log(
      `${String(i + 1).padStart(4)}  ${reports.map(([, r]) => r.pages[i]!.score.toFixed(3).padStart(11)).join("")}`,
    );
  console.log(
    `
picture scores (each picture's region alone), per page: ${reports.map(([n]) => n).join(" | ")}`,
  );
  for (let i = 0; i < pages; i++) {
    const cells = reports.map(([, r]) =>
      (r.pages[i]!.pictures ?? []).map((p) => p.score.toFixed(3)).join(" "),
    );
    if (cells.some((c) => c))
      console.log(`${String(i + 1).padStart(4)}  ${cells.join(" | ")}`);
  }
}

main().catch((error: unknown) => {
  console.error(`FAILED — ${(error as Error).message.split("\n")[0]}`);
  process.exit(1);
});
