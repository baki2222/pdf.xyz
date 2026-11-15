/**
 * `pnpm worker:docx-tables-proof` — PDF to Word's tables (#28 slice 2),
 * since 2026-11-15 its typefaces (#28 slice 4) and since 2026-11-16 its
 * wrapped cells (#28 slice 3), inside the built worker
 * image, on the image's OWN poppler: the only place poppler's grouping of a
 * page's words meets the Word table writer, and poppler's word boxes meet
 * the typeface matcher's member parts, before production (CI's unit job has
 * no poppler; its tests stand it in).
 *
 *  1. `provesDocxTables` on `pdfOfficeExportDeps(env)` — the heartbeat's
 *     `docxTables` — must be true;
 *  2. the gapped table (the probe's page) through the real engine must come
 *     out as exactly {@link EXPECTED.gapped} Word table(s), and how poppler
 *     grouped the wide-gapped line above it (one tabbed paragraph or two
 *     one-cell paragraphs) is printed: it decides whether flow.ts's lone-line
 *     branch is reachable from real poppler for that geometry;
 *  3. each wrapped-cell table through the real engine must come out as
 *     {@link EXPECTED.wrapped}: the number of Word tables AND each one's
 *     row count. First pinned at 2 tables each from the stand-in extractor;
 *     the image's own poppler (CI run 43672470541, 2026-11-15, PR #321)
 *     printed long 0 and short 1. The page's sentence was re-read against
 *     that before the numbers changed: "the rows around a wrapped cell MAY
 *     come through as a smaller table, and the rest as lines of text" holds
 *     of 1 (the audit of 2026-11-16 found it does NOT hold of long's 0: with
 *     no table there is no "smaller table"), and every job conserved its
 *     text (runPdfOfficeExport refuses otherwise).
 *     2026-11-16, #28 slice 3 (wraps): from long 0 / short 1 TABLES to one
 *     table of 5 rows each, the value measured on the image's captures of
 *     these two pages (`IMAGE_WRAPPED_LONG_BBOX`, `IMAGE_WRAPPED_SHORT_BBOX`,
 *     poppler 22.12.0). The check became {tables, rows}: short was already
 *     1 table, so a count alone could not tell whether slice 3 happened (the
 *     adjacent measurement). The page's sentence is to be re-read against
 *     the new value: PR-1's interim sentence must hold of a 5-row table AND
 *     of 0 and 1 on an image built before slice 3. If the image changes
 *     again, this goes red: re-read that sentence against what it printed
 *     before changing a number;
 *  4. `provesDocxTypefaces` on the same deps — the heartbeat's
 *     `docxTypefaces` — must be true;
 *  5. the inline-code line ("Call printf now": `printf` in Courier, the rest
 *     in Times-Roman, one style) through the real engine: each word's
 *     `w:rFonts` is printed, and `printf` must read Courier New, `Call` and
 *     `now` Times New Roman, in ascii, hAnsi and cs, with no `w:eastAsia`
 *     anywhere. No Bengali line here: drawing one needs the shipped
 *     Bengali face, which the image does not carry offline;
 *  6. the straddle line ("Hello Hel" in Times-Roman, "lo" in Courier, one
 *     style; review round 2): the second "Hello" is drawn in two faces, so
 *     whether poppler keeps it whole or splits it at the font change, no
 *     word spanning both may name a typeface (`straddleProblem`). The words
 *     and their faces are printed either way;
 *  7. `provesDocxTableWraps` on the same deps — the heartbeat's
 *     `docxTableWraps` (#28 slice 3) — must be true;
 *  8. the probe's page (S1), the wrapped invoice (S3) and the bank statement
 *     (S5) through the real engine must each match {@link EXPECTED.wraps}:
 *     the Word tables, each one's rows, and the continuation lines the
 *     image's poppler flow absorbed (`wrapLines`). Each absorbed cell (a
 *     flow table cell whose words sit on two or more lines) must be a .docx
 *     cell of that text holding exactly ONE paragraph, and its text is
 *     printed.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine is not
 * available in this image. Run by `.github/workflows/container.yml`; no
 * secret, queue, store or user document is touched, and everything it
 * prints is the generated fixtures' own text.
 */
import {
  docxTableWrapsProbePdf,
  docxTablesProbePdf,
  provesDocxTables,
  provesDocxTableWraps,
  provesDocxTypefaces,
} from "@/lib/workers/pdf-office-export/capability";
import { readDocxStructure } from "@/lib/workers/pdf-office-export/docx-structure";
import {
  PDF_TO_WORD_TOOL,
  runPdfOfficeExport,
  type PdfOfficeExportDeps,
} from "@/lib/workers/pdf-office-export/engine";
import { pdfOfficeExportDeps } from "@/lib/workers/pdf-office-export/native";
import {
  INLINE_CODE,
  inlineCodePdf,
  straddlePdf,
  straddleProblem,
  wrappedCellTablePdf,
} from "@/tests/pdf-office-fixtures";
import {
  bankStatementPdf,
  wrappedInvoicePdf,
} from "@/tests/word-wrap-fixtures";

/**
 * What each fixture must come out as (see the docblock, items 2, 3 and 8),
 * measured on the image's captures (`src/tests/poppler-samples-image.ts`,
 * poppler 22.12.0, captured 2026-11-15). HISTORY: `wrapped` was
 * `{ long: 0, short: 1 }` (Word table COUNTS only) until 2026-11-16.
 */
const EXPECTED = {
  gapped: 1,
  wrapped: {
    long: { tables: 1, rows: [5] },
    short: { tables: 1, rows: [5] },
  },
  wraps: {
    probe: { tables: 1, rows: [5], absorbed: 3 },
    invoice: { tables: 2, rows: [6, 3], absorbed: 5 },
    statement: { tables: 1, rows: [6], absorbed: 4 },
  },
} as const;

type Tbl = Extract<
  Awaited<ReturnType<typeof readDocxStructure>>["blocks"][number],
  { kind: "tbl" }
>;
type CellBlocks = Tbl["rows"][number]["cells"][number]["blocks"];

const cellParagraphs = (blocks: CellBlocks) =>
  blocks.flatMap((b) =>
    b.kind === "p" ? [b.runs.map((r) => r.text).join("")] : [],
  );

const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((x, k) => x === b[k]);

/**
 * The image's poppler flow of `pdf`: the lines it absorbed (`wrapLines`)
 * and the text of each table cell whose words sit on two or more lines.
 */
async function absorbedOf(deps: PdfOfficeExportDeps, pdf: Uint8Array) {
  const flow = await deps.extractFlow!(pdf);
  const cells: string[] = [];
  for (const page of flow.pages)
    page.paragraphs.forEach((paragraph, i) => {
      if (!page.tables?.[i]) return;
      paragraph.forEach((text, c) => {
        const lines = new Set(
          (page.pieces?.[i]?.[c] ?? []).map((p) =>
            Math.round((p.box[1] + p.box[3]) / 2),
          ),
        );
        if (lines.size > 1) cells.push(text);
      });
    });
  return {
    wrapLines: flow.pages.reduce((n, p) => n + (p.wrapLines ?? 0), 0),
    cells,
  };
}

async function tables(deps: PdfOfficeExportDeps, pdf: Uint8Array) {
  const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, deps);
  if (!run.ok) throw new Error(`the job failed: ${run.kind}`);
  const body = await readDocxStructure(run.output);
  const tbls = body.blocks.filter((b): b is Tbl => b.kind === "tbl");
  return {
    count: tbls.length,
    rows: tbls.map((t) => t.rows.length),
    cells: tbls.flatMap((t) =>
      t.rows.flatMap((r) => r.cells.map((c) => cellParagraphs(c.blocks))),
    ),
    paragraphs: body.blocks.flatMap((b) =>
      b.kind === "p" && b.runs.length > 0
        ? [b.runs.map((r) => r.text).join("")]
        : [],
    ),
  };
}

async function main(): Promise<number> {
  const deps = pdfOfficeExportDeps(process.env);
  if (!deps.extractFlow || !deps.scanPages) {
    console.log(
      `CANNOT CONCLUDE — ${!deps.extractFlow ? "pdftotext" : "the page reader (pdf.js and its canvas)"} is not available in this image.`,
    );
    return 2;
  }
  let ok = true;
  const proven = await provesDocxTables(deps);
  console.log(`provesDocxTables: ${proven}`);
  ok &&= proven;

  const gapped = await tables(deps, await docxTablesProbePdf());
  console.log(
    `gapped table: ${gapped.count} Word table(s), expected ${EXPECTED.gapped}`,
  );
  console.log(
    `  paragraphs outside the table: ${JSON.stringify(gapped.paragraphs)}`,
  );
  const lone = gapped.paragraphs.some((p) =>
    /^Invoice 1042\tDue in 30 days$/.test(p),
  );
  console.log(
    `  the wide-gapped line is ${lone ? "ONE tabbed paragraph (the lone-line branch is reachable)" : "not one tabbed paragraph (poppler split it)"}`,
  );
  ok &&= gapped.count === EXPECTED.gapped;

  for (const kind of ["long", "short"] as const) {
    const wrapped = await tables(deps, await wrappedCellTablePdf(kind));
    const want = EXPECTED.wrapped[kind];
    console.log(
      `wrapped (${kind}): ${wrapped.count} Word table(s) of rows ${JSON.stringify(wrapped.rows)}, expected ${want.tables} of ${JSON.stringify(want.rows)}`,
    );
    ok &&= wrapped.count === want.tables && same(wrapped.rows, want.rows);
  }

  // 4. The heartbeat's docxTypefaces, on the image's own deps.
  const faces = await provesDocxTypefaces(deps);
  console.log(`provesDocxTypefaces: ${faces}`);
  ok &&= faces;

  // 5. The inline-code line: real poppler's word boxes against the parts.
  const inline = await runPdfOfficeExport(
    PDF_TO_WORD_TOOL,
    await inlineCodePdf(),
    deps,
  );
  if (!inline.ok) throw new Error(`the inline-code job failed: ${inline.kind}`);
  const runs = (await readDocxStructure(inline.output)).blocks.flatMap((b) =>
    b.kind === "p" ? b.runs : [],
  );
  const faceOf = new Map<string, string[]>();
  for (const r of runs)
    for (const w of r.text.split(/\s+/).filter(Boolean)) {
      const read = `${r.fonts ?? "-"}/${r.fontsHAnsi ?? "-"}/${r.fontsCs ?? "-"}`;
      faceOf.set(w, [...(faceOf.get(w) ?? []), read]);
      console.log(`  ${JSON.stringify(w)}: ${read}`);
    }
  const all = (family: string) => `${family}/${family}/${family}`;
  const isOnly = (word: string, family: string) => {
    const got = faceOf.get(word) ?? [];
    return got.length > 0 && got.every((f) => f === all(family));
  };
  const code = isOnly(INLINE_CODE.code, "Courier New");
  const text = ["Call", "now"].every((w) => isOnly(w, "Times New Roman"));
  const east = runs.filter((r) => r.fontsEastAsia !== undefined).length;
  console.log(
    `inline code: printf ${code ? "Courier New" : "NOT Courier New"}; Call/now ${text ? "Times New Roman" : "NOT Times New Roman"}; eastAsia on ${east} run(s)`,
  );
  ok &&= code && text && east === 0;

  // 6. The straddle line (review round 2): a word drawn half in Times and
  //    half in Courier, the same word earlier in Times. Whether real
  //    poppler keeps it as one word was never run before this step.
  const straddle = await runPdfOfficeExport(
    PDF_TO_WORD_TOOL,
    await straddlePdf(),
    deps,
  );
  if (!straddle.ok)
    throw new Error(`the straddle job failed: ${straddle.kind}`);
  const straddleWords = (await readDocxStructure(straddle.output)).blocks
    .flatMap((b) => (b.kind === "p" ? b.runs : []))
    .flatMap((r) =>
      r.text
        .split(/\s+/)
        .filter(Boolean)
        .map(
          (w) =>
            [
              w,
              `${r.fonts ?? "-"}/${r.fontsHAnsi ?? "-"}/${r.fontsCs ?? "-"}`,
            ] as const,
        ),
    );
  const straddleWrong = straddleProblem(straddleWords);
  console.log(
    `straddle: ${JSON.stringify(straddleWords)} ${straddleWrong ?? "holds"}`,
  );
  ok &&= straddleWrong === null;

  // 7. The heartbeat's docxTableWraps (#28 slice 3), on the image's own deps.
  const wraps = await provesDocxTableWraps(deps);
  console.log(`provesDocxTableWraps: ${wraps}`);
  ok &&= wraps;

  // 8. S1, S3 and S5 through the real engine on the image's poppler.
  const wrapFixtures = {
    probe: docxTableWrapsProbePdf,
    invoice: () => wrappedInvoicePdf(),
    statement: bankStatementPdf,
  } as const;
  for (const name of ["probe", "invoice", "statement"] as const) {
    const pdf = await wrapFixtures[name]();
    const got = await tables(deps, pdf);
    const flow = await absorbedOf(deps, pdf);
    const want = EXPECTED.wraps[name];
    console.log(
      `wraps (${name}): ${got.count} Word table(s) of rows ${JSON.stringify(got.rows)}, ${flow.wrapLines} line(s) absorbed; expected ${want.tables} of ${JSON.stringify(want.rows)}, ${want.absorbed} absorbed`,
    );
    const whole = flow.cells.map((text) => {
      const hit = got.cells.some(
        (paragraphs) => paragraphs.length === 1 && paragraphs[0] === text,
      );
      console.log(
        `  absorbed cell ${JSON.stringify(text)}: ${hit ? "one paragraph in the .docx" : "NOT a one-paragraph .docx cell"}`,
      );
      return hit;
    });
    ok &&=
      got.count === want.tables &&
      same(got.rows, want.rows) &&
      flow.wrapLines === want.absorbed &&
      flow.cells.length > 0 &&
      whole.every(Boolean);
  }
  console.log(ok ? "PROVEN" : "FAIL");
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`FAIL — ${(error as Error).message.split("\n")[0]}`);
    process.exit(1);
  },
);
