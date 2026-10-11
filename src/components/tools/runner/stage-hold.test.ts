// @vitest-environment jsdom
/**
 * The runner's stage held from a Run press (`./stage-hold`): how tall, and
 * when it is given back. The browser half — nothing on screen moves from a
 * Run press to the result's ending, at eight sizes, and the same
 * measurement red with the hold taken away — is `e2e/continue-chain.spec.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { holdRunnerStage } from "./stage-hold";

/** A stage laid out `height` px tall, its top `top` px down the screen. */
function stage(top: number, height: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-runner-stage", "");
  el.getBoundingClientRect = () =>
    ({ top, height, bottom: top + height }) as DOMRect;
  document.body.append(el);
  return el;
}

const press = () =>
  document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
const key = () =>
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));

afterEach(() => {
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

  it("holds a tall stage at its own height, so a shorter result moves nothing under it", () => {
    // Scrolled 300 px into it; its bottom 1,100 px down, below the screen.
    const el = stage(-300, 1400.4);
    holdRunnerStage();
    expect(el.style.minHeight).toBe("1401px");
  });

  it("is given back at the first press AFTER the run settles, and not before", () => {
    const el = stage(100, 400);
    const settled = holdRunnerStage();
    press();
    key();
    // A press while the run is working is not the end of the hold: the
    // result has not been drawn yet.
    expect(el.style.minHeight).toBe("668px");
    settled();
    expect(el.style.minHeight).toBe("668px");
    press();
    expect(el.style.minHeight).toBe("");
  });

  it("a key is a press too", () => {
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
    el.getBoundingClientRect = () =>
      ({ top: 100, height: 900, bottom: 1000 }) as DOMRect;
    const second = holdRunnerStage();
    press();
    // The first hold's listener saw the press and released nothing of the
    // second's, which has not settled.
    expect(el.style.minHeight).toBe("900px");
    second();
    press();
    expect(el.style.minHeight).toBe("");
  });

  it("a page with no runner stage is left alone", () => {
    const settled = holdRunnerStage();
    settled();
    press();
    expect(document.body.children).toHaveLength(0);
  });
});
