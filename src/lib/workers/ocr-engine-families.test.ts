// @vitest-environment node
/**
 * The OCR engines a worker can run and the engine families a client may be
 * told about are ONE list.
 *
 * THE DEFECT. `jobs/ocr.ts` said OCR_ENGINE_FAMILIES "mirrors the worker
 * layer's `OCR_ENGINES` ... extend both together", and the two were separate
 * literals that no test compared. Adding an engine on the worker side would
 * have reported it to every client as "unknown", with nothing failing.
 *
 * THE FIX makes the worker list the client list (`OCR_ENGINES =
 * OCR_ENGINE_FAMILIES`), so there is nothing to keep in step. This pins the
 * identity, and the relationship it exists for: every engine a worker can
 * select survives the client-facing normalizer as itself.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeOcrEngineFamily,
  OCR_ENGINE_FAMILIES,
  UNKNOWN_OCR_ENGINE,
} from "@/lib/jobs/ocr";
import { OCR_ENGINE_BINARIES, OCR_ENGINES } from "./ocr";

describe("OCR engines and client-facing families", () => {
  it("are the same list, not two copies of it", () => {
    expect(OCR_ENGINES).toBe(OCR_ENGINE_FAMILIES);
  });

  it("every engine a worker can select is reported to clients as itself", () => {
    expect(OCR_ENGINES.length).toBeGreaterThanOrEqual(2);
    for (const engine of OCR_ENGINES) {
      expect(normalizeOcrEngineFamily(engine)).toBe(engine);
      // ...and has a binary to probe, so it can actually be selected.
      expect(OCR_ENGINE_BINARIES[engine]).toBeTruthy();
    }
  });

  it("control: an engine outside the list is reported as unknown", () => {
    expect(normalizeOcrEngineFamily("easyocr")).toBe(UNKNOWN_OCR_ENGINE);
  });
});
