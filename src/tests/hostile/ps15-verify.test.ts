import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { organizePages, rotatePages, setPageRotations } from "@/lib/pdf/engine";
import { normalizeAngle } from "@/lib/pdf/rotation";
import type { Rotation } from "@/lib/pdf/types";

async function ctrl3(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([200, 300]);
  return doc.save();
}

async function outcome(run: () => Promise<Uint8Array>) {
  try {
    const out = await run();
    const doc = await PDFDocument.load(out);
    return { ok: doc.getPages().map((p) => p.getRotation().angle) };
  } catch (e) {
    const err = e as Error;
    return { name: err.name, ctor: err.constructor?.name, message: err.message };
  }
}

describe("PS-15 verify: NaN rotation", () => {
  it("normalizeAngle(NaN)", () => {
    console.log("NORMALIZE", normalizeAngle(NaN), normalizeAngle(Infinity), normalizeAngle(45), normalizeAngle(1e9));
    expect(true).toBe(true);
  });
  it("organizePages", { timeout: 20000 }, async () => {
    const b = await ctrl3();
    const r = await outcome(() =>
      organizePages(b, [
        { sourceIndex: 2, rotation: NaN as Rotation },
        { sourceIndex: 0, rotation: 45 as Rotation },
      ]),
    );
    console.log("ORGANIZE", JSON.stringify(r));
    // positive control: same plan with finite angles succeeds
    const c = await outcome(() =>
      organizePages(b, [
        { sourceIndex: 2, rotation: 0 },
        { sourceIndex: 0, rotation: 45 as Rotation },
      ]),
    );
    console.log("ORGANIZE_CONTROL", JSON.stringify(c));
    expect(c).toHaveProperty("ok");
  });
  it("setPageRotations", { timeout: 20000 }, async () => {
    const b = await ctrl3();
    const r = await outcome(() => setPageRotations(b, [NaN, 45, 1e9] as Rotation[]));
    console.log("SETROT", JSON.stringify(r));
    const c = await outcome(() => setPageRotations(b, [0, 45, 1e9] as Rotation[]));
    console.log("SETROT_CONTROL", JSON.stringify(c));
    expect(c).toHaveProperty("ok");
  });
  it("rotatePages", { timeout: 20000 }, async () => {
    const b = await ctrl3();
    const r = await outcome(() => rotatePages(b, [0], NaN));
    console.log("ROTATE", JSON.stringify(r));
    const c = await outcome(() => rotatePages(b, [0], 90));
    console.log("ROTATE_CONTROL", JSON.stringify(c));
    expect(c).toHaveProperty("ok");
  });
});
