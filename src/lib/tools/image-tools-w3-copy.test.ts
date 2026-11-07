import { describe, expect, it } from "vitest";
import jpg from "./content/jpg-to-pdf";
import png from "./content/png-to-pdf";
import { IMAGE_ROTATION_LABELS } from "@/lib/pdf/image-rotation";

/*
 * The claims JPG / PNG to PDF's pages make about the wave-3 controls (audit
 * 2026-11-06, lane w3-l05), each pinned to the constant the runner draws.
 * The behaviour behind each is held by the runner test
 * (image-to-pdf-options.test.tsx) and the engine tests named per block.
 */

const text = (c: typeof jpg) =>
  [
    ...c.intro,
    ...c.useCases.map((u) => u.body),
    ...c.steps.map((s) => s.body),
    ...c.faqs.map((f) => f.a),
  ].join("\n");

describe.each([
  ["jpg-to-pdf", jpg],
  ["png-to-pdf", png],
] as const)("%s · wave-3 copy", (_slug, content) => {
  it("names the card's Rotate button by its label, in the order step", () => {
    const order = content.steps.find((s) => /Image order/.test(s.body));
    expect(order?.body).toContain(`(${IMAGE_ROTATION_LABELS.button})`);
    expect(order?.body).toMatch(/quarter turn clockwise/);
  });

  it("no longer sends a sideways image to Rotate PDF after the fact", () => {
    // INVERTED 2026-11-08: the JPG FAQ answered a sideways photo with "open
    // the PDF in Rotate PDF"; the card's own button does it now.
    expect(text(content)).not.toMatch(/open the PDF in Rotate PDF/);
  });
});
