// @vitest-environment jsdom
/**
 * The runner's stage held from a Run press (`./stage-hold`): how tall, how
 * it shrinks, when it is given back, and what it leaves behind. The browser
 * half is in `e2e/`: from a Run press to the ending at eight sizes
 * (`continue-chain.spec.ts`), held blank past the bottom of the screen
 * through a wheel scroll (`stage-hold.spec.ts`), and a touch that becomes a
 * scroll on a phone (`stage-hold.mobile.spec.ts`) — each with a control
 * that the same measurement sees the defect it guards.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAsyncRun } from "./runner-kit";
import { holdRunnerStage } from "./stage-hold";

/** A stage laid out `height` px tall, its top `top` px down the screen. */
function stage(top: number, height: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-runner-stage", "");
  place(el, top, height);
  document.body.append(el);
  return el;
}

/** Where the stage is now, as the page lays it out (a scroll moves `top`). */
function place(el: HTMLElement, top: number, height: number) {
  el.getBoundingClientRect = () =>
    ({ top, height, bottom: top + height }) as DOMRect;
}

const click = () =>
  document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const pointerdown = () =>
  document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
const key = () =>
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
const scroll = () => window.dispatchEvent(new Event("scroll"));

/**
 * Every listener the hold has on the document and the window right now:
 * what an unmounted runner would leave behind.
 */
const live = new Set<string>();
let ids = new WeakMap<object, number>();
let next = 0;
function track(target: EventTarget, name: string) {
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  const id = (fn: unknown) => {
    const key = fn as object;
    if (!ids.has(key)) ids.set(key, ++next);
    return ids.get(key);
  };
  const capture = (o: unknown) =>
    typeof o === "boolean" ? o : Boolean((o as { capture?: boolean })?.capture);
  vi.spyOn(target, "addEventListener").mockImplementation((type, fn, o) => {
    live.add(`${name}:${type}:${id(fn)}:${capture(o)}`);
    add(type, fn, o);
  });
  vi.spyOn(target, "removeEventListener").mockImplementation((type, fn, o) => {
    live.delete(`${name}:${type}:${id(fn)}:${capture(o)}`);
    remove(type, fn, o);
  });
}

beforeEach(() => {
  live.clear();
  ids = new WeakMap();
  track(document, "document");
  track(window, "window");
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("holdRunnerStage", () => {
  it("holds a short stage to the bottom of the screen, so what is under it leaves the screen at the press", () => {
    // jsdom's screen is 768 px tall.
    expect(window.innerHeight).toBe(768);
    const el = stage(300, 200);
    holdRunnerStage();
    expect(el.style.minHeight).toBe("468px");
  });

  it("holds a tall stage at its own height while the run works, so a shorter result moves nothing under it", () => {
    // Scrolled 300 px into it; its bottom 1,100 px down, below the screen.
    const el = stage(-300, 1400.4);
    holdRunnerStage();
    expect(el.style.minHeight).toBe("1401px");
  });

  it("at the settle, gives back what it holds past the bottom of the screen: the held stage ends at the fold", () => {
    // WAS (7cdb814b..2026-10-17): held at the editor's 1,401 px until the
    // next press, so a short result left the rest as blank panel below the
    // screen — up to a screen and a half of it, scrolled into by a wheel
    // (Edit PDF at 1440 x 900: 949 px). Space below the screen is given back
    // without moving anything a reader sees.
    const el = stage(-300, 1400.4);
    const settled = holdRunnerStage();
    settled();
    expect(el.style.minHeight).toBe(`${768 + 300}px`);
  });

  it("after the run, a scroll back up gives back what the fold no longer reaches — and a scroll down never grows the hold", () => {
    const el = stage(-300, 1400);
    const settled = holdRunnerStage();
    settled();
    expect(el.style.minHeight).toBe("1068px");
    // Back up 300 px: the stage's top at the top of the screen.
    place(el, 0, 1068);
    scroll();
    expect(el.style.minHeight).toBe("768px");
    // Down 600 px: the fold moves down the stage; the hold stays.
    place(el, -600, 768);
    scroll();
    expect(el.style.minHeight).toBe("768px");
  });

  it("a scroll WHILE the run works gives back only what is past the fold, never what the editor fills", () => {
    const el = stage(-300, 1400);
    holdRunnerStage();
    place(el, 0, 1400);
    scroll();
    // The editor is still drawn 1,400 px tall; its own height holds the
    // stage, the hold no longer reaches past the screen.
    expect(el.style.minHeight).toBe("768px");
  });

  it("a resize that brings the fold up gives back what the hold kept past the new one", () => {
    const el = stage(0, 400);
    holdRunnerStage()();
    expect(el.style.minHeight).toBe("768px");
    const real = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 600,
    });
    try {
      window.dispatchEvent(new Event("resize"));
      expect(el.style.minHeight).toBe("600px");
    } finally {
      if (real) Object.defineProperty(window, "innerHeight", real);
      else Reflect.deleteProperty(window, "innerHeight");
    }
  });

  it("a stage scrolled wholly below the screen is let go: nothing it holds is on screen", () => {
    const el = stage(-300, 1400);
    holdRunnerStage()();
    place(el, 900, 1068);
    scroll();
    expect(el.style.minHeight).toBe("");
    expect([...live], "listeners left behind").toEqual([]);
  });

  it("is given back at the first click AFTER the run settles, and not before", () => {
    const el = stage(100, 400);
    const settled = holdRunnerStage();
    click();
    key();
    // A click while the run is working is not the end of the hold: the
    // result has not been drawn yet.
    expect(el.style.minHeight).toBe("668px");
    settled();
    expect(el.style.minHeight).toBe("668px");
    click();
    expect(el.style.minHeight).toBe("");
    expect([...live], "listeners left behind").toEqual([]);
  });

  /**
   * INVERTED 2026-10-17. This was "is given back at the first press AFTER
   * the run settles" with the press a `pointerdown` — and it passed, which
   * was the defect: on a phone a pointerdown is usually the START OF A
   * SCROLL, and Chromium counts a shift made while a touch turns into a
   * scroll as unexpected (hadRecentInput = false). Releasing there moved the
   * About section by the held band, and it counted: Sign PDF at 390 x 844,
   * 0.1135 per release on 36702d2c (batch C review), 0.1339 on 94dc2b22
   * (`e2e/stage-hold.mobile.spec.ts`). A tap that stays a tap fires a click;
   * a touch that becomes a scroll fires pointercancel, and no click.
   */
  it("a pointerdown is not a release: on a phone it is usually the start of a scroll", () => {
    const el = stage(100, 400);
    holdRunnerStage()();
    pointerdown();
    expect(el.style.minHeight).toBe("668px");
    click();
    expect(el.style.minHeight).toBe("");
  });

  /**
   * A KEY THAT SCROLLS IS A WHEEL (2026-10-17). Released at the keydown, the
   * band went and THEN the page scrolled, so what followed the runner came
   * up by the band and the scroll carried the reader past it: on c7abb986
   * (PR #180 review) PageDown skipped 59 px of the About heading on Sign
   * PDF at 1280 x 720, 107 px on Edit PDF at 1440 x 900, and ArrowDown
   * jumped 335 px for a 40 px scroll. A scroll key now does what the wheel
   * does — the scroll gives back what passes the fold, never the band.
   */
  it.each(["PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End", " "])(
    "a scroll key (%j) is not a release: it scrolls, like the wheel",
    (name) => {
      const el = stage(100, 400);
      holdRunnerStage()();
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: name, bubbles: true }),
      );
      expect(el.style.minHeight).toBe("668px");
      // Any other key still is: Tab, a letter, Enter.
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
      expect(el.style.minHeight).toBe("");
    },
  );

  it("a key is a release too", () => {
    const el = stage(100, 400);
    holdRunnerStage()();
    key();
    expect(el.style.minHeight).toBe("");
  });

  it("a newer hold is not given back by an older one's release", () => {
    const el = stage(100, 400);
    const first = holdRunnerStage();
    first();
    // The reader runs again before pressing anything else: a new hold.
    place(el, 100, 900);
    const second = holdRunnerStage();
    click();
    // The first hold's listener did not see the click (it is gone), and the
    // second has not settled.
    expect(el.style.minHeight).toBe("900px");
    second();
    click();
    expect(el.style.minHeight).toBe("");
  });

  it("a newer hold ends the older one's listeners at once — they do not pile up run after run", () => {
    stage(100, 400);
    holdRunnerStage();
    const one = live.size;
    expect(one, "the hold listens to nothing").toBeGreaterThan(0);
    // Neither run ever settles (a runner unmounted mid-run, a hung task).
    holdRunnerStage();
    holdRunnerStage();
    expect(live.size).toBe(one);
  });

  it("a hold whose stage left the page (a runner unmounted mid-run) removes its listeners at the next event", () => {
    const el = stage(100, 400);
    holdRunnerStage();
    expect(live.size).toBeGreaterThan(0);
    // Client navigation: the page, and its stage, are gone; the run never
    // settles.
    el.remove();
    scroll();
    expect([...live], "listeners left behind").toEqual([]);
  });

  it("a runner unmounted mid-run (`useAsyncRun`) settles its hold: the reader's next click gives the stage back", () => {
    const el = stage(100, 400);
    const { result, unmount } = renderHook(() => useAsyncRun<number>());
    act(() => {
      // A run that never ends: the result it was held for is never drawn.
      void result.current.run(() => new Promise<number>(() => {}));
    });
    expect(el.style.minHeight).toBe("668px");
    unmount();
    click();
    expect(el.style.minHeight).toBe("");
    // React's own document listeners (selectionchange) are not the hold's.
    expect(
      [...live].filter((l) => /:(click|keydown|scroll|resize):/.test(l)),
      "listeners left behind",
    ).toEqual([]);
  });

  it("steps aside when something else set the stage's height: it never re-applies a hold it no longer owns", () => {
    const el = stage(-300, 1400);
    holdRunnerStage()();
    el.style.minHeight = "";
    place(el, 0, 600);
    scroll();
    expect(el.style.minHeight).toBe("");
    expect([...live], "listeners left behind").toEqual([]);
  });

  it("a page with no runner stage is left alone", () => {
    const settled = holdRunnerStage();
    settled();
    click();
    expect(document.body.children).toHaveLength(0);
    expect([...live]).toEqual([]);
  });
});
