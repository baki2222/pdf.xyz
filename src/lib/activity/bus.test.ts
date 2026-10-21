// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentActivity,
  reportActivity,
  resetActivityForTests,
  subscribeActivity,
  type Activity,
} from "./bus";

afterEach(() => {
  resetActivityForTests();
  vi.restoreAllMocks();
});

const clock = (...times: number[]) => {
  const spy = vi.spyOn(performance, "now");
  for (const t of times) spy.mockReturnValueOnce(t);
  return spy;
};

describe("the activity bus", () => {
  it("starts idle, and tells its listeners every change with when it began", () => {
    expect(currentActivity().state).toBe("idle");
    const seen: Activity[] = [];
    const off = subscribeActivity((a) => seen.push(a));
    clock(100, 3400);
    reportActivity("busy");
    reportActivity("done");
    off();
    reportActivity("busy");
    expect(seen.map((a) => a.state)).toEqual(["busy", "done"]);
    expect(seen[0]!.since).toBe(100);
    // A run's end carries how long it ran: the tab signal's threshold.
    expect(seen[1]).toMatchObject({ state: "done", since: 3400, ranMs: 3300 });
  });

  it("a drag, or its end, never hides a run in progress", () => {
    reportActivity("busy");
    reportActivity("drag");
    reportActivity("idle");
    expect(currentActivity().state).toBe("busy");
  });

  it("a second busy keeps the first start, and an end without a run says nothing", () => {
    clock(10, 50, 90);
    reportActivity("busy");
    reportActivity("busy");
    expect(currentActivity().since).toBe(10);
    reportActivity("failed");
    expect(currentActivity()).toMatchObject({ state: "failed", ranMs: 80 });
    const seen: string[] = [];
    subscribeActivity((a) => seen.push(a.state));
    reportActivity("done"); // no run is in progress: not news
    expect(seen).toEqual([]);
    expect(currentActivity().state).toBe("failed");
  });

  it("a drag over an idle page is reported, and so is its end", () => {
    const seen: string[] = [];
    subscribeActivity((a) => seen.push(a.state));
    reportActivity("drag");
    reportActivity("idle");
    reportActivity("idle"); // unchanged: not news
    expect(seen).toEqual(["drag", "idle"]);
  });
});
