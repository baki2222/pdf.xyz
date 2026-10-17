/**
 * `pnpm prove:docx-opens` — does Microsoft Word open what PDF to Word writes,
 * and does it see the pictures where the export put them?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * On 2026-10-17 PDF to Word began writing pictures (`wp:inline` drawings,
 * `word/media`, a sized section) into a package that had held only text.
 * `./src/lib/workers/pdf-office-export/docx-read.ts` reads that package back
 * the way the engine's own check and the instruments do; it is not Word. The
 * property a user needs — "it opens in Word, with the pictures in it" — has
 * one instrument, Word, and this script drives it where it is installed:
 * Windows with desktop Office, through the COM `Documents.Open` a
 * double-click ends up in.
 *
 * ── WHAT IT RUNS ────────────────────────────────────────────────────────────
 *
 *   SUBJECT   each committed Word picture fixture through the worker's own
 *             processor and page reader. Word must open each, and report the
 *             fixture's sequence — paragraphs and pictures, page by page, in
 *             order — as InlineShapes among its Paragraphs, each picture at
 *             the extent the .docx gives it.
 *   POSITIVE  a document Word itself creates, with a picture, and saves, must
 *             reopen with that picture, or Word is not answering and nothing
 *             below counts.
 *   NEGATIVE  a .docx whose body is cut off mid-XML must be REFUSED. If Word
 *             opens it, this run cannot see a broken package.
 *   --file    any other .docx, e.g. a production download, must open; only
 *             counts are printed for these (paragraphs, pictures, pages),
 *             never text.
 *
 * The TEXT comes from poppler's reading order where this host's pdftotext is
 * poppler. Where it is not (this repository's Windows host has Xpdf 4.00,
 * which has no `-bbox-layout`), it comes from the pdf.js stand-in the tests
 * use (`src/tests/poppler-flow-standin.ts`), and the output says so: the
 * package Word opens is the writer's either way, which is what is under test.
 *
 * ── ITS BLIND SPOT ──────────────────────────────────────────────────────────
 *
 * It opens every file READ-ONLY with alerts off, as `prove:pptx-opens` does,
 * so a silent repair is invisible to it: whether a double-click shows Word's
 * "unreadable content" prompt is the owner's check, in Word's own window.
 * It does not edit or save the subjects.
 *
 * Exit codes: 0 = proven; 1 = evidence of a defect; 2 = could not conclude
 * (not Windows, no Word, a control failed, or Word's alerts were not left as
 * they were found). It closes Word afterwards only if Word had no document
 * open when it started, and puts DisplayAlerts back as it found it.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { readDocxBody } from "@/lib/workers/pdf-office-export/docx-read";
import type { PdfOfficeExportDeps } from "@/lib/workers/pdf-office-export/engine";
import { pdfOfficeExportDeps } from "@/lib/workers/pdf-office-export/native";
import { encodePngImage } from "@/lib/workers/pdf-office-export/png-encode";
import { createPdfOfficeExportProcessor } from "@/lib/workers/processor/pdf-office-export";
import { DOCX_PICTURE_FIXTURES } from "@/tests/docx-picture-fixtures";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { runPowerShellJson } from "@/tests/powershell-json";

const EXIT_DEFECT = 1;
const EXIT_INCOMPLETE = 2;

/** What Word itself read back from one file. */
interface Opened {
  path: string;
  ok: boolean;
  error?: string;
  hresult?: string;
  pages?: number;
  paragraphs?: { start: number; end: number; text: string }[];
  shapes?: { start: number; width: number; height: number }[];
}
interface WordReport {
  version: string;
  build: string;
  control: Opened;
  subjects: Opened[];
  alerts: { before: number; after: number };
}

const OPEN_IN_WORD = String.raw`
param([string]$ControlPath, [string]$PicturePath, [string]$ListPath)
$ErrorActionPreference = 'Stop'
# wdDoNotSaveChanges, by reference: Word's Close and Quit take a VARIANT
# by ref, and a Quit that would ask about saving hangs an invisible Word.
$noSave = 0
$app = New-Object -ComObject Word.Application
$preexisting = $app.Documents.Count
# DisplayAlerts belongs to whichever Word COM attached to, which may be one
# someone is working in; it is put back in the finally below.
$alertsBefore = $app.DisplayAlerts
$app.DisplayAlerts = 0 # wdAlertsNone
try {
function Read-Doc($d) {
  $paras = @()
  foreach ($p in $d.Paragraphs) { $paras += , @{ start = $p.Range.Start; end = $p.Range.End; text = [string]$p.Range.Text } }
  $shapes = @()
  foreach ($s in $d.InlineShapes) { $shapes += , @{ start = $s.Range.Start; width = [double]$s.Width; height = [double]$s.Height } }
  return @{ pages = $d.ComputeStatistics(2); paragraphs = @($paras); shapes = @($shapes) }
}
function Open-One($path) {
  try {
    # FileName, ConfirmConversions, ReadOnly, AddToRecentFiles. Word's
    # OpenAndRepair stays at its default, off: a repaired file is not the
    # file. (Passed positionally past these four, PowerShell cannot hand a
    # bool to Word's by-reference VARIANTs: measured, every Open then failed.)
    $d = $app.Documents.Open($path, $false, $true, $false)
    try { $r = Read-Doc $d; $r.ok = $true; $r.path = $path; return $r } finally { $d.Close([ref]$noSave) }
  } catch {
    return @{ ok = $false; path = $path; error = $_.Exception.Message; hresult = ('0x{0:X8}' -f $_.Exception.HResult) }
  }
}
$result = @{ version = $app.Version; build = $app.Build }
$ctl = $app.Documents.Add()
$ctl.Range().Text = 'CONTROL saved by Word'
$null = $ctl.InlineShapes.AddPicture($PicturePath, $false, $true, $ctl.Paragraphs(1).Range)
$ctl.SaveAs2($ControlPath, 16) # wdFormatXMLDocument
$ctl.Close([ref]$noSave)
$result.control = Open-One $ControlPath
$result.subjects = @(Get-Content -LiteralPath $ListPath -Encoding UTF8 | Where-Object { $_ } | ForEach-Object { Open-One ([string]$_) })
} finally {
  $app.DisplayAlerts = $alertsBefore
}
$result.alerts = @{ before = [int]$alertsBefore; after = [int]$app.DisplayAlerts }
if ($preexisting -eq 0 -and $app.Documents.Count -eq 0) { $app.Quit([ref]$noSave) }
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
$result | ConvertTo-Json -Depth 8 -Compress
`;

function incomplete(reason: string): never {
  console.log(`CANNOT CONCLUDE — ${reason}`);
  process.exit(EXIT_INCOMPLETE);
}

/** Word's paragraphs and pictures, page by page, as the fixtures spell them. */
function sequenceOf(opened: Opened, names: Map<number, string>): string[][] {
  const pages: string[][] = [[]];
  for (const p of opened.paragraphs ?? []) {
    const shapes = (opened.shapes ?? [])
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.start >= p.start && s.start < p.end);
    for (const { i } of shapes)
      pages[pages.length - 1]!.push(names.get(i) ?? "#?");
    // Word stands an inline picture in its text as one character ("/"):
    // drop the characters at the pictures' own positions, nothing else.
    const at = new Set(shapes.map(({ s }) => s.start - p.start));
    // UTF-16 units, as Word counts its positions.
    const text = p.text
      .split("")
      .filter((_, k) => !at.has(k))
      .join("")
      .replace(/[\r\u0001\u0007\u000b]/g, "");
    if (text.includes("\f")) {
      pages.push([]);
      continue;
    }
    if (text.trim()) pages[pages.length - 1]!.push(text.trim());
  }
  return pages.filter((page) => page.length > 0);
}

/** `docx` with its body cut off mid-XML: a package Word must refuse. */
async function truncated(docx: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(docx);
  const xml = await zip.file("word/document.xml")!.async("string");
  zip.file("word/document.xml", xml.slice(0, Math.floor(xml.length / 2)));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

async function main(): Promise<void> {
  if (process.platform !== "win32")
    incomplete("Word's COM server exists only on Windows.");
  const extra: string[] = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++)
    if (args[i] === "--file" && args[i + 1])
      extra.push(path.resolve(args[++i]!));

  const dir = mkdtempSync(path.join(tmpdir(), "docx-opens-"));
  const native = pdfOfficeExportDeps(process.env);
  if (!native.scanPages)
    incomplete(
      "the page reader (pdf.js and its canvas) is not available here.",
    );

  // SUBJECTS: each fixture through the worker's processor.
  const subjects: {
    path: string;
    name: string;
    sequence: string[][];
    extents: [number, number][];
    text: string;
  }[] = [];
  for (const build of DOCX_PICTURE_FIXTURES) {
    const fixture = await build();
    let text = "poppler";
    const run = async (deps: PdfOfficeExportDeps) =>
      createPdfOfficeExportProcessor(deps).process({
        tool: "pdf-to-word",
        options: {},
        inputs: [
          {
            fileId: "proof",
            filename: `${fixture.name}.pdf`,
            contentType: "application/pdf",
            bytes: fixture.pdf,
          },
        ],
      });
    let job = native.extractFlow ? await run(native) : null;
    if (!job || !job.ok) {
      text = "pdf.js stand-in for poppler";
      job = await run({ ...native, extractFlow: flowStandIn });
    }
    if (!job.ok) {
      console.log(
        `FAIL — ${fixture.name}: the real job did not produce a file: ${job.error.code}: ${job.error.message}`,
      );
      process.exit(EXIT_DEFECT);
    }
    const artifact = job.artifacts[0]!;
    const file = path.join(dir, artifact.filename);
    writeFileSync(file, artifact.bytes);
    const body = await readDocxBody(artifact.bytes);
    subjects.push({
      path: file,
      name: fixture.name,
      sequence: fixture.sequence,
      extents: body.pictures.map((p) => [p.width, p.height]),
      text,
    });
  }
  const negative = path.join(dir, "cut-off-mid-xml.docx");
  writeFileSync(
    negative,
    await truncated(
      new Uint8Array(
        await (await import("node:fs/promises")).readFile(subjects[0]!.path),
      ),
    ),
  );
  const picture = path.join(dir, "control-picture.png");
  const px = new Uint8Array(40 * 30 * 3);
  for (let p = 0; p < 40 * 30; p++)
    px.set(p % 40 < 20 ? [200, 40, 40] : [40, 80, 200], p * 3);
  writeFileSync(picture, encodePngImage(40, 30, "rgb8", px));

  const list = path.join(dir, "subjects.txt");
  writeFileSync(
    list,
    [...subjects.map((s) => s.path), negative, ...extra].join("\r\n"),
    "utf8",
  );
  let report: WordReport;
  try {
    report = runPowerShellJson<WordReport>(
      OPEN_IN_WORD,
      [
        "-ControlPath",
        path.join(dir, "control-saved-by-word.docx"),
        "-PicturePath",
        picture,
        "-ListPath",
        list,
      ],
      { dir, name: "open-in-word.ps1", timeout: 300_000 },
    );
  } catch (error) {
    incomplete(
      `Word could not be driven over COM (${(error as Error).message.split("\n")[0]}).`,
    );
  }
  console.log(
    `Word ${report.version} build ${report.build} — working in ${dir}`,
  );

  const controlOk =
    report.control.ok &&
    (report.control.shapes?.length ?? 0) === 1 &&
    (report.control.paragraphs ?? []).some((p) =>
      p.text.includes("CONTROL saved by Word"),
    );
  console.log(
    `  POSITIVE control (a document Word saved, with a picture) ${controlOk ? "reopened, 1 picture" : `FAILED: ${report.control.error ?? "not read back"}`}`,
  );
  const opened = report.subjects;
  const cut = opened[subjects.length];
  const negativeRefused = cut !== undefined && !cut.ok;
  console.log(
    `  NEGATIVE control (a .docx cut off mid-XML) ${negativeRefused ? `refused, ${cut!.hresult}` : "OPENED — this run cannot see a broken package"}`,
  );
  if (!controlOk || !negativeRefused)
    incomplete("a control failed, so this run is not evidence either way.");

  let failed = false;
  subjects.forEach((s, i) => {
    const got = opened[i];
    if (!got?.ok) {
      failed = true;
      console.log(
        `  SUBJECT  ${s.name}: REFUSED: ${got?.error} ${got?.hresult}`,
      );
      return;
    }
    // Word's InlineShapes are in document order, as the .docx's pictures are.
    let n = 0;
    const order = new Map<number, string>();
    for (const page of s.sequence)
      for (const block of page)
        if (block.startsWith("#")) order.set(n++, block);
    const seq = sequenceOf(got, order);
    const sameSequence = JSON.stringify(seq) === JSON.stringify(s.sequence);
    const sizes = (got.shapes ?? []).map((sh) => [sh.width, sh.height]);
    const sameSizes =
      sizes.length === s.extents.length &&
      sizes.every(
        (wh, k) =>
          Math.abs(wh[0]! - s.extents[k]![0]) <= 1 &&
          Math.abs(wh[1]! - s.extents[k]![1]) <= 1,
      );
    failed ||= !sameSequence || !sameSizes;
    console.log(
      `  SUBJECT  ${s.name} (text from ${s.text}): opened, ${got.pages} page(s), ${got.shapes?.length ?? 0} picture(s); order ${sameSequence ? "matches the page" : `DIFFERS\n           want ${JSON.stringify(s.sequence)}\n           got  ${JSON.stringify(seq)}`}; sizes ${sameSizes ? "match the .docx" : `DIFFER: ${JSON.stringify(sizes)} vs ${JSON.stringify(s.extents)}`}`,
    );
  });
  for (const other of opened.slice(subjects.length + 1)) {
    const ok = other.ok;
    failed ||= !ok;
    console.log(
      `  FILE     ${path.basename(other.path)}: ${ok ? `opened, ${other.pages} page(s), ${other.paragraphs?.length ?? 0} paragraph(s), ${other.shapes?.length ?? 0} picture(s)` : `REFUSED: ${other.error ?? ""} ${other.hresult ?? ""}`}`,
    );
  }
  const { before, after } = report.alerts;
  const restored = before === after;
  console.log(
    `  ALERTS   Word's DisplayAlerts ${before} before the run, ${after} after${restored ? "" : " — NOT PUT BACK, set it by hand"}`,
  );
  if (failed) {
    console.log("FAIL");
    process.exit(EXIT_DEFECT);
  }
  if (!restored)
    incomplete("the run did not leave Word's alerts as it found them.");
  console.log(
    "PASS — Word opened every subject with its pictures in place. Not covered: whether a double-click shows a repair prompt (see the docblock).",
  );
  process.exit(0);
}

void main();
