import { expect, type Page } from "@playwright/test";
import { fileInput, waitForHydration } from "./helpers";
import { makeTextPdf } from "./client-proof/fixtures";

/**
 * The runner's stage after a Run press, read the way a reader meets it: a
 * tall editor scrolled to reach Run, the press, the result drawn into the
 * held stage (`src/components/tools/runner/stage-hold.ts`), and then what
 * the reader does next — a wheel, a touch that becomes a scroll, a tap, a
 * key. Shared by `stage-hold.spec.ts` (desktop, mouse and wheel) and
 * `stage-hold.mobile.spec.ts` (a touch phone).
 *
 * What it reads, every painted frame from the press:
 *  - HELD PAST THE FOLD: how far the stage's held height reaches below the
 *    bottom of the screen and below its content — space that exists only
 *    because of the hold, that the reader would scroll into as blank panel;
 *  - the blank on screen: the stage's height between its content and the
 *    bottom of the screen;
 * and, beside them, every `layout-shift` entry and every pointer event, so a
 * shift can be told apart by whether it came inside an input's window.
 */

export interface HeldCase {
  readonly slug: string;
  readonly file: { readonly name: string; readonly size?: [number, number] };
  /** What the reader does in the editor before Run. */
  readonly prepare: (page: Page) => Promise<void>;
  readonly run: RegExp;
  readonly done: RegExp;
}

/** Sign PDF: one page, a typed signature (the proof case's own steps). */
export const SIGN: HeldCase = {
  slug: "sign-pdf",
  file: { name: "contract.pdf" },
  prepare: async (page) => {
    await page.getByLabel("Your signature").fill("Ada Lovelace");
  },
  run: /^sign pdf$/i,
  done: /pdf signed/i,
};

/** Edit PDF: a Letter page, one text edit placed — the tallest editor. */
export const EDIT: HeldCase = {
  slug: "edit-pdf",
  file: { name: "revise.pdf", size: [612, 792] },
  prepare: async (page) => {
    await page.getByLabel("Text", { exact: true }).fill("MARK");
    await page.getByRole("button", { name: /add to page/i }).click();
    await expect(
      page.getByRole("list", { name: "Placed edits" }),
    ).toBeVisible();
  },
  run: /apply 1 edit/i,
  done: /edited pdf ready/i,
};

/**
 * The tool open, its file picked, the case's edits made, and the page
 * scrolled to Run as a reader who scrolled down the editor has it: at the
 * bottom of the screen (`end`), or at its top under the header (`start`, a
 * reader who read on past Run and came back up to press it).
 */
export async function prepareScrolled(
  page: Page,
  c: HeldCase,
  where: "end" | "start" = "end",
) {
  await page.goto(`/tools/${c.slug}`);
  const input = fileInput(page);
  await waitForHydration(input);
  await page.evaluate(() => document.fonts.ready);
  await input.setInputFiles({
    name: c.file.name,
    mimeType: "application/pdf",
    buffer: Buffer.from(
      await makeTextPdf(c.file.name, { pages: 1, size: c.file.size }),
    ),
  });
  await expect(page.getByText(c.file.name, { exact: true })).toBeVisible();
  await c.prepare(page);
  const run = page.getByRole("button", { name: c.run });
  await expect(run).toBeEnabled();
  await run.evaluate((el, where) => {
    if (where === "end") {
      el.scrollIntoView({ block: "end", behavior: "instant" });
      return;
    }
    const header = document.querySelector("header");
    const under = header ? header.getBoundingClientRect().bottom : 0;
    const top = el.getBoundingClientRect().top + scrollY;
    window.scrollTo({ top: top - under - 16, behavior: "instant" });
  }, where);
  // Settle: the instant scroll, then a frame.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => r(null))),
  );
  return run;
}

export interface HoldFrame {
  readonly t: number;
  /** A result is drawn in the stage. */
  readonly result: boolean;
  /** The stage's min-height as computed, in px (0 when none). */
  readonly minPx: number;
  readonly inline: string;
  readonly top: number;
  readonly bottom: number;
  readonly fold: number;
  readonly scrollY: number;
  /** Held space below the screen's bottom and below the content, px. */
  readonly pastFold: number;
  /** The stage's content's bottom, when it was read (only when held past the fold). */
  readonly contentBottom: number | null;
}

export interface HoldShift {
  readonly t: number;
  readonly value: number;
  readonly input: boolean;
  readonly sources: readonly string[];
}

export interface HoldRecord {
  readonly frames: HoldFrame[];
  readonly shifts: HoldShift[];
  readonly pointer: { t: number; type: string; pointerType: string }[];
}

/** Starts the per-frame record, the shift observer and the pointer log. */
export async function startHoldRecord(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __hold: HoldRecord;
      __holdStop?: boolean;
      __holdContentBottom: () => number;
    };
    const rec: HoldRecord = { frames: [], shifts: [], pointer: [] };
    w.__hold = rec;
    w.__holdStop = false;
    const stage = document.querySelector<HTMLElement>("[data-runner-stage]")!;
    // The bottom of what is drawn in the stage: every element in it that is
    // not stretched to fill (a flex child that grows takes the held height,
    // and is not content).
    w.__holdContentBottom = () => {
      let max = stage.getBoundingClientRect().top;
      for (const el of stage.querySelectorAll<HTMLElement>("*")) {
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue;
        if (getComputedStyle(el).flexGrow !== "0") continue;
        if (r.bottom > max) max = r.bottom;
      }
      return max;
    };
    for (const type of ["pointerdown", "pointercancel", "pointerup", "click"])
      document.addEventListener(
        type,
        (event) =>
          rec.pointer.push({
            t: performance.now(),
            type,
            pointerType: (event as PointerEvent).pointerType ?? "",
          }),
        true,
      );
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: {
            node?: Node | null;
            previousRect: DOMRectReadOnly;
            currentRect: DOMRectReadOnly;
          }[];
        };
        rec.shifts.push({
          t: shift.startTime,
          value: shift.value,
          input: shift.hadRecentInput,
          sources: (shift.sources ?? []).map((s) => {
            const el = s.node instanceof Element ? s.node : null;
            const name = el
              ? `${el.tagName.toLowerCase()}${
                  typeof el.className === "string" && el.className
                    ? "." +
                      el.className.trim().split(/\s+/).slice(0, 2).join(".")
                    : ""
                }`
              : (s.node?.nodeName ?? "?");
            return `${name} ${Math.round(s.previousRect.top)}→${Math.round(s.currentRect.top)}`;
          }),
        });
      }
    }).observe({ type: "layout-shift" });
    const tick = (t: number) => {
      if (w.__holdStop) return;
      const box = stage.getBoundingClientRect();
      const minPx = Number.parseFloat(getComputedStyle(stage).minHeight) || 0;
      const fold = window.innerHeight;
      const over = minPx > 0 ? box.top + minPx - fold : 0;
      let pastFold = 0;
      let contentBottom: number | null = null;
      if (over > 1) {
        contentBottom = w.__holdContentBottom();
        pastFold = Math.max(
          0,
          Math.min(box.bottom, box.top + minPx) - Math.max(fold, contentBottom),
        );
      }
      rec.frames.push({
        t,
        result: stage.querySelector("[data-result-panel]") !== null,
        minPx,
        inline: stage.style.minHeight,
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        fold,
        scrollY: Math.round(scrollY),
        pastFold: Math.round(pastFold),
        contentBottom:
          contentBottom === null ? null : Math.round(contentBottom),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export async function stopHoldRecord(page: Page): Promise<HoldRecord> {
  return page.evaluate(() => {
    const w = window as unknown as { __hold: HoldRecord; __holdStop?: boolean };
    w.__holdStop = true;
    return w.__hold;
  });
}

/** Where things are now: the stage, its content, the screen, the blank. */
export async function stageNow(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __holdContentBottom: () => number };
    const stage = document.querySelector<HTMLElement>("[data-runner-stage]")!;
    const box = stage.getBoundingClientRect();
    const minPx = Number.parseFloat(getComputedStyle(stage).minHeight) || 0;
    const fold = window.innerHeight;
    const content = w.__holdContentBottom();
    return {
      scrollY: Math.round(scrollY),
      fold,
      held: stage.style.minHeight,
      stageTop: Math.round(box.top),
      stageBottom: Math.round(box.bottom),
      contentBottom: Math.round(content),
      /** The stage's blank under its content that is on screen. */
      blankOnScreen: Math.round(
        Math.max(0, Math.min(fold, box.bottom) - Math.max(0, content)),
      ),
      /** Held space past the bottom of the screen and past the content. */
      heldPastFold: Math.round(
        minPx > 0
          ? Math.max(
              0,
              Math.min(box.bottom, box.top + minPx) - Math.max(fold, content),
            )
          : 0,
      ),
    };
  });
}

export type StageNow = Awaited<ReturnType<typeof stageNow>>;

/** Waits until the case's result and its receipt are drawn. */
export async function resultDrawn(page: Page, c: HeldCase) {
  await expect(page.getByRole("heading", { name: c.done })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("[data-runner-stage] [data-receipt]")).toBeVisible({
    timeout: 20_000,
  });
  // The result's focus scroll and a frame or two after it.
  await page.waitForTimeout(400);
}

/** The most any painted frame after the result held past the fold, and where. */
export function worstPastFold(rec: HoldRecord) {
  const after = rec.frames.filter((f) => f.result);
  const worst = after.reduce<HoldFrame | null>(
    (w, f) => (w === null || f.pastFold > w.pastFold ? f : w),
    null,
  );
  return { frames: after.length, worst };
}

/**
 * The stage's hold as the code before 2026-10-17 gave it back — at the next
 * pointerdown after the result — for the CONTROLS: installed in every
 * document, it clears the stage's min-height at a pointerdown once a result
 * is drawn.
 */
export async function releaseOnPointerdown(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener(
      "pointerdown",
      () => {
        const stage = document.querySelector<HTMLElement>(
          "[data-runner-stage]",
        );
        if (stage?.querySelector("[data-result-panel]"))
          stage.style.minHeight = "";
      },
      true,
    );
  });
}

/**
 * A layout shift the test makes itself, before what it reads: proof the
 * browser reports this page's shifts at all (a sum of nothing is the
 * strongest possible pass).
 */
export async function shiftOfOurOwn(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const box = document.createElement("div");
        box.textContent = "instrument check";
        box.style.cssText =
          "position:fixed;left:0;top:0;width:40vw;height:20vh;z-index:9999;background:Canvas;color:CanvasText";
        document.body.append(box);
        const at = performance.now();
        const frame = () => new Promise((r) => requestAnimationFrame(r));
        void frame()
          .then(frame)
          .then(() => {
            box.style.top = "25vh";
          })
          .then(frame)
          .then(frame)
          .then(() => {
            box.remove();
            resolve(at);
          });
      }),
  );
}
