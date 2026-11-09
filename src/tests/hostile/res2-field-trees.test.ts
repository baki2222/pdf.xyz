import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine-errors";
import { MAX_FIELD_DEPTH } from "@/lib/pdf/form-tree";
import { runBounded } from "./bounded";

// res2 (l04#53): EDIT-02's field-tree repair (src/lib/pdf/form-tree.ts) ran
// in forms, flatten and create-forms only. Every other getForm() met the raw
// tree: n-up threw a bare "RangeError: Maximum call stack size exceeded" on a
// field whose /Kids names itself, the upload probe counted a 22-level
// diamond as 4,194,304 fields (and hung at 30 levels), and the editor's open
// and the signature-request worker hung on the same diamond.
//
// Every case runs in a child process: the defect is a stack overflow or a
// 2^levels walk, and only a kill stops the second.
const CHILD = "src/tests/hostile/res2-field-trees.child.ts";

async function run(name: string, entry: string, boundMs = 30_000) {
  const started = Date.now();
  const r = await runBounded(CHILD, [name, entry], boundMs);
  expect(r.kind, `${name} ${entry}: ${JSON.stringify(r)}`).toBe("settled");
  return {
    value: (r as { value: Record<string, unknown> }).value,
    ms: Date.now() - started,
  };
}

const DIAMOND_LEAF = `${"d.".repeat(30)}leaf`;

/** What each entry point reports on a working one-field form. */
const WORKING: Record<string, (field: string) => object> = {
  probe: () => ({ ok: true, read: "ok", formFields: 1 }),
  readEditorDocument: (field) => ({ ok: true, fields: [field] }),
  exportEditedPdf: () => ({ ok: true, filled: 1, saved: true }),
  exportNewField: () => ({ ok: true, filled: 0, saved: true }),
  nup: () => ({ ok: true, sheets: 1, undrawn: [] }),
  signatureInspect: (field) => ({ ok: true, pages: 1, fields: [field] }),
  signaturePlace: () => ({ ok: true, saved: true }),
};
const ENTRIES = Object.keys(WORKING);

describe("res2: every getForm() path repairs the field tree first", () => {
  for (const entry of ENTRIES) {
    test(`res2: ${entry} on a field whose /Kids names itself`, async () => {
      const { value } = await run("kids-self", entry);
      expect(value).toEqual(WORKING[entry]!("top.kid"));
    }, 40_000);

    test(`res2: ${entry} on a 30-level diamond returns, with one field`, async () => {
      const { value, ms } = await run("diamond:30", entry);
      expect(value).toEqual(WORKING[entry]!(DIAMOND_LEAF));
      // 2^30 visits before; one pass now (the bound is the child's start-up).
      expect(ms).toBeLessThan(20_000);
    }, 40_000);
  }

  // The probe never throws; a tree past MAX_FIELD_DEPTH is the same
  // "unreadable" every form tool says. The rest refuse in the loader's words.
  const deeper = `kids-chain:${MAX_FIELD_DEPTH + 1}`;
  for (const entry of ENTRIES) {
    test(`res2: ${entry} refuses a tree one level past MAX_FIELD_DEPTH`, async () => {
      const { value } = await run(deeper, entry);
      if (entry === "probe") {
        expect(value).toEqual({
          ok: true,
          read: "unreadable",
          formFields: null,
        });
      } else {
        expect(value).toEqual({
          ok: false,
          typed: true,
          kind: "unreadable",
          name: "PdfEngineError",
          message: UNREADABLE_PDF_MESSAGE,
        });
      }
    }, 40_000);

    // Positive control: exactly MAX_FIELD_DEPTH still works on this path.
    // The chain exists only as /Kids, so the leaf's name is its own /T.
    test(`res2: ${entry} accepts a tree exactly MAX_FIELD_DEPTH deep`, async () => {
      const { value } = await run(`kids-chain:${MAX_FIELD_DEPTH}`, entry);
      expect(value).toEqual(WORKING[entry]!("leaf"));
    }, 40_000);
  }
});

/**
 * The guard that finds its subjects: every non-test module under src/ that
 * calls `.getForm()` must also name `repairFieldTree` (directly, or through
 * an argument it is handed). A module added with a bare getForm() fails here
 * by name, which a list of known call sites could not do.
 */
describe("res2: no getForm() without the repair", () => {
  const SRC = path.join(process.cwd(), "src");
  /** Read-only callers that never reach pdf-lib's field walk on purpose. */
  const EXEMPT = new Set<string>([]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "tests" || name === "node_modules") continue;
        walk(full, out);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
    return out;
  }

  const callers = walk(SRC)
    .filter((file) =>
      /\.getForm\(\)/.test(stripComments(readFileSync(file, "utf8"))),
    )
    .map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/"))
    .sort();

  test("res2: the set of callers is plausible (health check)", () => {
    // forms, flatten, create-forms, editor/fields, overlay, native: if this
    // shrank, the scan (not the code) changed.
    expect(callers.length).toBeGreaterThanOrEqual(6);
    expect(callers).toContain("src/lib/pdf/editor/fields.ts");
    expect(callers).toContain("src/lib/workers/request-signatures/native.ts");
  });

  test("res2: every caller names repairFieldTree", () => {
    const bare = callers.filter(
      (file) =>
        !EXEMPT.has(file) &&
        !/repairFieldTree|FieldTreeRepair/.test(
          stripComments(readFileSync(path.join(process.cwd(), file), "utf8")),
        ),
    );
    expect(bare).toEqual([]);
  });

  test("res2: positive control: the predicate flags a bare caller", () => {
    const sample = "const f = doc.getForm(); // repairFieldTree is not called";
    const code = stripComments(sample);
    expect(/\.getForm\(\)/.test(code)).toBe(true);
    expect(/repairFieldTree|FieldTreeRepair/.test(code)).toBe(false);
  });
});

/** Code without its comments: a docblock naming the repair is not a call. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}
