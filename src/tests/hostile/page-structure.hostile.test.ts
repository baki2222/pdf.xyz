/**
 * HOSTILE MATRIX — family "page-structure".
 *
 * Every entry point of merge, merge-alternate, split, extract, delete,
 * rotate, organize, n-up and split-half, plus the gates every tool passes
 * through (pdf-lib load / page count / rotations, `countPdfPagesDetailed`,
 * `probePdf`, `countPagesWithPdfjs`, `openForBatch`), run against every
 * hostile class in `page-structure.fixtures.ts`, and against hostile PLANS
 * on a well-formed control.
 *
 * HOW A CELL RUNS. In a child process (`page-structure.cells.ts`), because
 * pdf-lib and pdf.js are synchronous where it matters: a loop or a bomb would
 * block this thread and no vitest timeout would ever fire. The supervisor
 * below owns a per-cell clock (kill + record `hang`) and the child's watchdog
 * thread owns an RSS bound (kill + record `memory`). A crash is recorded as
 * `crash`; the next cell resumes in a fresh child.
 *
 * HOW A CELL IS JUDGED. `judge` holds the outcome to the fixture's truth:
 *  - a refusal (`PdfEngineError`) is acceptable — the user reads its message;
 *    encrypted inputs must be refused as `PdfEncryptedError` with the right
 *    verdict, and non-PDFs as `unreadable`;
 *  - output must reload, agree with pdf.js on its page count, carry no
 *    number token a reader rejects, and have the page count the operation
 *    implies for the TRUE page count;
 *  - any other throw is a defect: `runner-kit.errorMessage` shows a raw
 *    Error's message to the user verbatim;
 *  - hang, memory, crash: defects.
 * A cell whose outcome is acceptable is a passing test. A cell that shows a
 * problem is `test.fails` under its finding id (FINDINGS below), so this file
 * is green while the finding stands — and turns red the day it is fixed,
 * which is the signal to move the cell out of FINDINGS (invert, do not
 * delete).
 *
 * Run: npx vitest run src/tests/hostile/page-structure.hostile.test.ts --no-file-parallelism
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { beforeAll, describe, expect, test } from "vitest";
import type {
  CellResult,
  OutputFile,
  PlannedCell,
} from "./page-structure.cells";
import {
  PAGE_STRUCTURE_FIXTURES,
  type PageStructureFixture,
  type Truth,
} from "./page-structure.fixtures";
import { text } from "./page-structure.raw";

/* ------------------------------------------------------------------ *
 *  The plan.
 * ------------------------------------------------------------------ */

const FILE_ENGINES = [
  "loadPdf",
  "getPageCount",
  "getPageRotations",
  "merge",
  "mergeAlternate",
  "extract",
  "delete",
  "rotate",
  "setRotations",
  "split",
  "organize",
  "nUp",
  "splitHalf",
  "countPdfPagesDetailed",
  "probePdf",
  "countPagesWithPdfjs",
  "openForBatch",
] as const;
type FileEngine = (typeof FILE_ENGINES)[number];

/** Hostile plans on the 3-page control, and what each must do. */
const PLANS: Record<
  string,
  "refuse" | "valid-output" | "safe-names" | "bounded"
> = {
  "plan.extractNeg": "refuse",
  "plan.deleteNeg": "refuse",
  "plan.deleteAll": "refuse",
  "plan.organizeNeg": "refuse",
  "plan.organizeBadRotation": "valid-output",
  "plan.setRotationsNaN": "valid-output",
  "plan.setRotationsShort": "refuse",
  "plan.rotateTurn45": "valid-output",
  "plan.rotateTurnNaN": "valid-output",
  "plan.splitNeg": "refuse",
  "plan.splitNames": "safe-names",
  "plan.oddEvenHuge": "bounded",
  "plan.mergeNegPages": "refuse",
  "plan.mergeAltNegPages": "refuse",
  "plan.nUpBadCount": "refuse",
  "plan.splitHalfNeg": "refuse",
};

const CELLS: PlannedCell[] = [
  ...FILE_ENGINES.map((engine) => ({ engine, fixture: "CTRL" })),
  ...PAGE_STRUCTURE_FIXTURES.flatMap((f) =>
    FILE_ENGINES.map((engine) => ({ engine, fixture: f.id })),
  ),
  ...Object.keys(PLANS).map((engine) => ({ engine, fixture: "CTRL" })),
];
const key = (c: PlannedCell) => `${c.engine} × ${c.fixture}`;

const FIXTURE = new Map(PAGE_STRUCTURE_FIXTURES.map((f) => [f.id, f]));
const CELL_BOUND_MS = 20_000;
/** Bombs and 2,000-page / 50,000-deep documents: honest, not hidden. */
const SLOW_CELL_BOUND_MS = 120_000;
const boundFor = (c: PlannedCell) =>
  FIXTURE.get(c.fixture)?.slow ? SLOW_CELL_BOUND_MS : CELL_BOUND_MS;

/* ------------------------------------------------------------------ *
 *  FINDINGS: cell → finding id. Each listed cell is `test.fails`.
 *  Filled from the recorded outcomes; ids are described in the report.
 * ------------------------------------------------------------------ */

const FINDINGS: Record<string, string> = {};
function finding(
  id: string,
  engines: readonly string[],
  fixtures: readonly string[],
) {
  for (const e of engines)
    for (const f of fixtures) FINDINGS[`${e} × ${f}`] = id;
}
/** The 13 engines that open the file with pdf-lib through `loadPdf`. */
const PDFLIB: readonly FileEngine[] = FILE_ENGINES.slice(0, 13);
/** The engines that copy pages through `assemblePages`. */
const ASSEMBLE: readonly FileEngine[] = [
  "merge",
  "mergeAlternate",
  "extract",
  "split",
  "organize",
  "splitHalf",
];
const ROTATE: readonly FileEngine[] = ["rotate", "setRotations"];

// PS-01 HANG: an xref stream whose /W holds a 20-digit width freezes pdf-lib's
// load (and so every tool and both pdf-lib gates); pdf.js reads it in ms.
finding(
  "PS-01",
  [...PDFLIB, "countPdfPagesDetailed", "probePdf"],
  ["H18.wJunk"],
);
// PS-02 MEMORY: N-up decodes every content stream whole to embed the page;
// a 1 MB (or 3 KB chained) Flate bomb takes the tab past 1.5 GB.
finding("PS-02", ["nUp"], ["H12.bomb", "H12.chained"]);
// PS-03 raw "Maximum call stack size exceeded" for a cyclic page tree.
finding("PS-03", PDFLIB, ["H07.kidsCycle", "H07.selfKid"]);
finding(
  "PS-03",
  PDFLIB.filter((e) => !["loadPdf", "getPageCount", "delete"].includes(e)),
  ["H07.parentCycle"],
);
// PS-04 raw stack overflow: page copy recurses once per Form XObject level.
finding("PS-04", ASSEMBLE, ["H08.forms2000", "H08.forms20000"]);
// PS-05 raw stack overflow for a 50,000-deep /Kids chain (2,000 is fine).
finding("PS-05", PDFLIB, ["H08.tree50000"]);
// PS-06 raw TypeError "reading 'Pages'": a file pdf-lib parses with no catalog.
finding("PS-06", PDFLIB, ["H03.header", "H23.nLie", "H23.firstPast"]);
// PS-07 raw "Expected instance of PDFArray, but got instance of PDFRef".
finding(
  "PS-07",
  [
    "merge",
    "mergeAlternate",
    "extract",
    "rotate",
    "setRotations",
    "split",
    "organize",
    "nUp",
    "splitHalf",
  ],
  ["H07.selfRef"],
);
// PS-08 SILENT WRONG: duplicate object ids — pdf-lib keeps the LAST body,
// the xref (and pdf.js, which draws the preview) the first.
finding(
  "PS-08",
  [
    "merge",
    "mergeAlternate",
    "extract",
    "rotate",
    "setRotations",
    "split",
    "organize",
    "nUp",
    "splitHalf",
  ],
  ["H19.dupFirst"],
);
// PS-09 SILENT WRONG: one unparseable number in a MediaBox makes pdf-lib
// report ZERO pages for a 1-page file; Rotate then writes a file pdf.js
// reads as 2 pages.
finding(
  "PS-09",
  ["loadPdf", "getPageCount", "getPageRotations", "setRotations", "probePdf"],
  ["H18.mediaExp", "H18.mediaJunk"],
);
// PS-10 INVALID OUTPUT: N-up of a zero-size page writes "Infinity" operands.
finding("PS-10", ["nUp"], ["H10.zero"]);
// PS-11 pdf.js count is /Count verbatim when the tree disagrees.
finding(
  "PS-11",
  ["countPagesWithPdfjs"],
  ["H09.countNeg", "H09.countZero", "H07.kidsCycle"],
);
// PS-12 in-place rotate keeps a broken /Count: output pdf.js cannot open.
finding("PS-12", ROTATE, ["H09.countNeg", "H09.countZero"]);
// PS-13 pdf.js "UnknownErrorException: unknown encryption method" passes raw.
finding(
  "PS-13",
  ["countPagesWithPdfjs"],
  ["H15.unknownObjStm", "H15.unsupported"],
);
// PS-14 FALSE CLAIM: a page that SHOWS "/ByteRange [...]" counts as signed.
finding("PS-14", ["openForBatch"], ["H17.byteRangeText"]);
// PS-15 raw TypeError for a NaN rotation in a plan.
for (const p of [
  "plan.organizeBadRotation",
  "plan.setRotationsNaN",
  "plan.rotateTurnNaN",
])
  FINDINGS[`${p} × CTRL`] = "PS-15";
// PS-16 MEMORY: oddEvenParts allocates a page list as long as the count given.
FINDINGS["plan.oddEvenHuge × CTRL"] = "PS-16";

/* ------------------------------------------------------------------ *
 *  The supervisor.
 * ------------------------------------------------------------------ */

const CHILD = path.join(
  process.cwd(),
  "src/tests/hostile/page-structure.cells.ts",
);

async function runMatrix(cells: PlannedCell[]): Promise<CellResult[]> {
  const results: (CellResult | undefined)[] = new Array(cells.length);
  const dir = mkdtempSync(path.join(tmpdir(), "ps-hostile-"));
  let start = 0;
  let respawns = 0;
  while (start < cells.length) {
    const planPath = path.join(dir, `plan-${respawns}.json`);
    writeFileSync(planPath, JSON.stringify({ cells, start }));
    const sawStart = await new Promise<boolean>((resolve) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", CHILD, planPath],
        {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let current = -1;
      let any = false;
      let memory: number | null = null;
      let t0 = 0;
      let tail = "";
      let timer: ReturnType<typeof setTimeout> | undefined;
      const boot = setTimeout(() => child.kill("SIGKILL"), 90_000);
      child.stderr.on("data", (d: Buffer) => {
        tail = (tail + d.toString("utf8")).slice(-600);
      });
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (!line.startsWith("@@CELL ")) return;
        const ev = JSON.parse(line.slice(7)) as {
          t: string;
          i: number;
          r?: CellResult;
          rss?: number;
        };
        if (ev.t === "start") {
          clearTimeout(boot);
          any = true;
          current = ev.i;
          t0 = Date.now();
          clearTimeout(timer);
          const bound = boundFor(cells[ev.i]!);
          timer = setTimeout(() => {
            results[ev.i] = { outcome: "hang", ms: bound };
            child.kill("SIGKILL");
          }, bound);
        } else if (ev.t === "done") {
          clearTimeout(timer);
          results[ev.i] = ev.r!;
        } else if (ev.t === "memory") {
          memory = ev.rss ?? 0;
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        clearTimeout(boot);
        if (current >= 0 && results[current] === undefined) {
          results[current] =
            memory !== null ||
            /heap out of memory|Allocation failed/i.test(tail)
              ? { outcome: "memory", rss: memory ?? -1, ms: Date.now() - t0 }
              : { outcome: "crash", code, tail, ms: Date.now() - t0 };
        }
        resolve(any);
      });
    });
    if (!sawStart) {
      throw new Error(`cell child failed to start at cell ${start}`);
    }
    respawns += 1;
    const next = results.findIndex((r, i) => i >= start && r === undefined);
    start = next === -1 ? cells.length : next;
  }
  return results as CellResult[];
}

/* ------------------------------------------------------------------ *
 *  The judge.
 * ------------------------------------------------------------------ */

interface Verdict {
  ok: boolean;
  why: string;
}
const pass = (why: string): Verdict => ({ ok: true, why });
const fail = (why: string): Verdict => ({ ok: false, why });
const ROT = new Set([0, 90, 180, 270]);

/**
 * What is wrong with one output file. A degenerate box or an odd /Rotate
 * COPIED from the source is the source's quirk, not the tool's (a viewer
 * treats both exactly as it treated the input), so those are checked only
 * where the tool itself writes the value (`wrote`: rotate tools and plans).
 */
function fileProblems(f: OutputFile, wrote = false): string[] {
  const out: string[] = [];
  if (f.reload !== "ok") return [`output does not reload: ${f.reload}`];
  if (typeof f.pdfjsPages !== "number")
    out.push(`pdf.js cannot open output: ${f.pdfjsPages}`);
  else if (f.pdfjsPages !== f.pages)
    out.push(`pdf-lib reads ${f.pages} pages, pdf.js ${f.pdfjsPages}`);
  if (f.badNumbers?.length)
    out.push(`invalid number tokens: ${f.badNumbers.join(" ")}`);
  if (wrote)
    for (const r of f.rotations ?? [])
      if (!ROT.has(r)) out.push(`rotation ${r}`);
  return out;
}

/** Pages the operation must produce from a document of `n` pages. */
function expectedPages(engine: FileEngine, n: number): number[] | null {
  switch (engine) {
    case "merge":
    case "mergeAlternate":
      return [n + 1];
    case "extract":
      return [1];
    case "delete":
      return n > 1 ? [n - 1] : null;
    case "rotate":
    case "setRotations":
      return [n];
    case "split":
      return n > 1 ? [Math.ceil(n / 2), Math.floor(n / 2)] : [1];
    case "organize":
      return [2];
    case "nUp":
      return [Math.ceil(n / 4)];
    case "splitHalf":
      return [2 * n];
    default:
      return null;
  }
}

function refusal(r: Extract<CellResult, { outcome: "refused" }>) {
  return `refused: "${r.message}"`;
}

function judge(
  engine: string,
  truth: Truth,
  r: CellResult,
  fx?: PageStructureFixture,
): Verdict {
  switch (r.outcome) {
    case "hang":
      return fail(`hung past ${r.ms} ms`);
    case "memory":
      return fail(`RSS passed the bound (${Math.round(r.rss / 1048576)} MiB)`);
    case "crash":
      return fail(`child crashed (exit ${r.code}): ${r.tail.slice(-200)}`);
    case "fixture-error":
      return fail(`fixture error: ${r.message}`);
    case "threw":
      return fail(
        `internal error reaches the user verbatim: ${r.name}: ${r.message}`,
      );
  }
  const e = engine as FileEngine;

  /* The never-throwing gates and openForBatch. */
  if (e === "openForBatch") {
    if (r.outcome === "refused")
      return truth.kind === "not-pdf"
        ? pass(refusal(r))
        : fail(`refused a readable file: ${r.message}`);
    const v = (r as { value: { signatures: number } }).value;
    const want = fx?.signatures ?? 0;
    return v.signatures === want
      ? pass(`signatures=${v.signatures}`)
      : fail(`signatures=${v.signatures}, the file carries ${want}`);
  }
  const truePages =
    truth.kind === "pages"
      ? truth.pages
      : truth.kind === "encrypted"
        ? truth.pages
        : null;

  if (e === "countPdfPagesDetailed") {
    const v = (
      r as { value: { ok: boolean; count?: number; unknown?: string } }
    ).value;
    if (r.outcome !== "value") return fail(`unexpected ${r.outcome}`);
    if (!v.ok)
      return truth.kind === "pages" && truth.pages > 0
        ? pass(`unknown: ${v.unknown} (honest)`)
        : pass(`unknown: ${v.unknown}`);
    if (truth.kind === "not-pdf" || truth.kind === "no-pages")
      return fail(`counted ${v.count} pages in a file with none`);
    if (truth.kind === "truncated")
      return v.count! <= truth.max
        ? pass(`count=${v.count}`)
        : fail(`count=${v.count} > ${truth.max}`);
    if (truePages !== null && v.count !== truePages)
      return fail(`count=${v.count}, the document has ${truePages}`);
    return pass(`count=${v.count}`);
  }
  if (e === "probePdf") {
    if (r.outcome !== "value") return fail(`unexpected ${r.outcome}`);
    const v = (
      r as { value: { read: string; lock: string; pages: number | null } }
    ).value;
    if (truth.kind === "not-pdf")
      return v.read === "unreadable"
        ? pass("unreadable")
        : fail(`read=${v.read} pages=${v.pages} for a non-PDF`);
    if (truth.kind === "encrypted") {
      if (v.read !== "ok") return pass(`read=${v.read}`);
      const want =
        truth.lock === "needs-password"
          ? "password-required"
          : truth.lock === "opens-without-password"
            ? "restricted"
            : null;
      if (want && v.lock !== want)
        return fail(`lock=${v.lock}, file is ${truth.lock}`);
      if (!want && v.lock === "none")
        return fail("lock=none for an encrypted file");
      if (truePages !== null && v.pages !== null && v.pages !== truePages)
        return fail(`pages=${v.pages}, the document has ${truePages}`);
      return pass(`lock=${v.lock} pages=${v.pages}`);
    }
    if (v.read !== "ok") return pass(`read=${v.read}`);
    if (truth.kind === "no-pages")
      return v.pages === 0 || v.pages === null
        ? pass(`pages=${v.pages}`)
        : fail(`pages=${v.pages} in a tree with none`);
    if (truth.kind === "truncated")
      return (v.pages ?? 0) <= truth.max
        ? pass(`pages=${v.pages}`)
        : fail(`pages=${v.pages}`);
    if (truePages !== null && v.pages !== truePages)
      return fail(`pages=${v.pages}, the document has ${truePages}`);
    return pass(`pages=${v.pages}`);
  }
  if (e === "countPagesWithPdfjs") {
    if (r.outcome === "refused") {
      if (truth.kind === "encrypted" && truth.lock === "needs-password")
        return r.kind === "encrypted"
          ? pass(refusal(r))
          : fail(`needs-password file refused as ${r.kind}`);
      return pass(refusal(r));
    }
    const n = (r as { value: number }).value;
    if (truth.kind === "not-pdf" || truth.kind === "no-pages")
      return fail(`counted ${n} pages in a file with none`);
    if (truth.kind === "encrypted" && truth.lock === "needs-password")
      return fail(`counted ${n} pages without the password`);
    if (truth.kind === "truncated")
      return n >= 1 && n <= truth.max ? pass(`count=${n}`) : fail(`count=${n}`);
    if (truePages !== null && n !== truePages)
      return fail(`count=${n}, the document has ${truePages}`);
    return pass(`count=${n}`);
  }

  /* pdf-lib engines. */
  if (truth.kind === "encrypted") {
    if (r.outcome !== "refused")
      return fail(`produced ${r.outcome} from an encrypted file`);
    if (r.kind !== "encrypted")
      return fail(`encrypted file refused as "${r.kind}": ${r.message}`);
    const want = truth.lock;
    if (want && r.verdict !== want)
      return fail(`verdict ${r.verdict}, file is ${want}: "${r.message}"`);
    return pass(refusal(r));
  }
  if (truth.kind === "not-pdf") {
    if (r.outcome !== "refused")
      return fail(
        `produced ${r.outcome} ${JSON.stringify((r as { value?: unknown }).value ?? "")} from a non-PDF`,
      );
    return r.kind === "unreadable"
      ? pass(refusal(r))
      : fail(
          `non-PDF refused with a message about something else: "${r.message}"`,
        );
  }
  if (r.outcome === "refused") {
    if (truth.kind === "pages" && e === "delete" && truth.pages === 1)
      return pass(refusal(r));
    return pass(`${refusal(r)} (honest)`);
  }
  if (truth.kind === "no-pages") {
    if (r.outcome === "value") {
      const v = (r as { value: unknown }).value;
      const zero =
        v === 0 ||
        (Array.isArray(v) && v.length === 0) ||
        (v as { pages?: number })?.pages === 0;
      return zero
        ? pass(`zero pages: ${JSON.stringify(v)}`)
        : fail(`value ${JSON.stringify(v)} for a tree with no pages`);
    }
    return fail(`produced output from a tree with no page`);
  }
  // pages / truncated
  const n = truth.kind === "pages" ? truth.pages : null;
  if (r.outcome === "value") {
    const v = (r as { value: unknown }).value;
    if (e === "loadPdf" || e === "getPageCount") {
      const got =
        e === "loadPdf" ? (v as { pages: number }).pages : (v as number);
      if (n === null)
        return got >= 1 && got <= (truth as { max: number }).max
          ? pass(`pages=${got}`)
          : fail(`pages=${got}`);
      return got === n
        ? pass(`pages=${got}`)
        : fail(`pages=${got}, the document has ${n}`);
    }
    if (e === "getPageRotations") {
      const rot = v as number[];
      if (n !== null && rot.length !== n)
        return fail(`${rot.length} rotations for ${n} pages`);
      if (rot.some((x) => !ROT.has(x)))
        return fail(`rotations ${JSON.stringify(rot)}`);
      const want = truth.kind === "pages" ? truth.rotations : undefined;
      if (want && JSON.stringify(rot) !== JSON.stringify(want))
        return fail(
          `rotations ${JSON.stringify(rot)}, a viewer shows ${JSON.stringify(want)}`,
        );
      return pass(`rotations=${JSON.stringify(rot.slice(0, 4))}`);
    }
    return fail(`unexpected value ${JSON.stringify(v)}`);
  }
  if (r.outcome !== "output")
    return fail(`unexpected ${(r as CellResult).outcome}`);
  const problems = r.files.flatMap((f) => fileProblems(f));
  if (problems.length) return fail(problems.join("; "));
  const got = r.files.map((f) => f.pages!);
  if (n !== null) {
    const want = expectedPages(e, n);
    if (want === null)
      return fail(
        `produced ${JSON.stringify(got)} pages where a refusal was due`,
      );
    if (JSON.stringify(got) !== JSON.stringify(want))
      return fail(
        `output pages ${JSON.stringify(got)}, a ${n}-page document gives ${JSON.stringify(want)}`,
      );
  } else if (got.some((p) => p < 1))
    return fail(`empty output ${JSON.stringify(got)}`);
  if (truth.kind === "pages" && truth.marker) {
    const marks = r.files.flatMap((f) => f.markers ?? []);
    if (!marks.includes(truth.marker) || marks.some((m) => m !== truth.marker))
      return fail(
        `output draws ${JSON.stringify(marks)}; the xref-selected page draws "${truth.marker}"`,
      );
  }
  if (truth.kind === "pages" && (e === "rotate" || e === "setRotations")) {
    const want = ((truth.rotations?.[0] ?? 0) + 90) % 360;
    const rot = r.files[0]!.rotations![0];
    if (rot !== want)
      return fail(
        `page 1 rotated to ${rot}, viewer showed ${truth.rotations?.[0] ?? 0} so +90 is ${want}`,
      );
  }
  const active = r.files.flatMap((f) => f.active ?? []);
  return pass(
    `output ${JSON.stringify(got)} pages${active.length ? `; kept active content: ${[...new Set(active)].join(",")}` : ""}`,
  );
}

function judgePlan(engine: string, r: CellResult): Verdict {
  const want = PLANS[engine]!;
  if (r.outcome === "threw")
    return fail(
      `internal error reaches the user verbatim: ${r.name}: ${r.message}`,
    );
  if (r.outcome === "hang" || r.outcome === "memory" || r.outcome === "crash")
    return judge(engine, { kind: "pages", pages: 3 }, r);
  if (want === "refuse")
    return r.outcome === "refused"
      ? pass(refusal(r))
      : fail(`accepted a plan with no valid page: ${r.outcome}`);
  if (want === "valid-output") {
    if (r.outcome === "refused") return pass(refusal(r));
    if (r.outcome !== "output") return fail(`unexpected ${r.outcome}`);
    const p = r.files.flatMap((f) => fileProblems(f, true));
    return p.length
      ? fail(p.join("; "))
      : pass(`rotations ${JSON.stringify(r.files[0]!.rotations)}`);
  }
  if (want === "safe-names") {
    if (r.outcome !== "value") return fail(`unexpected ${r.outcome}`);
    const names = (r as { value: string[] }).value;
    // One path segment a file system accepts: no separator, reserved
    // character or control character, and not "." / "..".
    return names.every(
      (n) => !/[\\/:*?"<>|\u0000-\u001f]/.test(n) && n !== "." && n !== "..",
    )
      ? pass(`names ${JSON.stringify(names)}`)
      : fail(`unsafe part names ${JSON.stringify(names)}`);
  }
  // bounded: anything but hang/memory, already handled
  return pass(
    `${r.outcome} ${JSON.stringify((r as { value?: unknown }).value ?? "")}`,
  );
}

/* ------------------------------------------------------------------ *
 *  The tests.
 * ------------------------------------------------------------------ */

let RESULTS: CellResult[] = [];
const byKey = new Map<string, CellResult>();

beforeAll(async () => {
  RESULTS = await runMatrix(CELLS);
  CELLS.forEach((c, i) => byKey.set(key(c), RESULTS[i]!));
  if (process.env.HOSTILE_DUMP) {
    writeFileSync(
      process.env.HOSTILE_DUMP,
      JSON.stringify(
        CELLS.map((c, i) => {
          const fx = FIXTURE.get(c.fixture);
          const v =
            c.engine in PLANS
              ? judgePlan(c.engine, RESULTS[i]!)
              : judge(
                  c.engine,
                  fx?.truth ?? { kind: "pages", pages: 3 },
                  RESULTS[i]!,
                  fx,
                );
          return { key: key(c), ...v, r: RESULTS[i] };
        }),
        null,
        1,
      ),
    );
  }
}, 40 * 60_000);

describe("matrix health", () => {
  test("the corpus is the size it claims (fixtures × engines + plans + control)", () => {
    expect(PAGE_STRUCTURE_FIXTURES.length).toBeGreaterThanOrEqual(70);
    expect(CELLS.length).toBe(
      FILE_ENGINES.length * (PAGE_STRUCTURE_FIXTURES.length + 1) +
        Object.keys(PLANS).length,
    );
    expect(new Set(CELLS.map(key)).size).toBe(CELLS.length);
    // Every class of the survey is exercised.
    const classes = new Set(PAGE_STRUCTURE_FIXTURES.map((f) => f.cls));
    for (let i = 1; i <= 24; i += 1)
      expect(classes).toContain(`H${String(i).padStart(2, "0")}`);
  });

  test("every cell recorded an outcome", () => {
    expect(RESULTS.length).toBe(CELLS.length);
    expect(RESULTS.filter((r) => r === undefined)).toEqual([]);
  });

  test("every FINDINGS key names a real cell", () => {
    const keys = new Set(CELLS.map(key));
    expect(Object.keys(FINDINGS).filter((k) => !keys.has(k))).toEqual([]);
  });

  test("positive control: the well-formed file passes every engine", () => {
    const bad = FILE_ENGINES.map(
      (e) =>
        [
          e,
          judge(e, { kind: "pages", pages: 3 }, byKey.get(`${e} × CTRL`)!),
        ] as const,
    ).filter(([, v]) => !v.ok);
    expect(bad).toEqual([]);
  });

  test("negative controls: the judge can say no", () => {
    const t: Truth = { kind: "pages", pages: 3 };
    expect(
      judge("extract", t, {
        outcome: "threw",
        name: "Error",
        message: "x",
        ms: 0,
      }).ok,
    ).toBe(false);
    expect(judge("extract", t, { outcome: "hang", ms: 1 }).ok).toBe(false);
    const file: OutputFile = {
      bytes: 1,
      reload: "ok",
      pages: 2,
      pdfjsPages: 2,
      rotations: [0, 0],
      boxes: [[0, 0, 1, 1, 1, 1]],
      badNumbers: [],
    };
    expect(
      judge("extract", t, { outcome: "output", files: [file], ms: 0 }).ok,
    ).toBe(false);
    expect(
      judge("extract", t, {
        outcome: "output",
        files: [{ ...file, pages: 1, pdfjsPages: 1 }],
        ms: 0,
      }).ok,
    ).toBe(true);
    expect(
      judge("nUp", t, {
        outcome: "output",
        files: [{ ...file, pages: 1, pdfjsPages: 1, badNumbers: ["NaN"] }],
        ms: 0,
      }).ok,
    ).toBe(false);
    expect(
      judge(
        "getPageCount",
        { kind: "not-pdf" },
        { outcome: "value", value: 0, ms: 0 },
      ).ok,
    ).toBe(false);
    expect(
      judge(
        "probePdf",
        { kind: "pages", pages: 1 },
        {
          outcome: "value",
          value: { read: "ok", lock: "none", pages: 2147483647 },
          ms: 0,
        },
      ).ok,
    ).toBe(false);
  });
});

describe("fixture health", () => {
  test.each(
    PAGE_STRUCTURE_FIXTURES.filter((f) => !f.slow).map(
      (f) => [f.id, f] as const,
    ),
  )("%s builds deterministically and small", async (_id, f) => {
    const a = await f.build();
    const b = await f.build();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(a.length).toBeLessThan(8 * 1024 * 1024);
  });

  test("the hostile property is present where a typo could remove it", async () => {
    const get = async (id: string) => text(await FIXTURE.get(id)!.build());
    expect(await get("H09.countMax")).toContain("/Count 2147483647");
    expect(await get("H20.pdf20")).toMatch(/^%PDF-2\.0/);
    expect(await get("H20.pdf20")).not.toMatch(/\nxref\n/);
    expect(await get("H20.pdf20")).toContain("/ObjStm");
    const self = await get("H06.self");
    const prev = /\/Prev (\d+)/.exec(self)![1];
    expect(/startxref\n(\d+)/.exec(self)![1]).toBe(prev);
    const cycle = await get("H06.cycle");
    expect([...cycle.matchAll(/\/Prev 0*(\d+)/g)].length).toBe(2);
    const first = await get("H19.dupFirst");
    const last = await get("H19.dupLast");
    expect(first).not.toBe(last);
    expect([...first.matchAll(/\n3 0 obj/g)].length).toBe(2);
    expect(await get("H23.nLie")).toContain("/N 5000");
    expect(await get("H23.firstPast")).toContain("/First 999999");
    expect(await get("H17.signedUpdate")).toMatch(
      /\/ByteRange \[0 \d{10} \d{10} \d{10}\]/,
    );
    expect((await get("H17.signedUpdate")).match(/%%EOF/g)!.length).toBe(2);
    expect((await get("H08.tree2000")).match(/\/Type \/Pages/g)!.length).toBe(
      2000,
    );
  });
});

for (const fx of [undefined, ...PAGE_STRUCTURE_FIXTURES]) {
  const fixture = fx?.id ?? "CTRL";
  describe(
    fx ? `${fx.id} — ${fx.title}` : "CTRL — well-formed 3-page control",
    () => {
      for (const engine of FILE_ENGINES) {
        const k = `${engine} × ${fixture}`;
        const finding = FINDINGS[k];
        const truth: Truth = fx?.truth ?? { kind: "pages", pages: 3 };
        const name = `${finding ? `[${finding}] ` : ""}${engine}${fx?.slow ? " (SLOW)" : ""}`;
        const body = () => {
          const r = byKey.get(k)!;
          const v = judge(engine, truth, r, fx);
          expect(v.ok, `${k}: ${v.why}`).toBe(true);
        };
        if (finding) test.fails(name, body);
        else test(name, body);
      }
    },
  );
}

describe("hostile plans on the control", () => {
  for (const engine of Object.keys(PLANS)) {
    const k = `${engine} × CTRL`;
    const finding = FINDINGS[k];
    const body = () => {
      const v = judgePlan(engine, byKey.get(k)!);
      expect(v.ok, `${k}: ${v.why}`).toBe(true);
    };
    if (finding) test.fails(`[${finding}] ${engine}`, body);
    else test(engine, body);
  }
});
