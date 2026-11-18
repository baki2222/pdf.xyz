import { describe, expect, it } from "vitest";
import {
  createScanWriter,
  scansToPdf,
  type ScanPageInput,
} from "./scan-to-pdf";

/**
 * Perf sweep 2026-11-18, P1 and P2 (Scan to PDF on 60 x 12 MP photos): every
 * page's encode ran in ONE main-thread task of ~20 s — the loop awaited only
 * microtasks — and nothing on the run path could be stopped. These hold the
 * writer to yielding a real TASK (a macrotask) between pages, and to stopping
 * between pages when its signal is aborted.
 */

function inputs(n: number): ScanPageInput[] {
  const w = 160;
  const h = 120;
  return Array.from({ length: n }, (_, k) => {
    const plane = new Uint8Array(w * h);
    for (let i = 0; i < plane.length; i += 1) plane[i] = (i * 7 + k * 13) & 255;
    return { enhancement: "document", plane, width: w, height: h };
  });
}

describe("scansToPdf · one task per page", () => {
  it("a setTimeout(0) scheduled after the first page fires before the second page is encoded", async () => {
    const events: string[] = [];
    const run = scansToPdf(inputs(3), "a4", {
      onPage: (done) => {
        events.push(`page ${done}`);
        if (done === 1) setTimeout(() => events.push("timer"), 0);
      },
    });
    await run;
    events.push("resolved");
    // Health check: the progress callback ran for every page (a blind
    // callback would make the order below vacuous).
    expect(events.filter((e) => e.startsWith("page"))).toEqual([
      "page 1",
      "page 2",
      "page 3",
    ]);
    expect(events.indexOf("timer")).toBeGreaterThan(-1);
    expect(events.indexOf("timer")).toBeLessThan(events.indexOf("page 2"));
    expect(events.indexOf("timer")).toBeLessThan(events.indexOf("resolved"));
  });

  it("stops between pages when its signal is aborted: no later page is made", async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    await expect(
      scansToPdf(inputs(3), "a4", {
        signal: controller.signal,
        onPage: (done) => {
          seen.push(done);
          if (done === 1) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual([1]);
  });

  it("control: an untouched signal makes every page", async () => {
    const controller = new AbortController();
    const { pages } = await scansToPdf(inputs(3), "a4", {
      signal: controller.signal,
    });
    expect(pages).toHaveLength(3);
  });

  it("the page-at-a-time writer makes the same PDF pages as scansToPdf", async () => {
    const writer = await createScanWriter("letter");
    for (const input of inputs(2)) await writer.addPage(input);
    const built = await writer.save();
    const whole = await scansToPdf(inputs(2), "letter");
    expect(built.pages).toEqual(whole.pages);
  });

  it("the writer refuses to save an empty scan", async () => {
    const writer = await createScanWriter("a4");
    await expect(writer.save()).rejects.toThrow(/at least one photo/);
  });
});
