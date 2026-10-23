// @vitest-environment jsdom
/**
 * A worker that is NOT ENABLED says so in one plain sentence, with its two
 * actions as buttons, and keeps the long account one press away.
 *
 * WHY (owner, 2026-10-23): the not-enabled box was the tallest thing the
 * status slot could show — the engine's reason, a "never pretends to …"
 * paragraph, Notify me with its own paragraph, "Nothing is uploaded while
 * the worker is unavailable…", and Try again — and every panel's reserve
 * (`STATUS_SLOT`) is sized by its tallest state. So on a WORKING worker the
 * Run button sat over a 390px empty band on a phone (325px at 1440), room
 * kept for an apology nobody on a working page reads.
 *
 * What stays in plain sight, and why:
 *  - the sentence, Try again and Notify me — what the visitor can do;
 *  - Notify me's own line about the server logs and analytics: it must be
 *    read BEFORE the press (`notify-me.tsx`, `interest-disclosure.test.ts`),
 *    so it is never behind "Why?".
 * Behind "Why?", unmounted never — `hidden`, so the claim guards and a
 * crawler read the same words (`worker-panel-pending.test.tsx` still finds
 * "never pretends" in the DOM of an OFF panel).
 *
 * THE SUBJECTS ARE DISCOVERED from the tool page's own dispatch, with a
 * size health check, so a new panel is held here without an edit.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { resetTelemetry } from "@/lib/telemetry/track";
import { resetWorkerStatusForTests } from "./use-worker-status";
import {
  catalogTool,
  panelComponent,
  panelDispatchArms,
} from "@/tests/worker-panel-dispatch";

const ARMS = panelDispatchArms();

const OFF: WorkerStatus = {
  mode: "disabled",
  enabled: false,
  localDevOnly: false,
  detail: "No secure worker is configured in this environment.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: { available: false, engine: null, languages: [], detail: "off" },
  security: {
    available: false,
    operations: ["protect", "unlock"],
    detail: "off",
  },
  providers: getProviderReadiness("disabled"),
  daemon: resolveDaemonReadiness({}),
  ai: resolveAiReadiness({}),
  pipeline: {
    verdict: "off",
    observed: false,
    drainable: false,
    detail: "no worker observed",
  },
};

/** The one sentence the box leads with. */
const SENTENCE = /^This tool is offline right now\. Try again later\.$/;
/** Notify me's disclosure — what the press sends, read before pressing. */
const PRIVACY_LINE = /ordinary server logs.*Google Analytics/;
/** The long account, in each panel's own words: behind "Why?". */
const LONG_ACCOUNT = /never pretends|Nothing is uploaded while the worker/;

/** Shown: no ancestor (or itself) carries `hidden`. */
function shown(el: Element): boolean {
  for (let at: Element | null = el; at; at = at.parentElement)
    if (at.hasAttribute("hidden")) return false;
  return true;
}

/** The text a reader sees: every text node with no hidden ancestor. */
function shownText(root: Element): string {
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* TEXT */);
  let out = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    if (n.parentElement && shown(n.parentElement)) out += n.textContent;
  return out.replace(/\s+/g, " ");
}

afterEach(() => {
  cleanup();
  resetTelemetry();
  vi.unstubAllGlobals();
});

describe("the not-enabled box of every dispatched worker panel", () => {
  it("health: the corpus is the size the page implies", () => {
    expect(ARMS.length).toBeGreaterThanOrEqual(13);
  });

  it("positive control: the shown-text reader drops what `hidden` hides", () => {
    const div = document.createElement("div");
    div.innerHTML =
      "<p>seen</p><div hidden><p>This panel never pretends.</p></div>";
    expect(shownText(div)).toBe("seen");
    expect(div.textContent).toMatch(LONG_ACCOUNT);
  });

  it.each(ARMS.map((a) => [a.component, a] as const))(
    "%s: one sentence, Try again and Notify me shown; the reason one press away",
    async (_name, arm) => {
      resetWorkerStatusForTests({ sleep: () => Promise.resolve() });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, status: 200, json: async () => OFF })),
      );
      const Panel = await panelComponent(arm);
      const { container } = render(
        createElement(Panel, { tool: catalogTool(arm.slugs[0]!) }),
      );
      const slot = container.querySelector('[data-slot="worker-status"]')!;
      await waitFor(() => expect(slot.getAttribute("data-state")).toBe("off"));

      // The box is its own chunk (lazy): it arrives after the state.
      await waitFor(() =>
        expect(
          slot.querySelector("[data-off]"),
          "no not-enabled box",
        ).not.toBeNull(),
      );
      const box = slot.querySelector("[data-off]");
      const lead = box!.querySelector("[data-off-lead]");
      expect(lead?.textContent?.trim()).toMatch(SENTENCE);
      expect(shown(lead!)).toBe(true);

      const buttons = [...box!.querySelectorAll("button")].filter(shown);
      const names = buttons.map((b) => (b.textContent ?? "").trim());
      expect(names).toContain("Try again");
      expect(names.some((n) => /^Notify me/.test(n))).toBe(true);
      expect(shownText(box!)).toMatch(PRIVACY_LINE);

      // The long account is in the DOM, and not shown until asked for.
      expect(box!.textContent ?? "").toMatch(LONG_ACCOUNT);
      expect(shownText(box!)).not.toMatch(LONG_ACCOUNT);
      const why = buttons.find((b) => (b.textContent ?? "").trim() === "Why?");
      expect(why, "no Why? button").toBeDefined();
      expect(why!.getAttribute("aria-expanded")).toBe("false");
      const region = container.ownerDocument.getElementById(
        why!.getAttribute("aria-controls") ?? "",
      );
      expect(region, "Why? controls nothing").not.toBeNull();
      expect(box!.contains(region)).toBe(true);
      await act(async () => {
        fireEvent.click(why!);
      });
      expect(why!.getAttribute("aria-expanded")).toBe("true");
      expect(shownText(box!)).toMatch(LONG_ACCOUNT);
    },
  );
});
