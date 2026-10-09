// @vitest-environment jsdom
/**
 * /privacy §5 says what this site keeps in a visitor's browser — read from
 * the rendered page, against the registry the code is held to
 * (`browser-storage.test.ts` discovers every store both ways).
 *
 * Before 2026-10-09 §5 named the consent choice and, vaguely, "files you
 * added to the workspace"; it never mentioned sessionStorage, the hand-off
 * database, how long either lasts, or that a file passed to a tool waits in
 * the browser until that tool opens it.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BROWSER_STORAGE, HANDOFF_LIFETIME } from "@/lib/browser-storage";
import PrivacyPage from "./page";

afterEach(cleanup);

const section5 = () => {
  const { container } = render(<PrivacyPage />);
  const section = container.querySelector("#cookies");
  expect(section, "§5 (#cookies) is gone").not.toBeNull();
  return section!.textContent?.replace(/\s+/g, " ") ?? "";
};

describe("/privacy §5 renders the browser-storage registry", () => {
  it("names every store, where it lives, what it holds and how long", () => {
    const text = section5();
    expect(BROWSER_STORAGE.length).toBeGreaterThanOrEqual(4);
    for (const store of BROWSER_STORAGE) {
      expect(text).toContain(store.key);
      expect(text).toContain(store.area);
      expect(text).toContain(store.holds);
      expect(text).toContain(store.lasts);
    }
  });

  it("says how long a file passed to a tool can wait in the browser", () => {
    expect(section5()).toContain(HANDOFF_LIFETIME);
  });
});
