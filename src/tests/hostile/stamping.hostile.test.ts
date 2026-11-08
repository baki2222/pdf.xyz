// @native-canvas
/**
 * HOSTILE-INPUT MATRIX — stamping family.
 *
 * Every stamping entry point (watermark text, watermark image, page numbers,
 * Bates, header & footer, overlay with the hostile file as the BASE and as
 * the OVERLAY, typed and image signature) against every hostile input in
 * `stamping.fixtures.ts`, one test per cell, each held to one policy:
 *
 *  - an encrypted file is refused with the typed `PdfEncryptedError`;
 *  - a file that is not a readable PDF is refused with a `PdfEngineError`
 *    (a user-facing sentence), never turned into output;
 *  - a readable file either produces output that a READER receives as the
 *    right document — the page count a correct reader finds, read back by
 *    pdf-lib AND by pdfjs; the stamp visible; on a page whose geometry
 *    matches the control, the stamp where the control put it and drawn at
 *    the control's scale — or is refused with a sentence that does not blame
 *    the user's settings for a file the engine could not read;
 *  - nothing throws a raw internal error (`errorMessage()` in the runner kit
 *    shows a non-PdfEngineError's raw `.message` to the user), hangs past
 *    the bound, or costs more than MEMORY_BUDGET_MB resident.
 *
 * A cell that meets the policy is a passing `test`. A cell that does not is
 * a `test.fails` named after its finding (STAMP-NN), so the file is green
 * while the defect stands and turns RED the day the defect is fixed — then
 * move the cell out of FINDINGS. Registering a cell that actually passes is
 * red too: the registry cannot drift from what the engines do.
 *
 * TIME BOUNDS. In-process cells race the engine against CELL_BOUND_MS, which
 * catches an async hang; a synchronous loop cannot be interrupted in-process,
 * so every input that could plausibly spin or blow the heap — the Flate bombs
 * and the 2,000-page file, all `slow` — runs in a child process
 * (`stamping.child.ts`) that is killed at CHILD_BOUND_MS. Those cells are
 * named `[SLOW]` and take ~2 minutes together. The probe that built this file
 * ran EVERY cell in a child first; no fast input hung an engine.
 *
 * Run: npx vitest run src/tests/hostile/stamping.hostile.test.ts --no-file-parallelism
 */

import { spawn } from "node:child_process";
import { viewerRotation } from "@/lib/pdf/rotation";
import { beforeAll, describe, expect, test } from "vitest";
import { STAMPING_INPUTS, type StampingInput } from "./stamping.fixtures";
import {
  baseLineAt,
  checkOutput,
  ctmAtStamp,
  ENGINES,
  runCell,
  scaleOf,
  STAMP_TEXT,
  type EngineId,
  type Outcome,
  type OutputCheck,
} from "./stamping.cells";

const CELL_BOUND_MS = 20_000;
const CHILD_BOUND_MS = 180_000;
/** Peak resident memory one cell may cost; the control costs ~130-150 MB. */
const MEMORY_BUDGET_MB = 1024;

const ALL = ENGINES;
const NOT_OVERLAY = ENGINES.filter((e) => !e.startsWith("overlay"));
const TEXT_ENGINES = ENGINES.filter(
  (e) => STAMP_TEXT[e] !== undefined && e !== "overlay-base",
);

// ------------------------------------------------------------------ findings

interface Finding {
  id: string;
  kind:
    | "crash"
    | "hang"
    | "memory"
    | "silent_wrong_output"
    | "unfriendly_error"
    | "false_claim";
  severity: "high" | "medium" | "low";
  summary: string;
  cells: (readonly [EngineId | "reader", string])[];
}

const grid = (engines: readonly (EngineId | "reader")[], inputs: string[]) =>
  inputs.flatMap((input) => engines.map((e) => [e, input] as const));

const INVALID_NUMBER_INPUTS = [
  "H18-mediabox-1e309",
  "H18-mediabox-dot",
  "H18-mediabox-double-minus",
  "H18-rotate-1e309",
];

export const FINDINGS: readonly Finding[] = [
  {
    id: "STAMP-01",
    kind: "unfriendly_error",
    severity: "medium",
    summary:
      "'%PDF-1.7\\n' alone loads in pdf-lib with no catalog; every engine then throws TypeError \"Cannot read properties of undefined (reading 'Pages')\" and errorMessage() shows it raw.",
    cells: grid(ALL, ["H03-header-only"]),
  },
  {
    id: "STAMP-02",
    kind: "crash",
    severity: "medium",
    summary:
      "/Pages /Kids containing its own ref: every engine dies with RangeError 'Maximum call stack size exceeded' (pdfjs refuses it cleanly as a circular page tree).",
    cells: grid(ALL, ["H07-kids-contain-self"]),
  },
  {
    id: "STAMP-03",
    kind: "crash",
    severity: "medium",
    summary:
      "A page whose /Parent is itself: pdfjs opens it, but watermark/page-numbers/header-footer/sign die with RangeError 'Maximum call stack size exceeded' (overlay refuses with its generic sentence).",
    cells: grid(NOT_OVERLAY, ["H07-page-parent-self"]),
  },
  {
    id: "STAMP-04",
    kind: "unfriendly_error",
    severity: "medium",
    summary:
      "/Contents naming an object whose value is a ref to itself: pdfjs opens the page, the non-overlay engines throw TypeError 'Contents.push is not a function' raw.",
    cells: grid(NOT_OVERLAY, ["H07-contents-self-ref"]),
  },
  {
    id: "STAMP-05",
    kind: "unfriendly_error",
    severity: "medium",
    summary:
      "A number where a dictionary belongs (catalog /Pages, page /Resources /XObject): 'Expected instance of PDFDict, but got instance of PDFNumber' reaches the user raw.",
    cells: [
      ...grid(ALL, ["X-malformed-pages-number"]),
      ...grid(NOT_OVERLAY, ["X-malformed-xobject-number"]),
    ],
  },
  {
    id: "STAMP-06",
    kind: "silent_wrong_output",
    severity: "high",
    summary:
      "A page dict with one non-PDF number (MediaBox 1e309 / '.' / '--5', Rotate 1e309) is dropped by pdf-lib (0 pages) while pdfjs shows the page; watermark/page-numbers/Bates then report success having stamped nothing, and the saved file reads in pdfjs as TWO pages, a blank 595x842 one first.",
    cells: grid(
      ["watermark-text", "watermark-image", "page-numbers", "bates"],
      INVALID_NUMBER_INPUTS,
    ),
  },
  {
    id: "STAMP-07",
    kind: "false_claim",
    severity: "low",
    summary:
      "Same inputs as STAMP-06: header-footer says 'No page gets the header or footer with these page settings.', sign says 'Choose a page that exists in the document.', overlay says the PDF 'has no pages' — the user's settings are blamed for a page the engine failed to read.",
    cells: grid(
      [
        "header-footer",
        "overlay-base",
        "overlay-top",
        "sign-typed",
        "sign-image",
      ],
      INVALID_NUMBER_INPUTS,
    ),
  },
  {
    id: "STAMP-08",
    kind: "silent_wrong_output",
    severity: "medium",
    summary:
      "/Rotate not a multiple of 90 (45, 1e9, 1e20): viewers (pdfjs, Acrobat) show the page unrotated — viewerRotation() — but the stamp engines place by normalizeRotation() (snap), so a page number lands sideways on a side edge and a header can vanish off the page.",
    cells: grid(
      [
        "watermark-text",
        "watermark-image",
        "page-numbers",
        "bates",
        "header-footer",
        "sign-typed",
        "sign-image",
      ],
      ["H22-rotate-45", "H22-rotate-1e9", "H18-rotate-20-digits"],
    ),
  },
  {
    id: "STAMP-09",
    kind: "silent_wrong_output",
    severity: "medium",
    summary:
      "A page whose content pops more than it pushes (Q x 100,000 then a 0.1 cm) or leaves q's open after a cm: pdf-lib's q…Q wrapper does not contain it, so the stamp is drawn inside the page's leftover 0.1 scale — ten times smaller, in the corner.",
    cells: grid(
      ENGINES.filter((e) => e !== "overlay-top"),
      ["H24-pops-then-scale", "H24-unclosed-q-scale"],
    ),
  },
  {
    id: "STAMP-10",
    kind: "silent_wrong_output",
    severity: "low",
    summary:
      "MediaBox [0 0 0 0], which viewers show as a 612x792 page: page numbers / Bates are drawn at x=-27.9 (off the page), the text watermark lands in the corner, and the image watermark throws a raw TypeError about NaN.",
    cells: grid(
      ["watermark-text", "watermark-image", "page-numbers", "bates"],
      ["H10-mediabox-zero"],
    ),
  },
  {
    id: "STAMP-11",
    kind: "silent_wrong_output",
    severity: "low",
    summary:
      "/Count -1 over one real page: the engines stamp the page pdf-lib finds and save /Count -1 unchanged, so pdfjs reads the 'stamped' output as ZERO pages.",
    cells: grid(
      ENGINES.filter((e) => e !== "overlay-top"),
      ["H09-count-negative"],
    ),
  },
  {
    id: "STAMP-12",
    kind: "memory",
    severity: "high",
    summary:
      "pdf-lib inflates every /ObjStm at parse with no cap: a 1.06 MB file holding a 1 GiB object stream costs every stamping engine ~2.1 GB resident (3 s) before anything is stamped.",
    cells: grid(ALL, ["H12-objstm-bomb-1gb"]),
  },
  {
    id: "STAMP-13",
    kind: "memory",
    severity: "high",
    summary:
      "Overlay decodes the overlay page's content streams to embed it: a 3,182-byte overlay whose content is [/FlateDecode /FlateDecode] -> 1 GiB costs ~2.1 GB resident and 8 s, and re-deflates 1 MB into the output.",
    cells: grid(["overlay-top"], ["H12-content-bomb-chained-1gb"]),
  },
  {
    id: "STAMP-14",
    kind: "hang",
    severity: "medium",
    summary:
      "A page that opens 100,000 q's (H24) never finishes in pdfjs getTextContent (> 100 s; our previews and text reads use pdfjs) — the stamping engines themselves finish in milliseconds, and the output inherits the same page.",
    cells: [["reader", "H24-unclosed-q-scale"]],
  },
];

const findingFor = (engine: EngineId | "reader", input: string) =>
  FINDINGS.find((f) => f.cells.some(([e, i]) => e === engine && i === input));

// ------------------------------------------------------------------ policy

/** Refusals that blame the user's settings or choice for a page the engine could not read. */
const BLAMES_THE_USER = [
  /with these page settings/,
  /Choose a page that exists/,
  /has no pages/,
];

/** Inputs whose output pdfjs cannot finish reading (proved by STAMP-14's reader cell). */
const READER_HANGS = new Set(
  FINDINGS.filter((f) => f.kind === "hang").flatMap((f) =>
    f.cells.map(([, i]) => i),
  ),
);

interface CellResult {
  outcome: Outcome;
  check?: OutputCheck;
  /** CTM at the stamp, when computed. */
  ctm?: number[] | null;
}

interface Context {
  input: StampingInput;
  /** The control's result for this engine (positive control). */
  control?: CellResult;
  /** pdfjs shows this input's base line exactly where it shows the control's. */
  geometryAsControl: boolean;
  /** pdf-lib reads page 1's MediaBox as [0 0 612 792], like the control. */
  mediaBoxAsControl: boolean;
}

function violations(engine: EngineId, r: CellResult, ctx: Context): string[] {
  const { outcome, check } = r;
  const v: string[] = [];
  if (outcome.kind === "internal")
    return [`internal ${outcome.errorName}: ${outcome.message}`];
  if (outcome.kind === "hang") return ["hang past the bound"];
  if (outcome.kind === "memory") return [`memory: ${outcome.message}`];
  if (outcome.peakRssMB !== undefined && outcome.peakRssMB > MEMORY_BUDGET_MB) {
    v.push(`peak RSS ${outcome.peakRssMB} MB > ${MEMORY_BUDGET_MB} MB`);
  }
  const { input } = ctx;
  if (input.encrypted) {
    if (outcome.kind !== "refused" || outcome.errorName !== "PdfEncryptedError")
      v.push(
        `encrypted input not refused as PdfEncryptedError (${outcome.kind} ${outcome.errorName ?? ""})`,
      );
    return v;
  }
  if (input.pages === undefined) {
    if (outcome.kind !== "refused") v.push("output produced from a non-PDF");
    return v;
  }
  if (outcome.kind === "refused") {
    const blamed = BLAMES_THE_USER.find((re) => re.test(outcome.message ?? ""));
    if (blamed)
      v.push(`refusal blames the user's settings: "${outcome.message}"`);
    return v;
  }
  // Produced output from a readable file: hold it to what a reader receives.
  const expected = engine === "overlay-top" ? 1 : input.pages;
  if (!check) return [...v, "no output check"];
  if (check.pages !== expected)
    v.push(`pdf-lib reads ${check.pages} pages, expected ${expected}`);
  if (!READER_HANGS.has(input.id) && check.viewerPages !== expected)
    v.push(`pdfjs reads ${check.viewerPages} pages, expected ${expected}`);
  if (
    !READER_HANGS.has(input.id) &&
    STAMP_TEXT[engine] &&
    engine !== "overlay-top"
  ) {
    if (!check.stampSeen)
      v.push(`stamp "${STAMP_TEXT[engine]}" not visible to pdfjs`);
    else if (check.stampAt && check.size) {
      const [x, y] = check.stampAt;
      const [w, h] = check.size;
      if (x < -1 || y < -1 || x > w + 1 || y > h + 1)
        v.push(`stamp at ${x},${y} is outside the ${w}x${h} page`);
    }
  }
  const control = ctx.control;
  if (ctx.geometryAsControl && control?.check && engine !== "overlay-top") {
    const want = control.check.stampAt;
    const got = check.stampAt;
    if (
      want &&
      got &&
      (Math.abs(want[0] - got[0]) > 2 || Math.abs(want[1] - got[1]) > 2)
    )
      v.push(`stamp at ${got} where the control's is at ${want}`);
    if (!want && control.ctm && r.ctm) {
      const off = control.ctm.some((c, k) => Math.abs(c - r.ctm![k]!) > 0.5);
      if (off)
        v.push(
          `image/form drawn with CTM [${r.ctm.map((n) => n.toFixed(1))}] where the control's is [${control.ctm.map((n) => n.toFixed(1))}]`,
        );
    }
  }
  if (
    ctx.mediaBoxAsControl &&
    control?.ctm &&
    r.ctm &&
    engine !== "overlay-top"
  ) {
    const ratio = scaleOf(r.ctm as never) / scaleOf(control.ctm as never);
    if (Math.abs(ratio - 1) > 0.01)
      v.push(`stamp drawn at ${ratio.toFixed(3)}x the control's scale`);
  }
  return v;
}

/** Register one cell: a passing test, or a test.fails under its finding id. */
function cell(
  engine: EngineId,
  inputId: string,
  slow: boolean,
  run: () => Promise<string[]>,
  timeout: number,
) {
  const finding = findingFor(engine, inputId);
  const name = `${slow ? "[SLOW] " : ""}${finding ? `${finding.id} ` : ""}${engine} x ${inputId}`;
  const body = async () => {
    const v = await run();
    expect(v, v.join("; ")).toEqual([]);
  };
  if (finding) test.fails(name, body, timeout);
  else test(name, body, timeout);
}

// ------------------------------------------------------------------ in-process cells

async function inProcess(
  engine: EngineId,
  bytes: Uint8Array,
  inputId: string,
): Promise<CellResult> {
  const { outcome, output } = await runCell(engine, bytes, CELL_BOUND_MS);
  if (!output) return { outcome };
  const check = READER_HANGS.has(inputId)
    ? await (async () => {
        // pdfjs cannot finish this page (STAMP-14): count pages with pdf-lib only.
        const { PDFDocument } = await import("pdf-lib");
        const pages = (await PDFDocument.load(output)).getPageCount();
        return {
          pages,
          viewerPages: -1,
          stampSeen: null,
        } satisfies OutputCheck;
      })()
    : await checkOutput(engine, output);
  const ctm = await ctmAtStamp(output).catch(() => null);
  return { outcome, check, ctm };
}

const FAST = STAMPING_INPUTS.filter((i) => !i.slow);
const SLOW = STAMPING_INPUTS.filter((i) => i.slow);

const control: Partial<Record<EngineId, CellResult>> = {};
const controlBytes = () =>
  STAMPING_INPUTS.find((i) => i.id === "CONTROL-valid")!.build();
let controlBaseLine: Awaited<ReturnType<typeof baseLineAt>> = null;

beforeAll(async () => {
  const bytes = await controlBytes();
  controlBaseLine = await baseLineAt(bytes);
  for (const engine of ENGINES)
    control[engine] = await inProcess(engine, bytes, "CONTROL-valid");
}, 120_000);

async function contextFor(
  input: StampingInput,
  bytes: Uint8Array,
  engine: EngineId,
): Promise<Context> {
  const base = READER_HANGS.has(input.id) ? null : await baseLineAt(bytes);
  let mediaBoxAsControl = false;
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const page = doc.getPage(0);
    const box = page.getMediaBox();
    // A genuinely rotated page draws an image mark across its DISPLAYED
    // width; only an upright 612x792 page shares the control's scale.
    mediaBoxAsControl =
      box.x === 0 &&
      box.y === 0 &&
      box.width === 612 &&
      box.height === 792 &&
      viewerRotation(page.getRotation().angle) === 0;
  } catch {
    mediaBoxAsControl = false;
  }
  return {
    input,
    control: control[engine],
    geometryAsControl:
      base !== null &&
      controlBaseLine !== null &&
      JSON.stringify(base) === JSON.stringify(controlBaseLine),
    mediaBoxAsControl,
  };
}

describe("stamping x hostile input (in-process)", () => {
  for (const input of FAST) {
    for (const engine of ENGINES) {
      cell(
        engine,
        input.id,
        false,
        async () => {
          const bytes = await input.build();
          const result = await inProcess(engine, bytes, input.id);
          return violations(
            engine,
            result,
            await contextFor(input, bytes, engine),
          );
        },
        CELL_BOUND_MS + 30_000,
      );
    }
  }
});

// ------------------------------------------------------------------ child-process cells

interface ChildResult extends Outcome {
  check?: OutputCheck;
  viewerPages?: number;
  checkHung?: boolean;
}

function runChild(
  mode: EngineId | "reader",
  inputId: string,
  bound: number,
): Promise<ChildResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=4096",
        "--import",
        "tsx",
        "src/tests/hostile/stamping.child.ts",
        mode,
        inputId,
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), bound);
    child.on("exit", () => {
      clearTimeout(timer);
      const ms = Date.now() - t0;
      const full = stdout.match(/@@OUTCOME(.*)/);
      const engineOnly = stdout.match(/@@ENGINE(.*)/);
      if (full) return resolve(JSON.parse(full[1]!) as ChildResult);
      if (engineOnly)
        return resolve({
          ...(JSON.parse(engineOnly[1]!) as ChildResult),
          checkHung: true,
        });
      const died =
        /heap out of memory|Allocation failed|Array buffer allocation/i.test(
          stderr,
        );
      resolve({
        kind: ms >= bound ? "hang" : died ? "memory" : "internal",
        message: ms >= bound ? `killed at ${bound} ms` : stderr.slice(-400),
        ms,
      });
    });
  });
}

/** Run `jobs` with at most `limit` children alive (the bombs cost ~2 GB each). */
async function pool<T>(
  jobs: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < jobs.length) {
        const k = next++;
        out[k] = await jobs[k]!();
      }
    }),
  );
  return out;
}

describe("stamping x hostile input ([SLOW], child process per cell)", () => {
  const results = new Map<string, ChildResult>();
  const key = (e: string, i: string) => `${e}|${i}`;

  beforeAll(async () => {
    const jobs = SLOW.flatMap((input) =>
      ENGINES.map((engine) => async () => {
        results.set(
          key(engine, input.id),
          await runChild(engine, input.id, CHILD_BOUND_MS),
        );
      }),
    );
    jobs.push(async () => {
      results.set(
        key("reader", "H24-unclosed-q-scale"),
        await runChild("reader", "H24-unclosed-q-scale", 20_000),
      );
    });
    await pool(jobs, 2);
  }, 900_000);

  for (const input of SLOW) {
    for (const engine of ENGINES) {
      cell(
        engine,
        input.id,
        true,
        async () => {
          const r = results.get(key(engine, input.id));
          if (!r) return ["child produced no result"];
          if (r.checkHung) return ["reading the output back hung"];
          return violations(
            engine,
            { outcome: r, check: r.check },
            { input, geometryAsControl: false, mediaBoxAsControl: false },
          );
        },
        10_000,
      );
    }
  }

  const readerFinding = findingFor("reader", "H24-unclosed-q-scale");
  test.fails(
    `[SLOW] ${readerFinding?.id ?? "STAMP-14"} reader (pdfjs) x H24-unclosed-q-scale finishes within 20 s`,
    () => {
      const r = results.get(key("reader", "H24-unclosed-q-scale"));
      expect(r?.kind).toBe("output");
    },
  );
});

// ------------------------------------------------------------------ health checks

describe("stamping matrix health", () => {
  test("the corpus covers every hostile class H01..H24, a control, and is plausibly sized", () => {
    const classes = new Set(STAMPING_INPUTS.map((i) => i.cls));
    const wanted = Array.from(
      { length: 24 },
      (_, k) => `H${String(k + 1).padStart(2, "0")}`,
    );
    expect(wanted.filter((c) => !classes.has(c))).toEqual([]);
    expect(classes.has("CONTROL")).toBe(true);
    expect(STAMPING_INPUTS.length).toBeGreaterThanOrEqual(70);
    expect(STAMPING_INPUTS.length).toBeLessThanOrEqual(120);
    expect(new Set(STAMPING_INPUTS.map((i) => i.id)).size).toBe(
      STAMPING_INPUTS.length,
    );
  });

  test("every registered finding cell names a real engine and a real input", () => {
    const ids = new Set(STAMPING_INPUTS.map((i) => i.id));
    const bad = FINDINGS.flatMap((f) =>
      f.cells
        .filter(
          ([e, i]) => !ids.has(i) || (e !== "reader" && !ENGINES.includes(e)),
        )
        .map(([e, i]) => `${f.id}: ${e} x ${i}`),
    );
    expect(bad).toEqual([]);
  });

  test("positive control: every engine stamps the valid file, visibly, where expected", () => {
    for (const engine of ENGINES) {
      const r = control[engine]!;
      expect(r.outcome.kind, engine).toBe("output");
      expect(r.check?.pages, engine).toBe(1);
      expect(r.check?.viewerPages, engine).toBe(1);
      if (STAMP_TEXT[engine] && engine !== "overlay-top")
        expect(r.check?.stampSeen, engine).toBe(true);
      expect(r.ctm, engine).not.toBeNull();
    }
    expect(controlBaseLine).not.toBeNull();
    expect(TEXT_ENGINES.length).toBe(5);
  });

  test("negative control: the position rule sees a stamp moved, the scale rule a stamp shrunk", async () => {
    const { addPageNumbers } = await import("@/lib/pdf/page-numbers");
    const bytes = await controlBytes();
    const moved = await addPageNumbers(bytes, { position: "top-left" });
    const result: CellResult = {
      outcome: { kind: "output", ms: 0 },
      check: await checkOutput("page-numbers", moved),
      ctm: await ctmAtStamp(moved),
    };
    const ctx: Context = {
      input: STAMPING_INPUTS.find((i) => i.id === "CONTROL-valid")!,
      control: control["page-numbers"],
      geometryAsControl: true,
      mediaBoxAsControl: true,
    };
    expect(violations("page-numbers", result, ctx).join()).toMatch(
      /where the control's is at/,
    );
    const shrunk: CellResult = {
      ...result,
      check: control["page-numbers"]!.check,
      ctm: [0.1, 0, 0, 0.1, 0, 0],
    };
    expect(violations("page-numbers", shrunk, ctx).join()).toMatch(
      /0\.100x the control's scale/,
    );
  });

  test("the CTM reader follows q/Q/cm like a viewer: a surplus Q is ignored", async () => {
    const { buildPdf, onePageObjects, TEXT_OPS } =
      await import("./stamping.fixtures");
    const balanced = buildPdf({
      objects: onePageObjects(
        "",
        undefined,
        `q 0.1 0 0 0.1 0 0 cm Q ${TEXT_OPS}`,
      ),
    });
    const surplus = buildPdf({
      objects: onePageObjects(
        "",
        undefined,
        `Q Q 0.1 0 0 0.1 0 0 cm ${TEXT_OPS}`,
      ),
    });
    const inString = buildPdf({
      objects: onePageObjects(
        "",
        undefined,
        `BT /F1 9 Tf (q 5 0 0 5 0 0 cm) Tj ET ${TEXT_OPS}`,
      ),
    });
    expect(scaleOf((await ctmAtStamp(balanced))!)).toBeCloseTo(1);
    expect(scaleOf((await ctmAtStamp(surplus))!)).toBeCloseTo(0.1);
    expect(scaleOf((await ctmAtStamp(inString))!)).toBeCloseTo(1);
  });

  test("a sane reader opens every input the corpus says is readable (pdfjs or pdf-lib), so 'readable' is not a typo", async () => {
    // pdfjs or pdf-lib must find >= 1 page in each input with `pages`, except
    // the encrypted ones; this keeps the policy's "readable" honest.
    const { PDFDocument } = await import("pdf-lib");
    const unreadable: string[] = [];
    for (const input of FAST.filter(
      (i) => i.pages !== undefined && !READER_HANGS.has(i.id),
    )) {
      const bytes = await input.build();
      const libPages = await PDFDocument.load(bytes).then(
        (d) => d.getPageCount(),
        () => 0,
      );
      const viewerPages =
        libPages > 0
          ? libPages
          : await import("../pdfjs-viewer").then(
              (m) => m.readAsViewer(bytes).then((p) => p.length),
              () => 0,
            );
      if (viewerPages < 1) unreadable.push(input.id);
    }
    // /Count -1 hides the page from pdfjs; pdf-lib still finds it.
    expect(unreadable).toEqual([]);
  }, 120_000);
});
