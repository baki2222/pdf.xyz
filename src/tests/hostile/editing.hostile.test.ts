// @native-canvas
import { afterAll, describe, expect, test } from "vitest";
import { signaturesKept } from "@/lib/pdf/editor/append-update";
import { editPdf } from "@/lib/pdf/edit";
import { readAsViewer } from "@/tests/pdf-viewer-read";
import { CellPool, type BoundedOutcome } from "./editing-cell-pool";
import { OPS } from "./editing-cell-worker";
import {
  describeOutcome,
  judge,
  type Problem,
  type ViewerFacts,
} from "./editing-judge";
import {
  editingFixtures,
  signedPdf,
  signedThenSignatureReplaced,
  slowEditingFixtures,
  type HostileFixture,
} from "./editing.fixtures";

/**
 * HOSTILE-INPUT MATRIX — family "editing": edit-pdf (simple ops and the full
 * editor export), the signed-file append path, annotate, forms fill, create
 * forms, flatten, metadata, crop / auto-crop, resize.
 *
 * Every entry point × every hostile fixture is one CELL. A cell runs in a
 * worker thread under a hard bound (`./editing-cell-pool.ts`): pdf-lib parses
 * synchronously, so a vitest timeout alone could never record a hang — the
 * whole run would freeze instead. What the cell's outcome MEANS is
 * `./editing-judge.ts`, against the fixture's declared page count and against
 * pdf.js's reading of the same bytes (the viewer the product renders with).
 *
 * An acceptable cell is a plain test. A cell that shows a problem is a
 * `test.fails` carrying its finding id, so the file is green while the
 * findings are recorded — and a FIXED finding turns its cell red, which is
 * the signal to move it out of FINDINGS (invert, never delete).
 *
 * Run: npx vitest run src/tests/hostile/editing.hostile.test.ts --no-file-parallelism
 */

/** Per-cell bound for the fast corpus. Every fast cell measured < 1.5 s. */
const BOUND_MS = 8_000;
/** Per-cell bound for the SLOW corpus (2,000 pages, decompression bombs). */
const SLOW_BOUND_MS = 60_000;
/** A fresh worker loads tsx + pdf-lib before its first cell. */
const STARTUP_MS = 30_000;

const FIXTURES = await editingFixtures();
const SLOW = await slowEditingFixtures();
const OP_NAMES = Object.keys(OPS);

/* ------------------------------------------------------------------ *
 *  Findings. Each rule names its cells; a rule whose cells PASS fails
 *  the run (test.fails), so the map cannot outlive the defect.
 * ------------------------------------------------------------------ */

interface FindingRule {
  id: string;
  fixtures: readonly string[];
  /** Ops, or every op except `except`. */
  ops: readonly string[] | "*";
  except?: readonly string[];
}

/** Every op that walks the page tree (all but the pure/structure readers). */
const PAGE_WALKERS = OP_NAMES.filter(
  (op) =>
    ![
      "append.appendEditsAsUpdate",
      "append.signaturesKept(self)",
      "append.signaturesKept(resaved)",
      "forms.inspectFormFields",
      "forms.applyFormValues",
      "forms.applyFormValues(flatten)",
      "flatten.inspectForm",
      "flatten.flattenPdf",
      "metadata.readPdfMetadata",
      "metadata.writePdfMetadata(edit)",
      "metadata.writePdfMetadata(remove-all)",
    ].includes(op),
);

const DISPLAYED_SIZE_READERS = [
  "edit.getEditPageSizes",
  "edit.checkEditTextFit(sizes)",
  "editor.readEditorDocument",
  "editor.readExportFrames",
  "annotate.getAnnotatePageSizes",
  "annotate.findNoteOverflows(sizes)",
  "createForms.readFormContext",
  "crop.getPageSizes",
];

const H18_PAGE_DROPPED = [
  "H18-mediabox-1e309",
  "H18-mediabox-dot",
  "H18-mediabox-double-minus",
  "H18-rotate-1e309",
  "H18-cropbox-dot-minus",
];

const FINDINGS: readonly FindingRule[] = [
  // Page-tree cycles: raw "Maximum call stack size exceeded".
  { id: "EDIT-01", fixtures: ["H07-page-parent-self"], ops: PAGE_WALKERS },
  {
    id: "EDIT-01",
    fixtures: ["H07-kids-contains-self"],
    ops: [
      ...PAGE_WALKERS,
      "forms.applyFormValues",
      "forms.applyFormValues(flatten)",
      "flatten.flattenPdf",
      "metadata.writePdfMetadata(remove-all)",
    ],
  },
  // AcroForm field cycles: raw "Maximum call stack size exceeded".
  {
    id: "EDIT-02",
    fixtures: ["H07-form-kids-cycle", "H07-form-parent-self"],
    ops: [
      "forms.inspectFormFields",
      "forms.applyFormValues",
      "forms.applyFormValues(flatten)",
      "createForms.readFormContext",
      "createForms.createFormFields",
      "flatten.inspectForm",
      "flatten.flattenPdf",
    ],
  },
  // No catalog after a "successful" load: raw TypeError on first use.
  {
    id: "EDIT-03",
    fixtures: [
      "H03-header-only",
      "H23-objstm-n-lies",
      "H23-objstm-first-past-end",
    ],
    ops: "*",
    except: [
      "append.appendEditsAsUpdate",
      "append.signaturesKept(self)",
      "append.signaturesKept(resaved)",
    ],
  },
  // Catalog /Pages is a ref to itself: raw "Expected instance of PDFDict".
  {
    id: "EDIT-04",
    fixtures: ["H07-pages-is-self-ref"],
    ops: [
      ...PAGE_WALKERS,
      "forms.applyFormValues",
      "forms.applyFormValues(flatten)",
      "flatten.flattenPdf",
      "metadata.writePdfMetadata(remove-all)",
    ],
  },
  // One malformed number in a page dict drops the page: a 1-page file reads as 0.
  {
    id: "EDIT-05",
    fixtures: H18_PAGE_DROPPED,
    ops: PAGE_WALKERS,
  },
  // Zero-area MediaBox: engines measure 0 x 0 / 0 x 300; pdf.js shows 612 x 792.
  {
    id: "EDIT-06",
    fixtures: ["H10-mediabox-zero", "H18-mediabox-neg-zero"],
    ops: [...DISPLAYED_SIZE_READERS, "crop.getUprightPageSizes"],
  },
  // /Rotate not a multiple of 90: engines snap to 90/270, pdf.js shows 0.
  {
    id: "EDIT-07",
    fixtures: ["H22-rotate-45", "H22-rotate-1e9"],
    ops: DISPLAYED_SIZE_READERS,
  },
  // Duplicate object number: pdf-lib takes the LAST definition, pdf.js the xref's.
  {
    id: "EDIT-08",
    fixtures: ["H19-duplicate-id-xref-first"],
    ops: [...DISPLAYED_SIZE_READERS, "crop.getUprightPageSizes"],
  },
  // Unbalanced q in the page: drawn edits inherit the page's leftover transform.
  {
    id: "EDIT-09",
    fixtures: ["H24-unbalanced-q-100k", "H24-unclosed-q-cm-2"],
    ops: [
      "edit.editPdf",
      "editor.exportEditedPdf",
      "append.saveSignedEdit",
      "annotate.annotatePdf",
    ],
  },
  // Canvas resize of a 1e20-wide page: a zero-width output page, reported as success.
  {
    id: "EDIT-10",
    fixtures: ["H18-mediabox-20-digits"],
    ops: ["resize.resizePdf(canvas)"],
  },
  // Metadata edit inflates the existing XMP with no cap: 1 MB in, > 2 GB peak.
  {
    id: "EDIT-11",
    fixtures: ["H12-bomb-xmp-1gib"],
    ops: ["metadata.writePdfMetadata(edit)"],
  },
];

function findingFor(fixture: string, op: string): string | undefined {
  for (const rule of FINDINGS) {
    if (!rule.fixtures.includes(fixture)) continue;
    if (rule.except?.includes(op)) continue;
    if (rule.ops === "*" || rule.ops.includes(op)) return rule.id;
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 *  The viewer's reading (pdf.js), the bound the engines' sizes answer to.
 * ------------------------------------------------------------------ */

const viewerCache = new Map<string, Promise<ViewerFacts | undefined>>();

function viewerFacts(f: HostileFixture): Promise<ViewerFacts | undefined> {
  let hit = viewerCache.get(f.id);
  if (!hit) {
    hit = (async () => {
      if (f.encrypted || f.bytes.length === 0) return undefined;
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const task = pdfjs.getDocument({
        data: f.bytes.slice(),
        useWorkerFetch: false,
        disableFontFace: true,
        verbosity: 0,
      });
      try {
        const doc = await Promise.race([
          task.promise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("pdf.js timeout")), 5_000),
          ),
        ]);
        if (doc.numPages < 1) return undefined;
        const page = await doc.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        return {
          pages: doc.numPages,
          width: vp.width,
          height: vp.height,
          rotate: page.rotate,
        };
      } catch {
        return undefined;
      } finally {
        await task.destroy().catch(() => {});
      }
    })();
    viewerCache.set(f.id, hit);
  }
  return hit;
}

/** /UserUnit scales pdf.js's points; the engines' frame is user space by design. */
const VIEWER_SIZE_EXEMPT = new Set(["H10-userunit"]);

/* ------------------------------------------------------------------ *
 *  The cell.
 * ------------------------------------------------------------------ */

const controlQ = new Map<string, number>();

async function runAndJudge(
  pool: CellPool,
  f: HostileFixture,
  op: string,
  bound: number,
): Promise<{ outcome: BoundedOutcome; problem: Problem | null }> {
  const measureQ = f.id === "CONTROL-valid" || f.cls === "H24";
  const outcome = await pool.run(op, f.bytes, bound, undefined, measureQ);
  if (f.id === "CONTROL-valid" && outcome.status === "ok" && outcome.output)
    controlQ.set(op, outcome.output.qDepthBeforeLastStream ?? 0);
  const viewer = VIEWER_SIZE_EXEMPT.has(f.id)
    ? undefined
    : await viewerFacts(f);
  const problem = judge(f, op, outcome, {
    viewer,
    controlQ: controlQ.get(op) ?? 0,
  });
  return { outcome, problem };
}

function cellTests(
  pool: CellPool,
  fixtures: readonly HostileFixture[],
  bound: number,
  slow: boolean,
) {
  for (const f of fixtures) {
    describe(`${f.id} — ${f.what}`, () => {
      for (const op of OP_NAMES) {
        const finding = findingFor(f.id, op);
        const name = `${finding ? `[${finding}] ` : ""}${slow ? "[SLOW] " : ""}${op}`;
        const body = async () => {
          const { outcome, problem } = await runAndJudge(pool, f, op, bound);
          expect(
            problem,
            `${f.id} x ${op}: ${describeOutcome(outcome)}`,
          ).toBeNull();
        };
        if (finding) test.fails(name, body, bound + STARTUP_MS + 5_000);
        else test(name, body, bound + STARTUP_MS + 5_000);
      }
    });
  }
}

/* ------------------------------------------------------------------ *
 *  Health: the corpus, the ops, the judge, the viewer bound.
 * ------------------------------------------------------------------ */

describe("health: the matrix is the size it claims", () => {
  test("ops are derived from the worker's table and none went missing", () => {
    expect(OP_NAMES.length).toBeGreaterThanOrEqual(29);
    for (const entry of [
      "edit.editPdf",
      "editor.exportEditedPdf",
      "append.saveSignedEdit",
      "annotate.annotatePdf",
      "forms.applyFormValues",
      "createForms.createFormFields",
      "flatten.flattenPdf",
      "metadata.writePdfMetadata(edit)",
      "crop.cropPdf",
      "autoCrop.chain",
      "resize.resizePdf(fit)",
    ])
      expect(OP_NAMES).toContain(entry);
  });

  test("the corpus covers every hostile class and has not shrunk", () => {
    const all = [...FIXTURES, ...SLOW];
    expect(FIXTURES.length).toBeGreaterThanOrEqual(65);
    expect(SLOW.length).toBeGreaterThanOrEqual(6);
    const classes = new Set(all.map((f) => f.cls));
    for (let i = 1; i <= 24; i++)
      expect(classes).toContain(`H${String(i).padStart(2, "0")}`);
    expect(new Set(all.map((f) => f.id)).size).toBe(all.length);
  });

  test("every finding rule names fixtures and ops that exist", () => {
    const ids = new Set([...FIXTURES, ...SLOW].map((f) => f.id));
    for (const rule of FINDINGS) {
      for (const f of rule.fixtures) expect(ids, rule.id).toContain(f);
      if (rule.ops !== "*")
        for (const op of rule.ops) expect(OP_NAMES, rule.id).toContain(op);
    }
  });

  test("the judge can go red: each failure class is detected (negative controls)", () => {
    const f = FIXTURES.find((x) => x.id === "CONTROL-valid")!;
    const raw: BoundedOutcome = {
      status: "threw",
      name: "TypeError",
      message: "Cannot read properties of undefined",
      engine: false,
      encryptedError: false,
    };
    expect(judge(f, "edit.editPdf", raw)?.kind).toBe("internal_error");
    expect(judge(f, "edit.editPdf", { status: "hang", ms: 1 })?.kind).toBe(
      "hang",
    );
    expect(
      judge(f, "edit.editPdf", { status: "memory", message: "oom" })?.kind,
    ).toBe("memory");
    expect(
      judge(f, "edit.getEditPageSizes", {
        status: "ok",
        value: [{ width: 300, height: 400 }],
      })?.kind,
    ).toBe("wrong"); // one size for a 2-page file
    expect(
      judge(
        f,
        "edit.getEditPageSizes",
        {
          status: "ok",
          value: [
            { width: 300, height: 400 },
            { width: 300, height: 400 },
          ],
        },
        { viewer: { pages: 2, width: 400, height: 300, rotate: 0 } },
      )?.kind,
    ).toBe("wrong"); // sizes the viewer does not show
    expect(
      judge(f, "edit.editPdf", {
        status: "ok",
        value: {},
        output: {
          bytes: 1,
          reloads: true,
          pages: 2,
          qDepthBeforeLastStream: 3,
        },
      })?.kind,
    ).toBe("wrong"); // drawn inside leftover graphics state
    expect(
      judge(f, "metadata.writePdfMetadata(edit)", {
        status: "ok",
        value: {},
        peakRssGrowthMb: 2000,
      })?.kind,
    ).toBe("memory");
    const enc = FIXTURES.find((x) => x.encrypted === "needs-password")!;
    expect(
      judge(enc, "edit.editPdf", {
        ...raw,
        name: "PdfEngineError",
        engine: true,
        kind: "unreadable",
      })?.kind,
    ).toBe("internal_error"); // "unreadable" for a password file
  });

  test("the declared page counts agree with pdf.js wherever pdf.js can read the file", async () => {
    // pdf.js is the second bound: a fixture whose declared count only the
    // author believes would make every count assertion below agree with a typo.
    const PDFJS_CANNOT = new Set([
      "H04-truncated-at-endobj", // pdf-lib recovers objects; pdf.js refuses
      "H09-count-negative", // pdf.js reports numPages -1
    ]);
    const checked: string[] = [];
    for (const f of FIXTURES) {
      if (f.pages === undefined || f.encrypted || PDFJS_CANNOT.has(f.id))
        continue;
      const v = await viewerFacts(f);
      expect(v?.pages, f.id).toBe(f.pages);
      checked.push(f.id);
    }
    expect(checked.length).toBeGreaterThanOrEqual(45);
  }, 120_000);
});

/* ------------------------------------------------------------------ *
 *  The matrix.
 * ------------------------------------------------------------------ */

const fastPool = new CellPool();
const slowPool = new CellPool();
afterAll(async () => {
  await fastPool.close();
  await slowPool.close();
});

describe("matrix: every editing entry point x every fast hostile fixture", () => {
  cellTests(fastPool, FIXTURES, BOUND_MS, false);
});

describe("matrix [SLOW]: decompression bombs first (peak memory is process-wide), then 2,000 pages", () => {
  const ordered = [...SLOW].sort(
    (a, b) => (a.cls === "H12" ? 0 : 1) - (b.cls === "H12" ? 0 : 1),
  );
  cellTests(slowPool, ordered, SLOW_BOUND_MS, true);
});

/* ------------------------------------------------------------------ *
 *  Plans: hostile page indices on a valid file (H22).
 * ------------------------------------------------------------------ */

describe("plans: hostile page numbers on the valid control (H22)", () => {
  const control = FIXTURES.find((f) => f.id === "CONTROL-valid")!;
  const plans: { op: string; plan: unknown; what: string }[] = [
    { op: "edit.editPdf", plan: 0, what: "page 0 (1-based API)" },
    { op: "edit.editPdf", plan: -1, what: "page -1" },
    { op: "edit.editPdf", plan: 1.5, what: "page 1.5" },
    { op: "edit.editPdf", plan: 3, what: "page 3 of 2" },
    { op: "annotate.annotatePdf", plan: -1, what: "page -1" },
    { op: "annotate.annotatePdf", plan: Number.NaN, what: "page NaN" },
    { op: "editor.exportEditedPdf", plan: -1, what: "page index -1" },
    { op: "editor.exportEditedPdf", plan: 2, what: "page index 2 of 2" },
    { op: "createForms.createFormFields", plan: -1, what: "page -1" },
    { op: "createForms.createFormFields", plan: 1e9, what: "page 1e9" },
    { op: "crop.cropPdf", plan: [-1], what: "pages [-1]" },
    { op: "crop.cropPdf", plan: [99], what: "pages [99]" },
    { op: "resize.resizePdf(fit)", plan: [-1], what: "pages [-1]" },
  ];
  for (const { op, plan, what } of plans) {
    test(
      `${op} with ${what}: refused in words, never wrapped to another page`,
      async () => {
        const outcome = await fastPool.run(op, control.bytes, BOUND_MS, plan);
        if (outcome.status === "threw") {
          expect(outcome.engine, describeOutcome(outcome)).toBe(true);
          return;
        }
        // Output: nothing may have landed on a page the plan did not name.
        expect(outcome.status, describeOutcome(outcome)).toBe("ok");
        expect.fail(
          `accepted a page plan of ${what}: ${describeOutcome(outcome)}`,
        );
      },
      BOUND_MS + STARTUP_MS + 5_000,
    );
  }
});

/* ------------------------------------------------------------------ *
 *  Read at the point of consumption: what a VIEWER shows.
 * ------------------------------------------------------------------ */

describe("viewer proofs", () => {
  /** Edit PDF draws a 20 x 20 box at (10,10); what pdf.js then paints, rounded. */
  async function boxesAfterEdit(id: string): Promise<string[]> {
    const f = FIXTURES.find((x) => x.id === id)!;
    const out = await editPdf(f.bytes, [
      {
        type: "rect",
        page: 1,
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        color: "#ff0000",
      },
    ]);
    const read = await readAsViewer(out.bytes);
    return read.paths.map((b) => b.map((n) => Math.round(n)).join(","));
  }

  // The 100,000-q fixture is NOT used here: pdf.js needs minutes on it, and a
  // timeout inside test.fails is a vacuous "expected failure". The minimal
  // repro shows the same defect in milliseconds.
  test.fails(
    "[EDIT-09] a box drawn at (10,10) on a page that leaves 'q 0.1 0 0 0.1 0 0 cm q' open lands at (10,10)",
    async () => {
      const boxes = await boxesAfterEdit("H24-unclosed-q-cm-2");
      // Health: the read happened and saw the page's own content — so a red
      // here is the placement, not a blind reader.
      expect(boxes).toContain("50,50,130,130");
      expect(boxes, `paths a viewer draws: ${boxes.join(" | ")}`).toContain(
        "10,10,30,30",
      );
    },
    60_000,
  );

  test("[EDIT-09] observed today: that box lands at (1,1)-(3,3), scaled by the page's leftover cm (invert when fixed)", async () => {
    expect(await boxesAfterEdit("H24-unclosed-q-cm-2")).toContain("1,1,3,3");
  }, 60_000);

  test("positive control: ONE unclosed q is absorbed by the engines' wrapper — the box lands at (10,10)", async () => {
    const boxes = await boxesAfterEdit("H24-unclosed-q-1");
    expect(boxes).toContain("50,50,130,130");
    expect(boxes).toContain("10,10,30,30");
  }, 60_000);

  test("positive control: the same box on the valid control lands where it was drawn", async () => {
    expect(await boxesAfterEdit("CONTROL-valid")).toContain("10,10,30,30");
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 *  H17: the signature verdict against the bytes.
 * ------------------------------------------------------------------ */

describe("H17: signature count and kept/broken verdict agree with the bytes", () => {
  test("an update that REDEFINES the signature value is reported broken", async () => {
    expect(
      await signaturesKept(signedPdf(), signedThenSignatureReplaced()),
    ).toEqual({ total: 1, kept: 0 });
  });

  test.fails(
    "[EDIT-12] a signature whose /ByteRange covers nothing ([0 0 0 0]) is not reported kept after a full rewrite",
    async () => {
      const { PDFDocument } = await import("pdf-lib");
      const zero = signedPdf(() => [0, 0, 0, 0]);
      const rewritten = await (
        await PDFDocument.load(zero)
      ).save({ useObjectStreams: false });
      expect(Buffer.from(rewritten).equals(Buffer.from(zero))).toBe(false); // health: really rewritten
      expect((await signaturesKept(zero, rewritten)).kept).toBe(0);
    },
  );

  test("positive control: an honest ByteRange is reported broken after the same rewrite", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const honest = signedPdf();
    const rewritten = await (
      await PDFDocument.load(honest)
    ).save({ useObjectStreams: false });
    expect(await signaturesKept(honest, rewritten)).toEqual({
      total: 1,
      kept: 0,
    });
  });
});
