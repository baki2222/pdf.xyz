// @vitest-environment jsdom
/**
 * The consent banner's honesty properties:
 *
 *  1. It is ABSENT from served HTML — the server cannot know the decision, and
 *     a banner in the static markup would flash at every visitor who already
 *     declined (the #50 shape: printing an unverified claim during hydration).
 *  2. After mount it shows only to the undecided, asks once, and either button
 *     stores a real decision.
 *  3. Decline is a first-class button, not a link or an ✕ — consent that is
 *     harder to refuse than to give is not consent.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsentBanner } from "./consent-banner";
import { readStoredConsent, storeConsent } from "@/lib/analytics/consent";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ConsentBanner", () => {
  it("renders nothing in server HTML", () => {
    expect(renderToStaticMarkup(<ConsentBanner />)).toBe("");
  });

  it("asks the undecided, with decline as prominent as accept", () => {
    render(<ConsentBanner />);
    expect(
      screen.getByRole("region", { name: /analytics consent/i }),
    ).toBeInTheDocument();
    const allow = screen.getByRole("button", { name: /allow analytics/i });
    const decline = screen.getByRole("button", { name: /no thanks/i });
    expect(allow.tagName).toBe(decline.tagName);
  });

  it("stays hidden for a visitor who already decided", () => {
    storeConsent("denied");
    render(<ConsentBanner />);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("stores the decision and disappears — accept", () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: /allow analytics/i }));
    expect(readStoredConsent()).toBe("granted");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("stores the decision and disappears — decline", () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: /no thanks/i }));
    expect(readStoredConsent()).toBe("denied");
    expect(screen.queryByRole("region")).toBeNull();
  });
});
