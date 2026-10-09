/**
 * What the production proof of AI Data Extraction asks, and what it accepts as
 * PROOF — the extraction a user downloads, not the container it arrives in.
 *
 * ── WHY (2026-09-28) ────────────────────────────────────────────────────────
 *
 * `scripts/worker-prove-tools.ts` checked the ai-extract artifact with
 * `isZipContainer` and nothing else. A package whose extraction.json was `{}`
 * — every requested field dropped — was a valid ZIP, so the harness would have
 * certified a blank extraction as a working tool. The container is the
 * author's artifact; the values inside it are what the reader receives.
 *
 * ── WHY THE QUESTION CHANGED (2026-10-09) ───────────────────────────────────
 *
 * The first production run of the 2026-09-28 verifier failed: "every requested
 * value is null". The proof asked for ONE `region` (string) and ONE `q1`
 * (number) from a table of FOUR regions, and the engine tells the model "When
 * a requested value is not present in the text, use null — never a guess".
 * Four candidates is not one value, so null was the instruction followed. The
 * request had no single right answer, and the verifier — which accepted any one
 * row — was written against a reply its author typed, never one a model gave:
 * the only earlier "pass" (2026-09-17) predates any check of the values.
 *
 * Measured, not assumed: the composed chain (route → queue → executor →
 * processor → engine) hands the model every cell of the table, for a job that
 * declares its characters and for one that does not
 * (`workers/ai-extract-read.chain.test.ts`); and a model that follows the
 * engine's prompt to the letter, shown that whole table, answers the old
 * request with exactly the production failure (`./extraction-proof.test.ts`).
 *
 * So the proof now asks for each column AS A LIST — a request with one right
 * answer — and accepts that whole answer and nothing less. That is also the
 * stronger proof: one row is what a document cut after its first row would
 * give, and only the whole column shows the whole table reached the model.
 *
 * ── WHAT IS CHECKED ─────────────────────────────────────────────────────────
 *
 * Against the proof's own table ({@link PROOF_TABLE_ROWS}, which
 * `proofTablePdf` in `@/tests/extraction-proof-fixtures` draws, so the request,
 * the fixture and the expected answer are one definition):
 *
 *  - extraction.json is an object carrying every requested key;
 *  - none is listed in manifest.json's `extraction.missingKeys` — since the
 *    engine fills a dropped field with null, "the key is present" alone would
 *    be satisfied by an extraction of nothing;
 *  - at least one value is non-null;
 *  - each value is its column, every row, top to bottom — tolerating how a
 *    model writes a number ("1,200", "1200", 1200) or a name (case, padding),
 *    but not a value, a row or an order the table does not hold.
 */
import JSZip from "jszip";

/** The table the proof PDF draws: a header row, then one row per region. */
export const PROOF_TABLE_ROWS: readonly (readonly string[])[] = [
  ["Region", "Q1", "Q2", "Q3"],
  ["North", "1200", "1350", "1410"],
  ["South", "980", "1020", "1105"],
  ["East", "1560", "1490", "1620"],
  ["West", "720", "860", "915"],
];

/** The heading the proof PDF draws above the table. */
export const PROOF_TABLE_TITLE = "Quarterly results";

/** The columns the proof asks the model for, by their header in the table. */
export const PROOF_EXTRACTION_COLUMNS = ["Region", "Q1"] as const;

/** Every data row's cell in the column headed `header`, top to bottom. */
export function proofColumn(header: string): string[] {
  const c = PROOF_TABLE_ROWS[0]!.indexOf(header);
  if (c < 0) throw new Error(`the proof table has no "${header}" column`);
  return PROOF_TABLE_ROWS.slice(1).map((row) => row[c]!);
}

/**
 * The schema the proof requests: one LIST field per requested column. A table
 * holds a value per row, so a single-valued field over it has as many
 * candidates as rows. The engine's prompt asks for null only when a value is
 * not present, "never a guess" — so a model may answer null rather than pick
 * one (production's did, 2026-10-09) or may pick one; neither is a proof.
 * (Until 2026-10-09 this said the engine instructs null here. It does not.)
 */
export const PROOF_EXTRACTION_SCHEMA: readonly {
  readonly name: string;
  readonly type: "array";
  readonly description: string;
}[] = PROOF_EXTRACTION_COLUMNS.map((header) => ({
  name: header.toLowerCase(),
  type: "array",
  description: `Every value in the table's "${header}" column, one per row, top to bottom`,
}));

export interface ProofVerdict {
  ok: boolean;
  detail: string;
}

const NUMERIC = /^\d+$/;

/** Does `value`, as a model may write it, say `cell`? */
function sameCell(value: unknown, cell: string): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "object") return false;
  const written = String(value).trim();
  if (NUMERIC.test(cell)) {
    return Number(written.replace(/,/g, "")) === Number(cell);
  }
  return written.toLowerCase() === cell.toLowerCase();
}

/** Why `value` is not the column headed `header`, or null when it is. */
function columnMismatch(
  name: string,
  value: unknown,
  header: string,
): string | null {
  const cells = proofColumn(header);
  const whole =
    Array.isArray(value) &&
    value.length === cells.length &&
    cells.every((cell, i) => sameCell(value[i], cell));
  return whole
    ? null
    : `${name} is ${JSON.stringify(value)}, not the table's ${header} column top to bottom (${cells.join(", ")})`;
}

/** Read the package the way a user's tools would, and judge its values. */
export async function verifyExtractionProof(
  bytes: Uint8Array,
): Promise<ProofVerdict> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return { ok: false, detail: "the artifact is not a readable ZIP" };
  }
  const extractionFile = zip.file("extraction.json");
  if (!extractionFile) {
    return { ok: false, detail: "the package has no extraction.json" };
  }
  let extraction: unknown;
  try {
    extraction = JSON.parse(await extractionFile.async("string"));
  } catch {
    return { ok: false, detail: "extraction.json is not valid JSON" };
  }
  if (
    typeof extraction !== "object" ||
    extraction === null ||
    Array.isArray(extraction)
  ) {
    return { ok: false, detail: "extraction.json is not an object" };
  }
  const values = extraction as Record<string, unknown>;
  const names = PROOF_EXTRACTION_SCHEMA.map((field) => field.name);
  const absent = names.filter(
    (name) => !Object.prototype.hasOwnProperty.call(values, name),
  );
  if (absent.length > 0) {
    return {
      ok: false,
      detail: `extraction.json lacks requested key(s): ${absent.join(", ")}`,
    };
  }

  const missingKeys = await readMissingKeys(zip);
  const dropped = names.filter((name) => missingKeys.includes(name));
  if (dropped.length > 0) {
    return {
      ok: false,
      detail: `the model did not return: ${dropped.join(", ")} (manifest extraction.missingKeys)`,
    };
  }

  if (names.every((name) => values[name] === null)) {
    return { ok: false, detail: "every requested value is null" };
  }

  for (const [i, field] of PROOF_EXTRACTION_SCHEMA.entries()) {
    const mismatch = columnMismatch(
      field.name,
      values[field.name],
      PROOF_EXTRACTION_COLUMNS[i]!,
    );
    if (mismatch) return { ok: false, detail: mismatch };
  }
  return {
    ok: true,
    detail: PROOF_EXTRACTION_SCHEMA.map(
      (field, i) =>
        `${field.name}=${proofColumn(PROOF_EXTRACTION_COLUMNS[i]!).join(",")}`,
    ).join("; "),
  };
}

async function readMissingKeys(zip: JSZip): Promise<string[]> {
  const file = zip.file("manifest.json");
  if (!file) return [];
  try {
    const manifest = JSON.parse(await file.async("string")) as {
      extraction?: { missingKeys?: unknown };
    };
    const keys = manifest.extraction?.missingKeys;
    return Array.isArray(keys)
      ? keys.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}
