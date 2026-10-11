// @vitest-environment jsdom
/**
 * The properties that make consent-gated GA4 honest, each pinned:
 *
 *  1. Enabling injects exactly one gtag script and declares the consent
 *     defaults BEFORE config — with every advertising signal denied.
 *  2. Enabling routes `track()` events to gtag, already-redacted.
 *  3. Disabling tells a loaded tag to stop persisting and detaches the sink,
 *     so a `track()` after withdrawal reaches Google exactly never.
 */
import { afterEach, describe, expect, it } from "vitest";
import { track, resetTelemetry } from "@/lib/telemetry/track";
import {
  GA4_MEASUREMENT_ID,
  GA_DISABLE_PROPERTY,
  GTAG_SRC,
  clearGaCookies,
  disableGa4,
  enableGa4,
  resetGa4ForTests,
  sendGa4PageView,
} from "./ga4";

type TestWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};
const win = window as TestWindow;

afterEach(() => {
  resetGa4ForTests();
  resetTelemetry();
  delete win.dataLayer;
  delete win.gtag;
  document
    .querySelectorAll("script[src^='https://www.googletagmanager.com']")
    .forEach((node) => node.remove());
});

describe("enableGa4", () => {
  it("injects the gtag script for the measurement id, exactly once", () => {
    enableGa4();
    enableGa4(); // consent re-affirmed from the privacy page
    const scripts = document.querySelectorAll(`script[src="${GTAG_SRC}"]`);
    expect(scripts).toHaveLength(1);
    expect(GTAG_SRC).toContain(GA4_MEASUREMENT_ID);
  });

  it("pushes COMMANDS as `arguments` objects — the shape gtag.js executes", () => {
    /*
     * The defect this exists for, measured on production 2026-09-20: every
     * command we pushed was a plain Array, gtag.js files an Array as DATA and
     * never executes it, and so twenty-six days of "GA4 is live" produced zero
     * events — the tag loaded, `google_tag_data.tidr.destination` stayed empty,
     * and no `/g/collect` request was ever made.
     *
     * The test that shipped alongside the bug asserted CONTENTS, through
     * `Array.from(entry)` — which turns an Array and an `arguments` object into
     * the same array and is therefore blind to the only difference that
     * mattered. Contents were always right. Shape was always wrong.
     *
     * So this asserts the shape, at the same seam, for every entry the module
     * pushes.
     */
    enableGa4();

    const entries = win.dataLayer!;
    expect(entries.length).toBeGreaterThan(0);
    for (const [index, entry] of entries.entries()) {
      expect(
        Object.prototype.toString.call(entry),
        `dataLayer[${index}] is ${Object.prototype.toString.call(entry)}; gtag.js only executes [object Arguments]`,
      ).toBe("[object Arguments]");
    }
  });

  it("pushes product EVENTS with that same shape, through the telemetry seam", () => {
    // The events arrive by a different path (configureTelemetry's sink), so
    // the shape has to be proven there too — a fix applied to one and not the
    // other would leave half the measurement silent, which is exactly how this
    // defect stayed invisible.
    enableGa4();
    const before = win.dataLayer!.length;

    win.gtag!("event", "shape_probe", { ok: true });

    const pushed = win.dataLayer!.slice(before);
    expect(pushed).toHaveLength(1);
    expect(Object.prototype.toString.call(pushed[0])).toBe(
      "[object Arguments]",
    );
  });

  it("declares consent defaults before config, with every ad signal denied", () => {
    enableGa4();
    const calls = win.dataLayer!.map((entry) => Array.from(entry as unknown[]));
    const consentIndex = calls.findIndex((call) => call[0] === "consent");
    const configIndex = calls.findIndex((call) => call[0] === "config");
    expect(consentIndex).toBeGreaterThanOrEqual(0);
    expect(configIndex).toBeGreaterThan(consentIndex);
    expect(calls[consentIndex]![2]).toEqual({
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted",
    });
    expect(calls[configIndex]![1]).toBe(GA4_MEASUREMENT_ID);
  });

  it("routes track() events to gtag with the redacted payload and a query-free page_location", () => {
    // INVERTED 2026-10-10. This expected EXACTLY `{ toolSlug, capability }` —
    // and so pinned the defect: with no `page_location` in the params, gtag.js
    // filled it from `location.href`, and a `tool_viewed` fired on
    // `/tools/x?handoff=<token>` carried the token to Google (captured at the
    // wire, see ga4-event-location.test.ts). The payload is still exactly the
    // redacted event — plus the page, origin + path, nothing after it.
    enableGa4();
    const before = win.dataLayer!.length;
    track({
      name: "gated_tool_interest",
      toolSlug: "translate-pdf",
      capability: "ai",
    });
    const pushed = win
      .dataLayer!.slice(before)
      .map((entry) => Array.from(entry as unknown[]));
    expect(pushed).toEqual([
      [
        "event",
        "gated_tool_interest",
        {
          toolSlug: "translate-pdf",
          capability: "ai",
          page_location: `${window.location.origin}${window.location.pathname}`,
        },
      ],
    ]);
  });
});

describe("disableGa4", () => {
  it("tells a loaded tag to stop persisting, and later events reach it never", () => {
    enableGa4();
    disableGa4();
    const afterDisable = win.dataLayer!.length;
    const updates = win
      .dataLayer!.map((entry) => Array.from(entry as unknown[]))
      .filter((call) => call[0] === "consent" && call[1] === "update");
    expect(updates).toEqual([
      ["consent", "update", { analytics_storage: "denied" }],
    ]);
    track({
      name: "gated_tool_interest",
      toolSlug: "translate-pdf",
      capability: "ai",
    });
    expect(win.dataLayer!.length).toBe(afterDisable);
  });

  it("pushes nothing to Google when the tag was never loaded", () => {
    disableGa4();
    expect(win.dataLayer).toBeUndefined();
    expect(document.querySelector(`script[src="${GTAG_SRC}"]`)).toBeNull();
  });
});

// ───────────────────── page views: the URL never leaves ─────────────────────

const pushedCalls = () =>
  win.dataLayer!.map((entry) => Array.from(entry as unknown[]));

/** Every page_location the module ever pushed, config params included. */
function pageLocations(): string[] {
  const out: string[] = [];
  for (const call of pushedCalls())
    for (const arg of call)
      if (arg && typeof arg === "object" && "page_location" in arg)
        out.push(String((arg as { page_location: unknown }).page_location));
  return out;
}

describe("page views carry the path, never the query", () => {
  /*
   * Until 2026-09 `gtag("config", ID)` ran with no options, so gtag.js sent its
   * own page_view with `page_location = location.href` — and the workspace
   * launches tools with `router.push("/tools/x?handoff=<token>")`. Every launch
   * shipped the token to Google while the privacy page said query strings are
   * stripped. The automatic page_view is off, and the one we send is built
   * from the pathname.
   */
  it("turns the tag's automatic page_view off", () => {
    enableGa4();
    const config = pushedCalls().find((call) => call[0] === "config")!;
    expect(config[2]).toEqual({ send_page_view: false });
  });

  it("sends page_location as origin + path, whatever the address bar holds", () => {
    enableGa4();
    // POSITIVE CONTROL: the exact launch shape the workspace produces.
    history.pushState({}, "", "/tools/merge-pdf?handoff=tok_SECRET123#frag");
    sendGa4PageView("/tools/merge-pdf?handoff=tok_SECRET123#frag");
    sendGa4PageView("/tools/split-pdf");
    const locations = pageLocations();
    // AMENDED 2026-10-10: each page view is now preceded by a `set` of the
    // same query-free location (for the tag's own hits), so every location
    // appears twice — the set, then the page_view — and none carries a query.
    expect(locations).toEqual([
      `${location.origin}/tools/merge-pdf`,
      `${location.origin}/tools/merge-pdf`,
      `${location.origin}/tools/split-pdf`,
      `${location.origin}/tools/split-pdf`,
    ]);
    expect(JSON.stringify(pushedCalls())).not.toContain("tok_SECRET123");
    for (const loc of locations) expect(loc).not.toMatch(/[?#]/);
    history.pushState({}, "", "/");
  });

  it("sends nothing before consent has enabled the tag", () => {
    sendGa4PageView("/tools/merge-pdf");
    expect(win.dataLayer).toBeUndefined();
  });
});

// ───────────────────── withdrawal: off, and cookies gone ─────────────────────

function seedGaCookies() {
  document.cookie = "_ga=GA1.1.123.456; path=/";
  document.cookie = "_ga_6HV45S85DY=GS1.1.789; path=/";
  document.cookie = "unrelated=keep-me; path=/";
}
const cookieNames = () =>
  document.cookie
    .split(";")
    .map((c) => c.split("=")[0]!.trim())
    .filter(Boolean);

describe("withdrawing consent switches the tag off and removes its cookies", () => {
  afterEach(() => {
    for (const name of cookieNames())
      document.cookie = `${name}=; Max-Age=0; path=/`;
  });

  it("sets Google's hard opt-out and deletes every _ga cookie, leaving others", () => {
    seedGaCookies();
    // Positive control: the cookies really were there.
    expect(cookieNames()).toEqual(
      expect.arrayContaining(["_ga", "_ga_6HV45S85DY", "unrelated"]),
    );
    enableGa4();
    disableGa4();
    expect(
      (win as unknown as Record<string, unknown>)[GA_DISABLE_PROPERTY],
    ).toBe(true);
    expect(cookieNames().filter((n) => n.startsWith("_ga"))).toEqual([]);
    expect(cookieNames()).toContain("unrelated");
  });

  it("also clears cookies left by an earlier visit, when the tag never loaded here", () => {
    seedGaCookies();
    disableGa4();
    expect(cookieNames().filter((n) => n.startsWith("_ga"))).toEqual([]);
    expect(win.dataLayer).toBeUndefined();
  });

  it("expires each cookie at every parent domain AND host-only (GA writes domain=.pdf.xyz)", () => {
    const writes: string[] = [];
    const fakeDoc = {
      get cookie() {
        return "_ga=1; _ga_6HV45S85DY=2; other=3";
      },
      set cookie(value: string) {
        writes.push(value);
      },
    } as unknown as Document;
    expect(clearGaCookies(fakeDoc, "www.pdf.xyz")).toEqual([
      "_ga",
      "_ga_6HV45S85DY",
    ]);
    for (const name of ["_ga", "_ga_6HV45S85DY"]) {
      const mine = writes.filter((w) => w.startsWith(`${name}=;`));
      expect(mine.some((w) => !w.includes("domain="))).toBe(true);
      expect(mine.some((w) => w.endsWith("domain=.pdf.xyz"))).toBe(true);
      expect(mine.some((w) => w.endsWith("domain=.www.pdf.xyz"))).toBe(true);
    }
    expect(writes.some((w) => w.startsWith("other="))).toBe(false);
  });

  it("allowing again on the same page lifts the opt-out and grants with an UPDATE", () => {
    enableGa4();
    disableGa4();
    enableGa4();
    expect(
      (win as unknown as Record<string, unknown>)[GA_DISABLE_PROPERTY],
    ).toBe(false);
    const consents = pushedCalls().filter((call) => call[0] === "consent");
    // default(granted) → update(denied) → update(granted): a second DEFAULT
    // would be ignored by an initialised gtag.js and leave analytics denied.
    expect(
      consents.map((c) => [
        c[1],
        (c[2] as Record<string, string>).analytics_storage,
      ]),
    ).toEqual([
      ["default", "granted"],
      ["update", "denied"],
      ["update", "granted"],
    ]);
    expect(document.querySelectorAll(`script[src="${GTAG_SRC}"]`)).toHaveLength(
      1,
    );
  });
});
