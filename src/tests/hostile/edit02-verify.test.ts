/**
 * EDIT-02 adversarial verification: an AcroForm field cycle (/Kids contains
 * the field itself, or /Parent is the field itself) reaching every form entry
 * point. Records what each entry point does — resolves, typed refusal, or a
 * raw RangeError — under a hard per-call time bound.
 */
import { describe, expect, it } from "vitest";
import { editingFixtures } from "./editing.fixtures";
import { inspectFormFields, applyFormValues } from "@/lib/pdf/forms";
import { readFormContext, createFormFields } from "@/lib/pdf/create-forms";
import { inspectForm, flattenPdf } from "@/lib/pdf/flatten";
import { PdfEngineError } from "@/lib/pdf/engine-errors";
import { errorMessage } from "@/components/tools/runner/runner-kit";

type Outcome = { kind: "ok" | "typed" | "raw" | "timeout"; detail: string };

async function bounded(
  run: () => Promise<unknown>,
  ms = 10_000,
): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Outcome>((resolve) => {
    timer = setTimeout(
      () => resolve({ kind: "timeout", detail: `>${ms}ms` }),
      ms,
    );
  });
  const work = run().then(
    (): Outcome => ({ kind: "ok", detail: "resolved" }),
    (err: unknown): Outcome => ({
      kind: err instanceof PdfEngineError ? "typed" : "raw",
      detail: `${(err as Error)?.constructor?.name}: ${(err as Error)?.message} | user sees: ${errorMessage(err)}`,
    }),
  );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const ENTRY_POINTS: Record<string, (b: Uint8Array) => Promise<unknown>> = {
  inspectFormFields: (b) => inspectFormFields(b),
  applyFormValues: (b) => applyFormValues(b, { loop: "x", self: "x" }),
  applyFormValuesFlatten: (b) =>
    applyFormValues(b, { loop: "x", self: "x" }, { flatten: true }),
  readFormContext: (b) => readFormContext(b),
  createFormFields: (b) =>
    createFormFields(b, [
      {
        type: "text",
        name: "added",
        page: 0,
        x: 10,
        y: 10,
        width: 100,
        height: 20,
      } as never,
    ]),
  inspectForm: (b) => inspectForm(b),
  flattenPdf: (b) => flattenPdf(b),
};

describe("EDIT-02 verify: AcroForm field cycle", () => {
  it(
    "records every form entry point on both cycle fixtures",
    { timeout: 120_000 },
    async () => {
      const all = await editingFixtures();
      const fixtures = all.filter(
        (f) =>
          f.id === "H07-form-kids-cycle" || f.id === "H07-form-parent-self",
      );
      // health check: the corpus is not empty
      expect(fixtures.map((f) => f.id).sort()).toEqual([
        "H07-form-kids-cycle",
        "H07-form-parent-self",
      ]);

      const rows: string[] = [];
      for (const f of fixtures) {
        for (const [name, run] of Object.entries(ENTRY_POINTS)) {
          const o = await bounded(() => run(f.bytes));
          rows.push(`${f.id} | ${name} | ${o.kind} | ${o.detail}`);
        }
      }
      console.log("\n" + rows.join("\n"));
    },
  );

  it("positive control: a valid form PDF inspects cleanly", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    doc
      .getForm()
      .createTextField("ok")
      .addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
    const o = await bounded(async () => inspectFormFields(await doc.save()));
    expect(o.kind).toBe("ok");
  });
});
