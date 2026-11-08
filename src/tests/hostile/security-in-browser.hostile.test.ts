/**
 * HOSTILE MATRIX — family "security-in-browser".
 *
 * Every entry point of the in-browser security layer, put to every hostile
 * class it can meet:
 *
 *   classify ............ classifyPdfAccess(bytes, pdfjs)   (src/lib/pdf/encryption.ts)
 *   probe ............... probePdfEncryption + encryptedPdfMessage
 *   openProtected ....... openProtectedPdf                 (security/protected-pdf.ts)
 *   openWrongPassword ... openWithPassword(bytes, wrong)   (security/open-with-password.ts)
 *   openRightPassword ... openWithPassword(bytes, right)
 *   openProtectedCopy ... openProtectedCopy(file, bytes)   (runner/open-protected.ts)
 *   readXref ............ readXref(lib, bytes)             (security/document.ts)
 *   signatures .......... countDigitalSignatures(bytes)    (digital-signatures.ts)
 *   countSignatures ..... countSignatures(lib, loadPdf-style doc) (signed.ts)
 *   linearization ....... isLinearized + linearizationVerdict (linearization.ts)
 *   saveChanges ......... ProtectedPdf.saveChanges -> writeIncrementalUpdate (security/incremental.ts)
 *
 * HOW A CELL RUNS. In a child process (`security-in-browser.runner.ts`), under
 * a wall-clock bound per cell and an RSS watchdog, because the defects worth
 * finding here are synchronous: a loop that never yields freezes the thread
 * it runs on, and no vitest timeout can interrupt it. The harness kills the
 * child, records the cell as `hang` or `memory`, and resumes with the next.
 * The bomb cells (H12) each get a child of their own, so their growth is
 * measured cold (`isolate`).
 *
 * HOW A CELL IS JUDGED. By ONE predicate per entry point
 * (`security-in-browser.verdicts.ts`) against the fixture's truth — what a
 * correct reader makes of the file. An acceptable outcome is a passing `it`.
 * A cell the predicate rejects is listed in {@link FINDINGS} and written as
 * `it.fails` with its finding id in the name: the file stays green while the
 * defect is recorded, and the day the defect is fixed the `it.fails` goes red
 * and asks to be turned into a plain `it` (invert, never delete).
 *
 * NOT APPLICABLE in this family (no entry point here reaches them): H11 huge
 * image XObject (nothing here decodes an image), H24 q/Q and inline images
 * (nothing here parses a content stream), H08's Form XObject nesting (nothing
 * here walks /Resources), H10's raster consequences. H13 has its one control.
 *
 * SLOW: the whole matrix is ~1,000 cells and takes ~4-5 minutes, most of it
 * in the six hang cells (15 s bound each) and the 1 GiB bombs.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  ENTRIES,
  SECURITY_FIXTURES,
  applicable,
  type Entry,
  type FixtureSpec,
} from "./security-in-browser.cells";
import {
  runCells,
  type CellPlan,
  type CellResult,
} from "./security-in-browser.harness";
import { judge } from "./security-in-browser.verdicts";

/** Per-cell bounds. A cell that needs more than this is a finding. */
const BOUND_MS = 15_000;
const SLOW_BOUND_MS = 60_000;

/**
 * Every finding, one line each. Repros are in the fixture builders named in
 * the cell keys below (`security-in-browser.cells.ts`).
 */
export const FINDING_TEXT = {
  "SIB-01":
    "decryptDocument unpacks an object stream for its declared /N, unbounded: /N 999999999 never returns (main thread)",
  "SIB-02":
    "readXref: an xref stream with /W [0 0 0] and /Index [0 2147483647] loops 2^31 times filling a Map (OOM)",
  "SIB-03":
    "classifyPdfAccess has no bound: pdf.js blows its memory on the /W [0 0 0] xref stream",
  "SIB-04":
    "pdf-lib's own load (loadPdf, every countSignatures caller) inflates a 1 GiB xref-stream bomb and OOMs on /W [0 0 0] or a 20-digit /Size",
  "SIB-05":
    "readXref inflates the whole xref stream with no ceiling: ~1 MB of FlateDecode becomes 1 GiB in memory, before encryption is even checked",
  "SIB-06":
    "classifyPdfAccess/probePdfEncryption never settle on /Encrypt /Length 1000000000 (pdf.js key derivation spins; no timeout)",
  "SIB-07":
    "openProtectedPdf silently drops an object it cannot parse (MediaBox 1e309 or --5): the decrypted copy has 0 pages and openProtectedCopy returns pageCount 0",
  "SIB-08":
    "classifyPdfAccess returns pageCount -1 for /Count -1 (numPages taken unchecked)",
  "SIB-09":
    "classifyPdfAccess says 'unencrypted' for a file whose trailer /Encrypt is dangling or a ref to itself; its streams are ciphertext",
  "SIB-10":
    "countDigitalSignatures counts a signature object rewritten by an incremental update twice (distinct /ByteRange arrays, one signature)",
  "SIB-11":
    "countDigitalSignatures counts the text '/ByteRange [0 10 20 30]' drawn in an uncompressed content stream as a signature",
  "SIB-12":
    "countSignatures (signed.ts) counts an unsigned placeholder /ByteRange [0 /********** ...] as a signature (digital-signatures.ts refuses it)",
  "SIB-13":
    "readLinearizationDict stops at the first '>>': a nested dictionary's /L is read instead of the linearization dict's own",
  "SIB-14":
    "countSignatures throws a raw TypeError ('Cannot read properties of undefined (reading 'get')') on a document pdf-lib loads without a catalog; errorMessage() shows raw messages",
  "SIB-15":
    "classifyPdfAccess says 'password-required' (copy: 'This PDF is password-protected') for an owner-only file the empty password opens, when an object stream is malformed",
} as const;
type FindingId = keyof typeof FINDING_TEXT;

/** `fixtureId :: entry` -> finding. A cell absent here must be acceptable. */
export const FINDINGS: Readonly<Record<string, FindingId>> = {
  // SIB-01
  "H23-owner-objstm-N-1e9 :: openProtected": "SIB-01",
  "H23-owner-objstm-N-1e9 :: openProtectedCopy": "SIB-01",
  "H23-owner-objstm-N-1e9-unrelated :: openProtected": "SIB-01",
  "H23-owner-objstm-N-1e9-unrelated :: openProtectedCopy": "SIB-01",
  // SIB-02
  ...Object.fromEntries(
    [
      "H18-plain-xref-w-zero-index-2e31",
      "H18-owner-xref-w-zero-index-2e31",
    ].flatMap((id) =>
      [
        "openProtected",
        "openWrongPassword",
        "openProtectedCopy",
        "readXref",
      ].map((e) => [`${id} :: ${e}`, "SIB-02" as const]),
    ),
  ),
  // SIB-03
  "H18-plain-xref-w-zero-index-2e31 :: classify": "SIB-03",
  "H18-plain-xref-w-zero-index-2e31 :: probe": "SIB-03",
  "H18-owner-xref-w-zero-index-2e31 :: classify": "SIB-03",
  "H18-owner-xref-w-zero-index-2e31 :: probe": "SIB-03",
  // SIB-04
  "H18-plain-xref-w-zero-index-2e31 :: countSignatures": "SIB-04",
  "H18-owner-xref-w-zero-index-2e31 :: countSignatures": "SIB-04",
  "H18-plain-xref-size-huge :: countSignatures": "SIB-04",
  "H12-plain-xref-stream-flate-bomb-1GiB :: countSignatures": "SIB-04",
  "H12-plain-xref-stream-chained-flate-bomb-1GiB :: countSignatures": "SIB-04",
  "H12-owner-xref-stream-flate-bomb-1GiB :: countSignatures": "SIB-04",
  // SIB-05
  ...Object.fromEntries(
    [
      "H12-plain-xref-stream-flate-bomb-1GiB",
      "H12-plain-xref-stream-chained-flate-bomb-1GiB",
      "H12-owner-xref-stream-flate-bomb-1GiB",
    ].flatMap((id) =>
      [
        "openProtected",
        "openWrongPassword",
        "openProtectedCopy",
        "readXref",
      ].map((e) => [`${id} :: ${e}`, "SIB-05" as const]),
    ),
  ),
  // SIB-06
  "H15-hostile-encrypt-length-1e9 :: classify": "SIB-06",
  "H15-hostile-encrypt-length-1e9 :: probe": "SIB-06",
  // SIB-07
  ...Object.fromEntries(
    [
      "H18-owner-mediabox-rotate-nan",
      "H18-owner-mediabox-1e309",
      "H18-owner-mediabox-double-minus",
    ].flatMap((id) =>
      ["openProtected", "openProtectedCopy"].map((e) => [
        `${id} :: ${e}`,
        "SIB-07" as const,
      ]),
    ),
  ),
  // SIB-08
  "H09-plain-count-minus-1 :: classify": "SIB-08",
  "H09-owner-count-minus-1 :: classify": "SIB-08",
  // SIB-09
  "H15-hostile-encrypt-dangling-ref :: classify": "SIB-09",
  "H15-hostile-encrypt-ref-to-ref :: classify": "SIB-09",
  // SIB-10..14
  "H17-plain-signed-then-sig-rewritten :: signatures": "SIB-10",
  "H17-plain-byterange-in-content-text :: signatures": "SIB-11",
  "H17-plain-placeholder-byterange :: countSignatures": "SIB-12",
  "H18-linearized-nested-dict :: linearization": "SIB-13",
  "H03-header-only :: countSignatures": "SIB-14",
  // SIB-15
  ...Object.fromEntries(
    [
      "H23-owner-objstm-N-1e9",
      "H23-owner-objstm-N-1e5",
      "H23-owner-objstm-first-past-end",
    ].flatMap((id) =>
      ["classify", "probe"].map((e) => [`${id} :: ${e}`, "SIB-15" as const]),
    ),
  ),
};

const keyOf = (id: string, entry: string) => `${id} :: ${entry}`;

const PLANS: CellPlan[] = SECURITY_FIXTURES.flatMap((f) =>
  ENTRIES.filter((e) => applicable(f, e)).map((entry): CellPlan => ({
    id: f.id,
    entry,
    boundMs: f.slow ? SLOW_BOUND_MS : BOUND_MS,
    isolate: !!f.isolate,
  })),
);
/** The watchdog's positive controls, run last (see the runner). */
const SELF_TESTS: CellPlan[] = [
  { id: "CTRL-plain-one-page", entry: "__hang", boundMs: 3_000 },
  { id: "CTRL-plain-one-page", entry: "__alloc", boundMs: 30_000 },
];

let results: CellResult[] = [];
const resultOf = (i: number): CellResult => {
  const r = results[i];
  if (!r) throw new Error(`cell ${i} has no result: the matrix did not run`);
  return r;
};

beforeAll(async () => {
  results = await runCells([...PLANS, ...SELF_TESTS]);
}, 1_500_000);

describe("security-in-browser matrix: health", () => {
  it("the corpus is the size it claims (a shrinking corpus passes vacuously)", () => {
    expect(SECURITY_FIXTURES.length).toBeGreaterThanOrEqual(110);
    expect(SECURITY_FIXTURES.length).toBeLessThan(400);
    expect(new Set(SECURITY_FIXTURES.map((f) => f.id)).size).toBe(
      SECURITY_FIXTURES.length,
    );
    expect(PLANS.length).toBeGreaterThanOrEqual(1000);
  });

  it("every applicable hostile class has fixtures, and controls exist", () => {
    const classes = new Set(SECURITY_FIXTURES.map((f) => f.cls));
    const notApplicable = new Set(["H11", "H24"]);
    for (let n = 1; n <= 23; n++) {
      const cls = `H${String(n).padStart(2, "0")}`;
      if (notApplicable.has(cls)) continue;
      expect(classes, cls).toContain(cls);
    }
    expect(classes).toContain("CTRL");
  });

  it("every entry point is exercised by many fixtures", () => {
    for (const entry of ENTRIES) {
      const n = PLANS.filter((p) => p.entry === entry).length;
      const floor =
        entry === "saveChanges" ? 12 : entry === "openRightPassword" ? 20 : 100;
      expect(n, entry).toBeGreaterThanOrEqual(floor);
    }
  });

  it("the watchdog sees a hang (positive control)", () => {
    expect(resultOf(PLANS.length).status).toBe("hang");
  });

  it("the watchdog sees a memory blow-up (positive control)", () => {
    expect(resultOf(PLANS.length + 1).status).toBe("memory");
  });

  it("every fixture built: no cell failed inside its own generator", () => {
    const broken = PLANS.flatMap((p, i) => {
      const r = resultOf(i);
      return r.status === "threw" &&
        /^(encryptPdf|no endobj|no trailer|no startxref|unexpected header)/.test(
          r.message,
        )
        ? [`${p.id}: ${r.message}`]
        : [];
    });
    expect(broken).toEqual([]);
  });

  it("every finding names a planned cell, and every finding id is used", () => {
    const planned = new Set(PLANS.map((p) => keyOf(p.id, p.entry)));
    const stale = Object.keys(FINDINGS).filter((k) => !planned.has(k));
    expect(stale).toEqual([]);
    const used = new Set(Object.values(FINDINGS));
    expect(
      Object.keys(FINDING_TEXT).filter((id) => !used.has(id as FindingId)),
    ).toEqual([]);
  });

  it("every positive control cell is acceptable", () => {
    const byId = new Map(SECURITY_FIXTURES.map((f) => [f.id, f]));
    const bad = PLANS.flatMap((p, i) => {
      const f = byId.get(p.id)!;
      if (f.cls !== "CTRL") return [];
      const v = judge(f, p.entry as Entry, resultOf(i));
      return v.ok ? [] : [`${p.id} × ${p.entry}: ${v.why}`];
    });
    expect(bad).toEqual([]);
  });
});

const byClass = new Map<
  string,
  { f: FixtureSpec; plan: CellPlan; i: number }[]
>();
PLANS.forEach((plan, i) => {
  const f = SECURITY_FIXTURES.find((x) => x.id === plan.id)!;
  const list = byClass.get(f.cls) ?? [];
  list.push({ f, plan, i });
  byClass.set(f.cls, list);
});

for (const [cls, cells] of [...byClass].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  describe(`security-in-browser ${cls}`, () => {
    for (const { f, plan, i } of cells) {
      const finding = FINDINGS[keyOf(f.id, plan.entry)];
      const name = `${finding ? `[${finding}] ` : ""}${f.id} × ${plan.entry}`;
      const body = () => {
        const v = judge(f, plan.entry as Entry, resultOf(i));
        expect(v.ok, `${f.what} — ${v.why}`).toBe(true);
      };
      if (finding) it.fails(name, body);
      else it(name, body);
    }
  });
}
