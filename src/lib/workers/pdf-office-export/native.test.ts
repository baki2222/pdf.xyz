// @vitest-environment node
/**
 * PDF to PowerPoint rebuilds a PDF its page reader cannot read with the
 * worker's own Repair PDF engine — `runRepair` over the native qpdf runner
 * (`../pdf-structure`), not a second implementation — and only where qpdf is
 * present. qpdf is not installed on every machine that runs this suite, so
 * the process is a stand-in here, behind the runner's own `exec` seam: what
 * is under test is the wiring, the argv and the reading back of qpdf's
 * output. The real qpdf is exercised inside the worker image by
 * `pnpm worker:pptx-fidelity-proof`.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  imageCaptionPdf,
  junkAfterEofPdf,
} from "@/tests/pptx-fidelity-fixtures";
import { pdfOfficeExportDeps } from "./native";

type Exec = (
  command: string,
  args: readonly string[],
) => Promise<{ code: number; timedOut: boolean; stderr?: string }>;

const env = { PDFXYZ_PDFTOTEXT: "pdftotext" };

describe("the export rebuilds with the worker's Repair PDF engine", () => {
  it("has no repairPdf where qpdf is not on the PATH", () => {
    const seams = { structure: { resolveOnPath: () => false } };
    expect(pdfOfficeExportDeps(env, seams).repairPdf).toBeUndefined();
  });

  it("runs qpdf's rewrite on the file and hands back what qpdf wrote", async () => {
    const intact = (await imageCaptionPdf()).pdf;
    const calls: { command: string; args: readonly string[] }[] = [];
    const exec: Exec = async (command, args) => {
      calls.push({ command, args });
      // qpdf's rewrite: input path, output path (`repairArgs`).
      writeFileSync(args[1]!, intact);
      return { code: 0, timedOut: false, stderr: "" };
    };
    const seams = { structure: { resolveOnPath: () => true, exec } };
    const repairPdf = pdfOfficeExportDeps(env, seams).repairPdf;
    expect(repairPdf).toBeTypeOf("function");
    const rebuilt = await repairPdf!(junkAfterEofPdf(intact));
    expect(rebuilt && Buffer.from(rebuilt).equals(Buffer.from(intact))).toBe(
      true,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("qpdf");
    expect(calls[0]!.args).toHaveLength(2);
    expect(calls[0]!.args[0]).toMatch(/input\.pdf$/);
    expect(calls[0]!.args[1]).toMatch(/output\.pdf$/);
  });

  it("returns null when qpdf refuses the file, rather than a rebuilt copy that is not one", async () => {
    const exec: Exec = async () => ({ code: 2, timedOut: false, stderr: "" });
    const seams = { structure: { resolveOnPath: () => true, exec } };
    const repairPdf = pdfOfficeExportDeps(env, seams).repairPdf!;
    const intact = (await imageCaptionPdf()).pdf;
    expect(await repairPdf(junkAfterEofPdf(intact))).toBeNull();
  });
});
