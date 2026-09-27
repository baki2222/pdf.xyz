/**
 * `pnpm prove:pptx-opens` — does Microsoft PowerPoint open what PDF to
 * PowerPoint writes?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * For its whole life until 2026-09-27 the engine wrote a .pptx that PowerPoint
 * for Windows refused as "corrupted and unreadable" (0x80070570), and every
 * check was green: the unit test found `ppt/slides/slide1.xml` in the ZIP and
 * the deployment proof found `PK` at the start of the download. Both read what
 * the AUTHOR wrote. The property a user needs, "it opens", has exactly one
 * instrument, and it is PowerPoint. This script is that instrument, run where
 * PowerPoint is installed: Windows with desktop Office, through the same COM
 * `Presentations.Open` a double-click ends up in.
 *
 * `pptx-package.ts` is the structural check CI and the worker can run. It is a
 * necessary condition, not this one.
 *
 * ── WHAT IT RUNS ─────────────────────────────────────────────────────────────
 *
 *   SUBJECT   a real job: a generated 3-page PDF (the middle page blank) through
 *             the worker's own processor and the native `pdftotext` extractor,
 *             exactly as the executor calls it. PowerPoint must open the result,
 *             report one slide per page, and read each page's lines back.
 *   POSITIVE  a deck PowerPoint creates and saves must reopen, or PowerPoint is
 *             not answering and nothing below counts.
 *   NEGATIVE  the package the engine wrote before 2026-09-27 must be REFUSED. If
 *             PowerPoint opens it, this run cannot see the defect it exists for.
 *   --file    any other .pptx, e.g. a production download, must open with at
 *             least one slide. Only counts are printed for these, never text.
 *
 *   pnpm prove:pptx-opens
 *   pnpm prove:pptx-opens --file "C:\Downloads\report.pptx"
 *
 * ── ITS BLIND SPOT: A SILENT REPAIR ─────────────────────────────────────────
 *
 * "Opened" here is NOT "opened without repair", and nothing below may say it
 * is. Measured 2026-09-27 on PowerPoint 16.0 build 20326: two deliberately
 * damaged copies of a good file (an unknown `<p:bogus/>` in a slide, and a
 * relationship to a missing image) also opened through COM, with the same
 * window caption, `Saved` true, and no OAlerts event; a third (a non-numeric
 * offset) was refused. So whether PowerPoint repaired a file quietly, or
 * tolerated it, is invisible to COM with alerts suppressed. The repair prompt
 * lives in the UI: double-click the file in Explorer. This script cannot see
 * that, and a PASS from it does not cover it.
 *
 * Exit codes follow `worker-prove-tools.ts`: 0 = proven; 1 = evidence of a
 * defect (a subject was refused or read back wrong); 2 = could not conclude (not
 * Windows, no PowerPoint, no `pdftotext`, or a control failed). Red is kept for
 * evidence so that red keeps meaning defect.
 *
 * It closes PowerPoint afterwards only if PowerPoint had no presentation open
 * when it started, so it never closes a deck someone is working on.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { pdfOfficeExportDeps } from "@/lib/workers/pdf-office-export/native";
import { createPdfOfficeExportProcessor } from "@/lib/workers/processor/pdf-office-export";
import { pptxBefore20260927 } from "@/tests/pptx-before-2026-09-27";

const EXIT_DEFECT = 1;
const EXIT_INCOMPLETE = 2;

/** What PowerPoint itself read back from one file. */
interface Opened {
  path: string;
  ok: boolean;
  error?: string;
  hresult?: string;
  slideCount?: number;
  masters?: number;
  slides?: { index: number; layout: string; texts: string[] }[];
}
interface PowerPointReport {
  version: string;
  build: string;
  control: Opened;
  subjects: Opened[];
}

const OPEN_IN_POWERPOINT = String.raw`
param([string]$ControlPath, [string]$ListPath)
$ErrorActionPreference = 'Stop'
$msoTrue = -1; $msoFalse = 0
$app = New-Object -ComObject PowerPoint.Application
$preexisting = $app.Presentations.Count
$app.DisplayAlerts = 1 # ppAlertsNone
function Read-Deck($p) {
  $slides = @()
  foreach ($s in $p.Slides) {
    $texts = @()
    foreach ($sh in $s.Shapes) {
      if ($sh.HasTextFrame -and $sh.TextFrame.HasText) {
        foreach ($para in $sh.TextFrame.TextRange.Paragraphs()) { $texts += $para.Text.TrimEnd([char]13, [char]11) }
      }
    }
    $slides += , @{ index = $s.SlideIndex; layout = $s.CustomLayout.Name; texts = @($texts) }
  }
  return @{ slideCount = $p.Slides.Count; masters = $p.Designs.Count; slides = @($slides) }
}
function Open-One($path) {
  try {
    $p = $app.Presentations.Open($path, $msoTrue, $msoFalse, $msoFalse)
    try { $r = Read-Deck $p; $r.ok = $true; $r.path = $path; return $r } finally { $p.Close() }
  } catch {
    return @{ ok = $false; path = $path; error = $_.Exception.Message; hresult = ('0x{0:X8}' -f $_.Exception.HResult) }
  }
}
$result = @{ version = $app.Version; build = $app.Build }
$ctl = $app.Presentations.Add($msoFalse)
$slide = $ctl.Slides.Add(1, 12)
$null = $slide.Shapes.AddTextbox(1, 50, 50, 400, 50)
$slide.Shapes(1).TextFrame.TextRange.Text = 'CONTROL saved by PowerPoint'
$ctl.SaveAs($ControlPath)
$ctl.Close()
$result.control = Open-One $ControlPath
# [string]: Get-Content's lines carry PSPath/PSProvider notes, and ConvertTo-Json
# would serialise that whole object graph (94 MB on the first run).
$result.subjects = @(Get-Content -LiteralPath $ListPath -Encoding UTF8 | Where-Object { $_ } | ForEach-Object { Open-One ([string]$_) })
if ($preexisting -eq 0 -and $app.Presentations.Count -eq 0) { $app.Quit() }
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
$result | ConvertTo-Json -Depth 8 -Compress
`;

/** The proof document: what each page says, and so what each slide must say. */
function proofPages(marker: string): string[][] {
  return [
    ["Quarterly review", "Revenue & costs <draft>", marker],
    [],
    ['Next steps "quoted"', "Thanks"],
  ];
}

async function proofPdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    lines.forEach((text, i) =>
      page.drawText(text, { x: 72, y: 700 - i * 28, size: 16, font }),
    );
  }
  return doc.save();
}

function openInPowerPoint(dir: string, files: string[]): PowerPointReport {
  const script = path.join(dir, "open-in-powerpoint.ps1");
  const list = path.join(dir, "subjects.txt");
  writeFileSync(script, OPEN_IN_POWERPOINT, "utf8");
  writeFileSync(list, files.join("\r\n"), "utf8");
  const stdout = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-ControlPath",
      path.join(dir, "control-saved-by-powerpoint.pptx"),
      "-ListPath",
      list,
    ],
    { encoding: "utf8", timeout: 300_000 },
  );
  return JSON.parse(stdout.slice(stdout.indexOf("{"))) as PowerPointReport;
}

function incomplete(reason: string): never {
  console.log(`CANNOT CONCLUDE — ${reason}`);
  process.exit(EXIT_INCOMPLETE);
}

async function main(): Promise<void> {
  if (process.platform !== "win32")
    incomplete("PowerPoint's COM server exists only on Windows.");

  const extra: string[] = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++)
    if (args[i] === "--file" && args[i + 1])
      extra.push(path.resolve(args[++i]!));

  const dir = mkdtempSync(path.join(tmpdir(), "pptx-opens-"));
  const marker = `PPTX-PROOF-${process.pid}-${Date.now()}`;
  const pages = proofPages(marker);
  const pdf = await proofPdf(pages);

  // SUBJECT: the worker's processor with its real, native extractor.
  const deps = pdfOfficeExportDeps(process.env);
  if (!deps.extract)
    incomplete(
      "the native pdftotext extractor is not available here, so no real job can run.",
    );
  const job = await createPdfOfficeExportProcessor(deps).process({
    tool: "pdf-to-powerpoint",
    options: {},
    inputs: [
      {
        fileId: "proof",
        filename: "PowerPoint proof.pdf",
        contentType: "application/pdf",
        bytes: pdf,
      },
    ],
  });
  if (!job.ok) {
    console.log(
      `FAIL — the real job did not produce a file: ${job.error.code}: ${job.error.message}`,
    );
    process.exit(EXIT_DEFECT);
  }
  const artifact = job.artifacts[0]!;
  const subject = path.join(dir, artifact.filename);
  writeFileSync(subject, artifact.bytes);

  // NEGATIVE: what the engine wrote before 2026-09-27, from the same text.
  const negative = path.join(dir, "written-before-2026-09-27.pptx");
  writeFileSync(
    negative,
    await pptxBefore20260927(
      pages.map((lines, i) => ({
        pageNumber: i + 1,
        text: lines.join("\n"),
        characterCount: lines.join("\n").length,
      })),
    ),
  );

  let report: PowerPointReport;
  try {
    report = openInPowerPoint(dir, [subject, negative, ...extra]);
  } catch (error) {
    incomplete(
      `PowerPoint could not be driven over COM (${(error as Error).message.split("\n")[0]}).`,
    );
  }
  const [got, before, ...others] = report.subjects;
  console.log(
    `PowerPoint ${report.version} build ${report.build} — working in ${dir}`,
  );

  // Controls first: if either fails, nothing below is evidence.
  const controlOk =
    report.control.ok &&
    report.control.slides?.[0]?.texts.includes("CONTROL saved by PowerPoint");
  console.log(
    `  POSITIVE control (deck saved by PowerPoint) ${controlOk ? "reopened" : `FAILED: ${report.control.error ?? "text not read back"}`}`,
  );
  const negativeRefused = before !== undefined && !before.ok;
  console.log(
    `  NEGATIVE control (pre-2026-09-27 package)   ${negativeRefused ? `refused, ${before!.hresult}` : "OPENED — this run cannot see the defect"}`,
  );
  if (!controlOk || !negativeRefused)
    incomplete("a control failed, so this run is not evidence either way.");

  // The subject: opens, one slide per page, each page's lines in order.
  const want = pages;
  const read = got?.slides?.map((s) => s.texts.filter(Boolean)) ?? [];
  const opened = got?.ok === true;
  const sameText = JSON.stringify(read) === JSON.stringify(want);
  console.log(
    `  SUBJECT  real job → ${artifact.filename} (${artifact.bytes.byteLength} B): ${opened ? `opened, ${got!.slideCount} slides, ${got!.masters} master` : `REFUSED: ${got?.error} ${got?.hresult}`}`,
  );
  if (opened)
    console.log(
      `           text read back by PowerPoint ${sameText ? "matches every page" : `DIFFERS\n           want ${JSON.stringify(want)}\n           got  ${JSON.stringify(read)}`}`,
    );

  let failed = !opened || !sameText;
  for (const other of others) {
    const ok = other.ok && (other.slideCount ?? 0) > 0;
    failed ||= !ok;
    console.log(
      `  FILE     ${path.basename(other.path)}: ${ok ? `opened, ${other.slideCount} slides` : `REFUSED: ${other.error ?? "no slides"} ${other.hresult ?? ""}`}`,
    );
  }
  console.log(
    failed
      ? "FAIL"
      : "PASS — PowerPoint opened it. Not covered: whether a double-click shows a repair prompt (see the docblock).",
  );
  process.exit(failed ? EXIT_DEFECT : 0);
}

void main();
