// @vitest-environment jsdom
/**
 * Every product event names its page WITHOUT the query string.
 *
 * ── THE DEFECT, MEASURED AT THE WIRE (2026-10-10) ───────────────────────────
 *
 * /privacy §4 said analytics events "are stripped of filenames, links, and
 * query strings before they are sent". Page views were: `sendGa4PageView`
 * builds `page_location` from origin + pathname. Product events were not —
 * the sink forwarded `gtag("event", name, params)` with no `page_location`,
 * and gtag.js fills it from `location.href`.
 *
 * Captured in a real browser against a production build of b48e9c06
 * (`next start`, Allow analytics, a file staged in /workspace, "Open Sign PDF
 * with …"), the hits intercepted before they left the page:
 *
 *     en=tool_viewed&…&ep.toolSlug=sign-pdf&ep.capability=in-browser
 *       &dl=http%3A%2F%2Flocalhost%2Ftools%2Fsign-pdf%3Fhandoff%3Dh_794b80b9…
 *
 * The hand-off token — the key to a file waiting in that browser — went to
 * Google on the first event of every workspace hand-off, while the page that
 * sent it promised it would not. The source read clean, which is why the
 * sweep said "verify at the wire, not from source".
 *
 * ── WHAT IT PINS ────────────────────────────────────────────────────────────
 *
 * For every event the sink forwards, `page_location` is origin + pathname —
 * and no value in ANY command the module pushes carries the token.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { track, resetTelemetry } from "@/lib/telemetry/track";
import { enableGa4, resetGa4ForTests } from "./ga4";

type TestWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};
const win = window as TestWindow;

const TOKEN = "h_794b80b9d22146b0bcc6740115675667";
const LANDING = `/tools/sign-pdf?handoff=${TOKEN}#from-workspace`;

beforeEach(() => {
  window.history.replaceState({}, "", LANDING);
});

afterEach(() => {
  resetGa4ForTests();
  resetTelemetry();
  delete win.dataLayer;
  delete win.gtag;
  document
    .querySelectorAll("script[src^='https://www.googletagmanager.com']")
    .forEach((node) => node.remove());
  window.history.replaceState({}, "", "/");
});

const calls = () =>
  (win.dataLayer ?? []).map((entry) => Array.from(entry as unknown[]));

describe("product events name their page without the query", () => {
  it("health: the page under test really carries the token", () => {
    expect(window.location.search).toContain(TOKEN);
  });

  it("tool_viewed fired on a hand-off URL carries page_location = origin + path", () => {
    enableGa4();
    track({
      name: "tool_viewed",
      toolSlug: "sign-pdf",
      capability: "in-browser",
    });
    const viewed = calls().filter(
      (c) => c[0] === "event" && c[1] === "tool_viewed",
    );
    expect(viewed).toHaveLength(1);
    const params = viewed[0]![2] as Record<string, unknown>;
    expect(params.page_location).toBe(
      `${window.location.origin}/tools/sign-pdf`,
    );
  });

  it("no command the module pushes carries the hand-off token, anywhere", () => {
    enableGa4();
    track({
      name: "tool_viewed",
      toolSlug: "sign-pdf",
      capability: "in-browser",
    });
    track({
      name: "tool_completed",
      toolSlug: "sign-pdf",
      capability: "in-browser",
    });
    const leaked = calls().filter((c) => JSON.stringify(c).includes(TOKEN));
    expect(leaked).toEqual([]);
    // Positive control: the same scan sees the token when it is there.
    expect(JSON.stringify([window.location.href])).toContain(TOKEN);
  });
});
