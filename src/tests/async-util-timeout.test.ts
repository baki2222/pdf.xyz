// @vitest-environment jsdom
/**
 * The global testing-library wait (`./async-util-timeout.ts`) checked at
 * the point of consumption: a real `findBy*` that is set up to fail. A read
 * of `getConfig()` alone would pass while a later `configure` call, or a
 * second copy of @testing-library/dom, left the waits on the old value.
 */
import { getConfig, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ASYNC_UTIL_TIMEOUT_MS,
  ASYNC_UTIL_TIMEOUT_RANGE,
  LIBRARY_DEFAULT_ASYNC_UTIL_TIMEOUT_MS,
} from "./async-util-timeout";
import { expectAtLeast } from "./time-bound";

describe("testing-library's default wait", () => {
  it("health: the configured value differs from the library default, so the checks below can see a missing configure call", () => {
    expect(ASYNC_UTIL_TIMEOUT_MS).not.toBe(
      LIBRARY_DEFAULT_ASYNC_UTIL_TIMEOUT_MS,
    );
  });

  it("lies inside its range: at least twice the library default, and 1 s under vitest's 5 s test timeout", () => {
    const [floor, ceiling] = ASYNC_UTIL_TIMEOUT_RANGE;
    expect(ASYNC_UTIL_TIMEOUT_MS).toBeGreaterThanOrEqual(floor);
    expect(ASYNC_UTIL_TIMEOUT_MS).toBeLessThanOrEqual(ceiling);
  });

  it("setup applied it", () => {
    expect(getConfig().asyncUtilTimeout).toBe(ASYNC_UTIL_TIMEOUT_MS);
  });

  it("a findBy that never matches waits the configured time, then fails with its own message and the DOM", async () => {
    document.body.innerHTML = "<p>only this paragraph is here</p>";
    const t0 = performance.now();
    const error = await screen.findByText("a paragraph that is not here").then(
      () => null,
      (e: unknown) => e,
    );
    const waited = performance.now() - t0;
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(
      /Unable to find an element with the text: a paragraph that is not here/,
    );
    expect(message).toContain("only this paragraph is here");
    // Halfway between the library default and ours: a wait on the old
    // 1000 ms default cannot reach it, and a timer never fires early by
    // 500 ms.
    expectAtLeast(
      "async-util-timeout-waited",
      waited,
      (LIBRARY_DEFAULT_ASYNC_UTIL_TIMEOUT_MS + ASYNC_UTIL_TIMEOUT_MS) / 2,
    );
  });
});
