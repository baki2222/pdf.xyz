/**
 * EDIT-03 adversarial verification: a PDF with no reachable catalog loads in
 * pdf-lib and then throws a raw TypeError from each engine, instead of the
 * typed UNREADABLE_PDF_MESSAGE. Positive control: random bytes (H01-like)
 * DO produce the typed error, so the assertion can tell the two apart.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { editPdf } from "@/lib/pdf/edit";
import { cropPdf } from "@/lib/pdf/crop";
import { inspectFormFields } from "@/lib/pdf/forms";
import { readPdfMetadata } from "@/lib/pdf/metadata";
import { PdfEngineError, UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine-errors";
import { getPageRotations } from "@/lib/pdf/engine";
import { errorMessage } from "@/components/tools/runner/runner-kit";
import { editingFixtures } from "./editing.fixtures";

type Engine = (b: Uint8Array) => Promise<unknown>;
const engines: Record<string, Engine> = {
  editPdf: (b) =>
    editPdf(b, [
      {
        kind: "rect",
        pageIndex: 0,
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        color: "#000000",
      } as never,
    ]),
  cropPdf: (b) =>
    cropPdf(b, { margins: { top: 5, right: 5, bottom: 5, left: 5 } } as never),
  inspectFormFields: (b) => inspectFormFields(b),
  readPdfMetadata: (b) => readPdfMetadata(b),
  // The upload step every single-PDF runner takes first (use-single-pdf.ts
  // readPageBoard, reader "pdf-lib"), rendered through the UI's errorMessage.
  "upload:getPageRotations->errorMessage": async (b) => {
    try {
      await getPageRotations(b);
    } catch (e) {
      throw new Error(`UI shows ${JSON.stringify(errorMessage(e))}`);
    }
  },
};

async function outcome(fn: Engine, bytes: Uint8Array): Promise<string> {
  try {
    await fn(bytes);
    return "OK";
  } catch (e) {
    const typed = e instanceof PdfEngineError;
    const msg = e instanceof Error ? e.message : String(e);
    return `${typed ? "TYPED" : (e as Error)?.constructor?.name}: ${msg}`;
  }
}

describe("EDIT-03", () => {
  it("records each engine's outcome on catalog-less inputs", async () => {
    const all = await editingFixtures();
    const ids = [
      "H03-header-only",
      "H23-objstm-n-lies",
      "H23-objstm-first-past-end",
    ];
    const subjects = all.filter((f) => ids.includes(f.id));
    expect(subjects.map((f) => f.id).sort()).toEqual([...ids].sort());
    const control = new Uint8Array(512).map((_, i) => (i * 37) & 0xff);
    const rows: string[] = [];
    for (const [name, fn] of Object.entries(engines)) {
      const c = await outcome(fn, control);
      rows.push(`control ${name}: ${c}`);
      for (const f of subjects) {
        rows.push(`${f.id} ${name}: ${await outcome(fn, f.bytes)}`);
      }
    }
    writeFileSync(
      process.env.EDIT03_OUT ?? "edit03.out.txt",
      `${rows.join("\n")}\nUNREADABLE: ${UNREADABLE_PDF_MESSAGE}\n`,
    );
  }, 60_000);
});
