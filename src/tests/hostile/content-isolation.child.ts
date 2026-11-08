// Child for content-isolation.test.ts (hostile lane l06): run ONE engine on a
// 100,000-deep q/Q fixture and report where its drawing lands, measured by the
// independent interpreter in ./ctm-probe. A child, because pdf-lib works
// synchronously: if isolation (or the engine) ever loops on such a page, the
// parent's bound kills it instead of stalling vitest.
import { addPageNumbers } from "../../lib/pdf/page-numbers";
import { watermarkPdf } from "../../lib/pdf/watermark";
import { editPdf } from "../../lib/pdf/edit";
import { reportResult } from "./report";
import { ctmAtLastDraw } from "./ctm-probe";
import { STAMPING_INPUTS } from "./stamping.fixtures";

const [fixtureId, engine] = process.argv.slice(2);

async function main() {
  const input = STAMPING_INPUTS.find((f) => f.id === fixtureId);
  if (!input) throw new Error(`no fixture ${fixtureId}`);
  const bytes = await input.build();
  const t0 = Date.now();
  let out: Uint8Array;
  if (engine === "page-numbers") out = await addPageNumbers(bytes);
  else if (engine === "watermark")
    out = (await watermarkPdf(bytes, "DRAFT")).bytes;
  else if (engine === "edit")
    out = (
      await editPdf(bytes, [
        {
          type: "rect",
          page: 1,
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          color: "#ff0000",
        },
      ])
    ).bytes;
  else throw new Error(`no engine ${engine}`);
  const engineMs = Date.now() - t0;
  reportResult({ engineMs, at: await ctmAtLastDraw(out) });
}

void main();
