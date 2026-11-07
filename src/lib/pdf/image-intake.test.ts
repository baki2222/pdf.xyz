import { describe, expect, it } from "vitest";
import { JPEG_30X20 } from "@/tests/jpeg-fixtures";
import { animatedPng, greyPng } from "@/tests/density-fixtures";
import { imagesToPdf } from "./image-to-pdf";
import { imageDecodes, undecodableImageMessage } from "./image-intake";

/*
 * Audit png-to-pdf#8 (2026-11-08): the check run when an image is ADDED is
 * the embed Create PDF runs, so a file that would stop the run is refused
 * with the other rejections instead. Positive and negative controls both.
 */

const good = greyPng(8, 8);
const cut = good.subarray(0, Math.floor(good.length * 0.6));
const animated = animatedPng(good);

describe("add-time decode check (audit png-to-pdf#8)", () => {
  it("positive control: a whole PNG and a whole JPEG pass", async () => {
    expect(await imageDecodes(good, "png")).toBe(true);
    expect(await imageDecodes(JPEG_30X20, "jpg")).toBe(true);
  });

  it.each([
    ["a PNG cut off in its image data", cut],
    ["a two-frame animated PNG", animated],
  ])(
    "refuses %s, exactly the file Create PDF would stop on",
    async (_what, bytes) => {
      expect(await imageDecodes(bytes, "png")).toBe(false);
      // The composed chain: the engine refuses the same bytes, in the same
      // words the runner shows at add time.
      await expect(
        imagesToPdf("png", [{ name: "x.png", type: "image/png", bytes }]),
      ).rejects.toThrow(undecodableImageMessage("x.png", "png"));
    },
  );

  it("refuses a JPEG whose header is damaged", async () => {
    const broken = JPEG_30X20.slice(0, 40);
    expect(await imageDecodes(broken, "jpg")).toBe(false);
  });
});
