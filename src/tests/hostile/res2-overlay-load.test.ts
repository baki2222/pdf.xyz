import { describe, expect, test } from "vitest";
import { runBounded } from "./bounded";

// l03#49: overlay.ts's loadOverlay rethrew every load refusal except
// encryption as one sentence with no kind, so a page-tree refusal (kind
// "unreadable") reached telemetry as unprocessable_entity. The budget case is
// in decode-budget.test.ts (it needs the memory instrument).
const CHILD = "src/tests/hostile/res2-overlay-load.child.ts";

describe("l03#49: the overlay's load refusal keeps its cause", () => {
  test("l03#49: a page-tree cycle in the overlay is unreadable_input, said about the overlay", async () => {
    const r = await runBounded(CHILD, ["kids-cycle"], 30_000);
    expect(r.kind, JSON.stringify(r)).toBe("settled");
    expect((r as { value: unknown }).value).toEqual({
      error: "PdfEngineError",
      message:
        "The overlay file couldn't be read as a PDF — it may be corrupted or not a PDF.",
      kind: "unreadable",
      code: "unreadable_input",
    });
  }, 40_000);

  test("l03#49: a damaged page in the overlay names the overlay's page", async () => {
    const r = await runBounded(CHILD, ["missing-page"], 30_000);
    expect(r.kind, JSON.stringify(r)).toBe("settled");
    expect((r as { value: unknown }).value).toEqual({
      error: "PdfEngineError",
      message:
        "Page 2 of the overlay PDF is damaged and couldn't be read, so this file can't be processed without losing that page.",
      kind: "unreadable",
      code: "unreadable_input",
    });
  }, 40_000);
});
