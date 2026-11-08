// @vitest-environment jsdom
/**
 * A DOWNLOAD THAT BEATS THE REGISTRATION STILL KEEPS THE RESULT (2026-11-08).
 *
 * A result on screen registers itself as "not downloaded yet", so a paste that
 * would replace it asks first (`registerUnkeptResult`, `@/lib/intent/unsaved`).
 * A download releases it (`downloadBlob` calls `resultsKept`).
 *
 * The registration ran in a PASSIVE effect. React runs those after the commit,
 * in a later task, so between the result's buttons reaching the DOM and the
 * registration there was a window. A Download pressed inside that window
 * released nothing (nothing was registered yet). The registration then landed,
 * and the next paste asked "not downloaded yet" about a file the visitor had
 * just downloaded. The window was usually far too short for a person to hit,
 * but CI's loaded runners hit it: `replace-target.test.tsx`'s "CONTROL: once
 * downloaded, a paste replaces it without a question" failed on PR #294 at
 * 5,186 ms, against 245 ms locally.
 *
 * This test opens the window on purpose. It renders outside `act`, so React
 * schedules the commit and its passive effects as separate tasks, and it
 * presses Download from a MutationObserver callback, the microtask that runs
 * right after the commit's DOM writes and before any later task. Registering
 * in a layout effect (same commit, before the observer runs) closes it.
 */
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmReplaceResult,
  resetUnsavedForTests,
} from "@/lib/intent/unsaved";
import { outputFile } from "@/lib/intent/run-output";
import { downloadBlob } from "@/lib/pdf/browser";
import { NO_ADJUST, ResultPanel } from "./runner-kit";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | null = null;
let container: HTMLDivElement;
let actEnvironment: boolean | undefined;

beforeEach(() => {
  resetUnsavedForTests();
  actEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  // Outside act: React schedules work as it does in a browser.
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: () => "blob:unkept-race",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  root?.unmount();
  root = null;
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
  vi.restoreAllMocks();
  resetUnsavedForTests();
});

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

function panel() {
  return (
    <ResultPanel
      title="PDF rotated"
      onReset={() => {}}
      onAdjust={NO_ADJUST("test")}
      output={outputFile(new Uint8Array([37, 80, 68, 70]), "rotated.pdf")}
    >
      <button
        type="button"
        data-download=""
        onClick={() => downloadBlob(new Blob(["%PDF"]), "rotated.pdf")}
      >
        Download rotated PDF
      </button>
    </ResultPanel>
  );
}

/** Render; when Download first reaches the DOM, optionally press it then. */
function renderPanel(pressOnCommit: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const button =
        container.querySelector<HTMLButtonElement>("[data-download]");
      if (!button) return;
      observer.disconnect();
      if (pressOnCommit) button.click();
      resolve(true);
    });
    observer.observe(container, { childList: true, subtree: true });
    root = createRoot(container);
    root.render(panel());
  });
}

describe("a result's 'not downloaded yet' registration", () => {
  it("CONTROL: a result nobody downloaded makes a paste ask", async () => {
    await renderPanel(false);
    await later(50); // every effect has run
    const ask = vi.fn(() => false);
    expect(confirmReplaceResult("second.pdf", "Rotate PDF", ask)).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("a Download pressed the moment the result commits keeps it: a paste does not ask", async () => {
    await renderPanel(true);
    await later(50); // any registration still pending has now landed
    const ask = vi.fn(() => false);
    expect(confirmReplaceResult("second.pdf", "Rotate PDF", ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
});
