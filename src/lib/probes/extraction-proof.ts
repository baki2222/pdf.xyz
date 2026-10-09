/**
 * What the production proof of AI Data Extraction accepts as PROOF — the
 * extraction a user downloads, not the container it arrives in.
 *
 * ── WHY (2026-09-28) ────────────────────────────────────────────────────────
 *
 * `scripts/worker-prove-tools.ts` checked the ai-extract artifact with
 * `isZipContainer` and nothing else. A package whose extraction.json was `{}`
 * — every requested field dropped — was a valid ZIP, so the harness would have
 * certified a blank extraction as a working tool. The container is the
 * author's artifact; the values inside it are what the reader receives.
 *
 * ── WHAT IS CHECKED ─────────────────────────────────────────────────────────
 *
 * Against the proof's own table ({@link PROOF_TABLE_ROWS}, which the harness
 * draws into the PDF, so the expected values are derived from the fixture
 * rather than typed beside it):
 *
 *  - extraction.json is an object carrying BOTH requested keys;
 *  - neither is listed in manifest.json's `extraction.missingKeys` — since the
 *    engine now fills a dropped field with null, "the key is present" alone
 *    would be satisfied by an extraction of nothing;
 *  - at least one value is non-null;
 *  - `q1` is one of the table's Q1 figures, tolerating how a model may write a
 *    number ("1,200", "1200", 1200) but not a figure the table does not hold.
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

/** The schema the proof requests. */
export const PROOF_EXTRACTION_SCHEMA = [
  { name: "region", type: "string", description: "The region name" },
  { name: "q1", type: "number", description: "The Q1 figure" },
] as const;

const Q1_COLUMN = PROOF_TABLE_ROWS[0]!.indexOf("Q1");
const Q1_FIGURES = new Set(
  PROOF_TABLE_ROWS.slice(1).map((row) => Number(row[Q1_COLUMN])),
);

export interface ProofVerdict {
  ok: boolean;
  detail: string;
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

  const q1 = values.q1;
  const figure = Number(String(q1).replace(/,/g, "").trim());
  if (q1 === null || !Q1_FIGURES.has(figure)) {
    return {
      ok: false,
      detail: `q1 is ${JSON.stringify(q1)}, which is not a Q1 figure in the proof table (${[...Q1_FIGURES].join(", ")})`,
    };
  }
  return {
    ok: true,
    detail: `region=${JSON.stringify(values.region)}, q1=${figure}`,
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
