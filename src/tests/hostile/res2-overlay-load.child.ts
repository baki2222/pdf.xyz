// res2 child (l03#49): the overlay file's load refusals, said about the
// overlay. In a child because a page-tree cycle is refused only by the walk's
// visited set (`page-tree.ts`); without it the walk never ends.
//
// argv: <case>   case: kids-cycle, missing-page
// Reports { ok } or { error, message, kind, code }.
import { failureCode } from "../../components/tools/runner/runner-kit";
import { overlayPdf } from "../../lib/pdf/overlay";
import { rawPdf } from "./page-structure.raw";
import { reportResult } from "./report";
import { partnerPdf } from "./stamping.fixtures";

const CASES: Record<string, () => Uint8Array> = {
  // Two Pages nodes that are each other's kid (PS-03's shape).
  "kids-cycle": () =>
    rawPdf({
      objects: [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Pages /Parent 2 0 R /Kids [2 0 R] /Count 1 >>",
      ],
    }),
  // A two-page tree whose second kid is an object the file does not have.
  "missing-page": () =>
    rawPdf({
      objects: [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R 9 0 R] /Count 2 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
      ],
    }),
};

async function main() {
  const [name] = process.argv.slice(2);
  const build = CASES[name ?? ""];
  if (!build) throw new Error(`unknown case ${name}`);
  try {
    const r = await overlayPdf(partnerPdf(), build());
    reportResult({ ok: r.bytes.length });
  } catch (err) {
    const e = err as { name?: string; message?: string; kind?: string };
    reportResult({
      error: e?.name ?? null,
      message: e?.message ?? String(err),
      kind: e?.kind ?? null,
      code: failureCode(err) ?? null,
    });
  }
}
void main();
