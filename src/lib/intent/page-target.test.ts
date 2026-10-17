/**
 * Where a file lands when it is dropped or pasted anywhere on a page.
 *
 * WHAT IT REPLACES. Each surface listened for the page's drops itself: the
 * home desk caught every drop on the home page (`catchPageDrops`), and on
 * every other page a file released anywhere but a drop zone was OPENED BY
 * THE BROWSER, in the tab — the visitor's page was replaced by their PDF.
 * Now one registry answers "where does this go?" for every page: the page's
 * target (the last one registered), or, when there is none, it is busy, or
 * it cannot open these files, the fallback (the ticket dialog).
 *
 * Module-level state, so each test starts from `resetPageTargetsForTests()`:
 * vitest runs files in one module cache (`isolate: false`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activePageTarget,
  deliverFiles,
  deliverToFallback,
  registerFallback,
  registerPageTarget,
  requestFilePick,
  resetPageTargetsForTests,
  routeFor,
  subscribeTargets,
  type PageFallback,
  type PageTarget,
} from "./page-target";
import { takesByAccept } from "./accept-match";

afterEach(() => resetPageTargetsForTests());

function target(over: Partial<PageTarget> = {}): PageTarget {
  return {
    name: "Merge PDF",
    verb: "add",
    canReceive: () => true,
    takes: takesByAccept("application/pdf,.pdf"),
    receive: vi.fn(),
    arm: vi.fn(),
    element: () => null,
    ...over,
  };
}

function fallback() {
  return {
    receive: vi.fn<PageFallback["receive"]>(),
    pick: vi.fn<PageFallback["pick"]>(),
  };
}

const pdf = (name = "a.pdf") =>
  new File(["%PDF-1.7"], name, { type: "application/pdf" });
const jpg = (name = "photo.jpg") =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: "image/jpeg" });

describe("the target stack", () => {
  it("the last registration is the page's target, and leaving restores the one before", () => {
    const a = target({ name: "A" });
    const b = target({ name: "B" });
    const offA = registerPageTarget(a);
    const offB = registerPageTarget(b);
    expect(activePageTarget()).toBe(b);
    offB();
    expect(activePageTarget()).toBe(a);
    offA();
    offA(); // twice is harmless
    expect(activePageTarget()).toBeNull();
  });

  it("an earlier target leaving does not unseat the current one", () => {
    const a = target({ name: "A" });
    const b = target({ name: "B" });
    const offA = registerPageTarget(a);
    registerPageTarget(b);
    offA();
    expect(activePageTarget()).toBe(b);
  });

  it("the same target registered twice is two registrations, each removed by its own call", () => {
    const a = target();
    const first = registerPageTarget(a);
    const second = registerPageTarget(a);
    first();
    expect(activePageTarget()).toBe(a);
    second();
    expect(activePageTarget()).toBeNull();
  });

  it("subscribers hear every change, and stop hearing once they leave", () => {
    const heard = vi.fn();
    const stop = subscribeTargets(heard);
    const off = registerPageTarget(target());
    off();
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    registerPageTarget(target());
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("reset empties everything — targets, fallbacks and listeners", () => {
    const heard = vi.fn();
    subscribeTargets(heard);
    registerPageTarget(target());
    registerFallback(fallback());
    deliverToFallback([pdf()], "drop", { kind: "none" });
    resetPageTargetsForTests();
    expect(activePageTarget()).toBeNull();
    expect(deliverFiles([pdf()], "drop")).toBe("waiting");
    // …and what waited before the reset is gone: a fallback receives only
    // the files that landed after it.
    const after = fallback();
    registerFallback(after);
    expect(after.receive).toHaveBeenCalledTimes(1);
    registerPageTarget(target());
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("routing", () => {
  it("no target: the fallback, saying there was none", () => {
    expect(routeFor([pdf()])).toEqual({
      to: "fallback",
      why: { kind: "none" },
    });
  });

  it("a target at work: the fallback, naming it", () => {
    registerPageTarget(target({ canReceive: () => false }));
    expect(routeFor([pdf()])).toEqual({
      to: "fallback",
      why: { kind: "busy", name: "Merge PDF" },
    });
  });

  it("a target that opens none of the files: the fallback, naming it", () => {
    registerPageTarget(target());
    expect(routeFor([jpg()])).toEqual({
      to: "fallback",
      why: { kind: "refused", name: "Merge PDF" },
    });
  });

  it("a target that opens one of them: the target, which says what it kept as a drop on it would", () => {
    const t = target();
    registerPageTarget(t);
    const files = [jpg(), pdf()];
    expect(routeFor(files)).toEqual({ to: "target", target: t });
    expect(deliverFiles(files, "paste")).toBe("target");
    expect(t.receive).toHaveBeenCalledWith(files, "paste");
  });

  it("a drag whose files the browser does not describe goes to the target (nothing known against it)", () => {
    const t = target();
    registerPageTarget(t);
    expect(routeFor([{ name: "", type: "" }])).toEqual({
      to: "target",
      target: t,
    });
    // …but one the browser DOES describe is judged by it.
    expect(routeFor([{ name: "", type: "image/png" }]).to).toBe("fallback");
  });

  it("deliverFiles hands the fallback the files and why they are not the target's", () => {
    const fb = fallback();
    registerFallback(fb);
    registerPageTarget(target({ canReceive: () => false }));
    const files = [pdf()];
    expect(deliverFiles(files, "drop")).toBe("fallback");
    expect(fb.receive).toHaveBeenCalledWith(files, "drop", {
      kind: "busy",
      name: "Merge PDF",
    });
  });

  it("deliverToFallback skips the target, for a surface that has already decided", () => {
    const fb = fallback();
    const t = target();
    registerFallback(fb);
    registerPageTarget(t);
    const files = [pdf()];
    expect(
      deliverToFallback(files, "drop", { kind: "refused", name: "Merge PDF" }),
    ).toBe("fallback");
    expect(t.receive).not.toHaveBeenCalled();
    expect(fb.receive).toHaveBeenCalledTimes(1);
  });

  /**
   * WAS "nothing to receive: says so" — `"nowhere"`, and the files dropped.
   * The page's fallback is the drop layer's, which arrives on idle (it is
   * kept out of every page's first load), so a file can land before it: a
   * pick on a guide's desk the moment the page paints. Now the files wait,
   * and the fallback receives them first when it registers.
   */
  it("no fallback yet: the files wait for one, and it receives them first", () => {
    const a = pdf("early.pdf");
    expect(deliverFiles([a], "drop")).toBe("waiting");
    expect(deliverToFallback([pdf("b.pdf")], "pick", { kind: "none" })).toBe(
      "waiting",
    );
    const fb = fallback();
    registerFallback(fb);
    expect(fb.receive).toHaveBeenNthCalledWith(1, [a], "drop", {
      kind: "none",
    });
    expect(fb.receive).toHaveBeenCalledTimes(2);
    // Handed over once: a second fallback does not receive them again.
    const second = fallback();
    registerFallback(second);
    expect(second.receive).not.toHaveBeenCalled();
  });

  it("an empty list goes nowhere", () => {
    const t = target();
    registerPageTarget(t);
    expect(deliverFiles([], "drop")).toBe("nowhere");
    expect(t.receive).not.toHaveBeenCalled();
  });

  it("the fallback is a stack too — never a single slot", () => {
    const one = fallback();
    const two = fallback();
    registerFallback(one);
    const offTwo = registerFallback(two);
    deliverFiles([pdf()], "drop");
    expect(two.receive).toHaveBeenCalledTimes(1);
    offTwo();
    deliverFiles([pdf()], "drop");
    expect(one.receive).toHaveBeenCalledTimes(1);
  });
});

describe("Open files", () => {
  it("opens the target's own picker when it has one and can take files", () => {
    const pick = vi.fn();
    registerFallback(fallback());
    registerPageTarget(target({ pick }));
    expect(requestFilePick()).toBe("target");
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it("a target with no picker of its own, or one at work, uses the page's", () => {
    const fb = fallback();
    registerFallback(fb);
    const off = registerPageTarget(target());
    expect(requestFilePick()).toBe("fallback");
    off();
    registerPageTarget(target({ pick: vi.fn(), canReceive: () => false }));
    expect(requestFilePick()).toBe("fallback");
    expect(fb.pick).toHaveBeenCalledTimes(2);
  });

  it("no picker anywhere: says so", () => {
    expect(requestFilePick()).toBe("nowhere");
  });
});

describe("takesByAccept — the browser's reading of `accept`, for a file that was dropped", () => {
  it("matches a type, a wildcard type and an extension, in any case", () => {
    const pdfOnly = takesByAccept("application/pdf");
    expect(pdfOnly(pdf())).toBe(true);
    expect(pdfOnly(jpg())).toBe(false);
    const images = takesByAccept("image/*");
    expect(images(jpg())).toBe(true);
    expect(images(pdf())).toBe(false);
    const byName = takesByAccept(".md, .markdown");
    expect(byName({ name: "NOTES.MD", type: "" })).toBe(true);
    expect(byName({ name: "notes.txt", type: "text/plain" })).toBe(false);
  });

  it("an empty `accept` takes anything, as the browser's picker does", () => {
    expect(takesByAccept("")(jpg())).toBe(true);
  });

  it("a file the browser gave no type is judged by its name, or let through when the accept has no names", () => {
    expect(
      takesByAccept(".pdf,application/pdf")({ name: "x.pdf", type: "" }),
    ).toBe(true);
    expect(
      takesByAccept(".pdf,application/pdf")({ name: "x.jpg", type: "" }),
    ).toBe(false);
    // Only types to go on, and no type: the target decides, as a drop on it would.
    expect(takesByAccept("application/pdf")({ name: "x.pdf", type: "" })).toBe(
      true,
    );
  });
});
