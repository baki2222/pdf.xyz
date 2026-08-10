// @vitest-environment node
/**
 * A failed pdf-lib import must be forgotten, not memoized.
 *
 * The loader memoizes the import promise. Before the fix it memoized
 * REJECTIONS too: the warm path (file pick) reset on failure, but the direct
 * path — the one the typed-source tools (text-to-pdf, markdown-to-pdf) hit
 * with no file pick — kept the rejected promise forever, so one offline blip
 * bricked the tool until a full page reload even after connectivity returned.
 *
 * The sequence pinned here: import fails once (offline), the next call must
 * ATTEMPT AGAIN and succeed once the module is reachable.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

describe("loadPdfLib after a rejected import", () => {
  afterEach(() => {
    vi.doUnmock("pdf-lib");
    vi.resetModules();
  });

  it("retries instead of serving the memoized rejection", async () => {
    vi.resetModules();
    // First resolution of "pdf-lib" fails, as an offline fetch would.
    vi.doMock("pdf-lib", () => {
      throw new Error("simulated offline import failure");
    });
    const { loadPdfLib } = await import("./pdf-lib");
    // (vitest wraps the factory throw in its own message; the invariant is
    // that the call REJECTS, not the wrapper's wording.)
    await expect(loadPdfLib()).rejects.toThrow();

    // Connectivity returns: the module resolves normally again.
    vi.doUnmock("pdf-lib");
    vi.doMock("pdf-lib", () => ({ __recovered: true }));
    await expect(
      loadPdfLib(),
      "a second call after a rejection must retry the import, not replay the cached rejection",
    ).resolves.toMatchObject({ __recovered: true });
  });
});
