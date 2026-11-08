// @native-canvas
// EDIT-04 adversarial verification: catalog /Pages -> object whose value is a
// ref to itself. Each call is raced against a timeout so a hang is a finding.
import { describe, expect, it } from "vitest";
import { getEditPageSizes } from "@/lib/pdf/edit";
import { getPageRotations } from "@/lib/pdf/engine";
import { readPdfMetadata, writePdfMetadata } from "@/lib/pdf/metadata";
import { errorMessage } from "@/components/tools/runner/runner-kit";
import { loadPdfjs } from "@/lib/pdf/pdfjs";

function build(objs: { num: number; body: string }[]): Uint8Array {
  let out = "%PDF-1.7\n";
  const offs: number[] = [];
  for (const o of objs) {
    offs[o.num] = out.length;
    out += `${o.num} 0 obj\n${o.body}\nendobj\n`;
  }
  const xref = out.length;
  const size = objs.length + 1;
  out += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++)
    out += `${String(offs[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const bytes = build([
  { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
  { num: 2, body: "2 0 R" },
]);

async function outcome(fn: () => Promise<unknown>): Promise<string> {
  const timer = new Promise<string>((r) =>
    setTimeout(() => r("TIMEOUT"), 5000),
  );
  const run = fn().then(
    () => "RESOLVED",
    (e: unknown) =>
      `THROW ${(e as Error)?.constructor?.name}: ${errorMessage(e)}`,
  );
  return Promise.race([run, timer]);
}

describe("EDIT-04", () => {
  it("records what each entry point says", async () => {
    const results: Record<string, string> = {
      getPageRotations: await outcome(() => getPageRotations(bytes)),
      getEditPageSizes: await outcome(() => getEditPageSizes(bytes)),
      readPdfMetadata: await outcome(() => readPdfMetadata(bytes)),
      writeRemoveAll: await outcome(() =>
        writePdfMetadata(bytes, { kind: "remove-all" } as never),
      ),
      pdfjs: await outcome(async () => {
        const pdfjs = await loadPdfjs();
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        return doc.numPages;
      }),
    };
    (await import("node:fs")).writeFileSync("C:/Users/9000X4~1/AppData/Local/Temp/claude/5f73fc8ddb008462/a11f8c3b-021e-438d-9bb9-14a5844682c6/scratchpad/edit04.json", JSON.stringify(results, null, 2));
    expect(results.getPageRotations).not.toBe("TIMEOUT");
  }, 30000);
});
