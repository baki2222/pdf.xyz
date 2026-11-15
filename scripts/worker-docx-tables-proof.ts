/**
 * `pnpm worker:docx-tables-proof` — PDF to Word's tables (#28 slice 2) and,
 * since 2026-11-15, its typefaces (#28 slice 4), inside the built worker
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
 *     {@link EXPECTED.wrapped} Word tables. First pinned at 2 each from the
 *     stand-in extractor; the image's own poppler (CI run 43672470541,
 *     2026-11-15, PR #321) printed long 0 and short 1. The page's sentence
 *     was re-read against that before the numbers changed: "the rows around
 *     a wrapped cell MAY come through as a smaller table, and the rest as
 *     lines of text" holds of 0 and of 1, and every job conserved its text
 *     (runPdfOfficeExport refuses otherwise). If the image changes again,
 *     this goes red: re-read that sentence against what it printed before
 *     changing a number;
 *  4. `provesDocxTypefaces` on the same deps — the heartbeat's
 *     `docxTypefaces` — must be true;
 *  5. the inline-code line ("Call printf now": `printf` in Courier, the rest
 *     in Times-Roman, one style) through the real engine: each word's
 *     `w:rFonts` is printed, and `printf` must read Courier New, `Call` and
 *     `now` Times New Roman, in ascii, hAnsi and cs, with no `w:eastAsia`
 *     anywhere. No Bengali line here: drawing one needs the shipped
 *     Bengali face, which the image does not carry offline.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine is not
 * available in this image. Run by `.github/workflows/container.yml`; no
 * secret, queue, store or user document is touched, and everything it
 * prints is the generated fixtures' own text.
 */
import {
  docxTablesProbePdf,
  provesDocxTables,
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
  wrappedCellTablePdf,
} from "@/tests/pdf-office-fixtures";

/** Word tables each fixture must come out as (see the docblock, item 3). */
const EXPECTED = { gapped: 1, wrapped: { long: 0, short: 1 } } as const;

async function tables(deps: PdfOfficeExportDeps, pdf: Uint8Array) {
  const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, deps);
  if (!run.ok) throw new Error(`the job failed: ${run.kind}`);
  const body = await readDocxStructure(run.output);
  return {
    count: body.blocks.filter((b) => b.kind === "tbl").length,
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
    console.log(
      `wrapped (${kind}): ${wrapped.count} Word table(s), expected ${EXPECTED.wrapped[kind]}`,
    );
    ok &&= wrapped.count === EXPECTED.wrapped[kind];
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
