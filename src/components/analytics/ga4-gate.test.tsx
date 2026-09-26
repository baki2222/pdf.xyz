// @vitest-environment jsdom
/**
 * The composed chain: consent → the gate → the page views it sends, rendered
 * the way the root layout renders it. `usePathname()` reads Next's own
 * PathnameContext, so the test provides that context rather than mocking the
 * hook (a `vi.mock` would bind the gate to a stub in the shared module cache).
 */
import { act, render } from "@testing-library/react";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { CONSENT_STORAGE_KEY, storeConsent } from "@/lib/analytics/consent";
import { GTAG_SRC, resetGa4ForTests } from "@/lib/analytics/ga4";
import { resetTelemetry } from "@/lib/telemetry/track";
import { Ga4Gate } from "./ga4-gate";

type TestWindow = Window & { dataLayer?: unknown[]; gtag?: unknown };
const win = window as TestWindow;

afterEach(() => {
  resetGa4ForTests();
  resetTelemetry();
  delete win.dataLayer;
  delete win.gtag;
  localStorage.removeItem(CONSENT_STORAGE_KEY);
  document
    .querySelectorAll(`script[src="${GTAG_SRC}"]`)
    .forEach((node) => node.remove());
});

const pageViews = () =>
  (win.dataLayer ?? [])
    .map((entry) => Array.from(entry as unknown[]))
    .filter((call) => call[0] === "event" && call[1] === "page_view")
    .map((call) => (call[2] as { page_location: string }).page_location);

function Gate({ pathname }: { pathname: string }) {
  return (
    <PathnameContext.Provider value={pathname}>
      <Ga4Gate />
    </PathnameContext.Provider>
  );
}

describe("Ga4Gate page views", () => {
  it("sends one path-only page view per route, and none before consent", () => {
    // The address bar holds the token, as it does right after a workspace
    // launch; usePathname() does not.
    history.pushState({}, "", "/tools/merge-pdf?handoff=tok_SECRET123");
    const view = render(<Gate pathname="/tools/merge-pdf" />);
    expect(pageViews()).toEqual([]);

    act(() => storeConsent("granted"));
    expect(pageViews()).toEqual([`${location.origin}/tools/merge-pdf`]);

    view.rerender(<Gate pathname="/tools/split-pdf" />);
    expect(pageViews()).toEqual([
      `${location.origin}/tools/merge-pdf`,
      `${location.origin}/tools/split-pdf`,
    ]);
    expect(JSON.stringify(win.dataLayer)).not.toContain("tok_SECRET123");

    // Withdrawn: the next route sends nothing.
    act(() => storeConsent("denied"));
    view.rerender(<Gate pathname="/tools/compress-pdf" />);
    expect(pageViews()).toHaveLength(2);
    view.unmount();
    history.pushState({}, "", "/");
  });
});
