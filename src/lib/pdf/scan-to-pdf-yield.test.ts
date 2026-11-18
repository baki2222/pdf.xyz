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

/**
 * Review of the first fix (2026-11-18): the page ran its OWN loop over
 * createScanWriter, so every test above checked a function the product no
 * longer called — five abort and yield mutants on the page's loop stayed
 * green. The page now runs scansToPdf with a `prepare` step (decode and
 * clean up one photo), so these hold the loop the page runs: one photo in
 * hand at a time, a task between preparing a page and encoding it, and a
 * Cancel heard at every step — including while the PDF is being saved, where
 * a Cancel was ignored and the result still drawn.
 */
describe("scansToPdf with prepare · the loop Scan to PDF runs", () => {
  const photos = ["a", "b", "c"];
  const byName = new Map(photos.map((name, k) => [name, inputs(3)[k]!]));
  const prepare = async (name: string) => byName.get(name)!;

  it("prepares one photo at a time, each added before the next is prepared", async () => {
    const events: string[] = [];
    const { pages } = await scansToPdf(photos, "a4", {
      prepare: async (name) => {
        events.push(`prepare ${name}`);
        return prepare(name);
      },
      onPage: (done) => events.push(`page ${done}`),
    });
    expect(pages).toHaveLength(3);
    expect(events).toEqual([
      "prepare a",
      "page 1",
      "prepare b",
      "page 2",
      "prepare c",
      "page 3",
    ]);
  });

  it("a setTimeout(0) scheduled while a photo is prepared fires before that page is encoded", async () => {
    const events: string[] = [];
    await scansToPdf(photos, "a4", {
      prepare: async (name) => {
        if (name === "a") setTimeout(() => events.push("timer"), 0);
        return prepare(name);
      },
      onPage: (done) => events.push(`page ${done}`),
    });
    // Health check: the timer did fire.
    expect(events).toContain("timer");
    expect(events.indexOf("timer")).toBeLessThan(events.indexOf("page 1"));
  });

  it("a Cancel while a photo is being prepared: that photo is not added, and no later one is prepared", async () => {
    const controller = new AbortController();
    const prepared: string[] = [];
    const added: number[] = [];
    await expect(
      scansToPdf(photos, "a4", {
        signal: controller.signal,
        prepare: async (name) => {
          prepared.push(name);
          if (name === "b") controller.abort();
          return prepare(name);
        },
        onPage: (done) => added.push(done),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(prepared).toEqual(["a", "b"]);
    expect(added).toEqual([1]);
  });

  it("a Cancel while the PDF is being saved: no result", async () => {
    const controller = new AbortController();
    let saving = 0;
    await expect(
      scansToPdf(photos, "a4", {
        signal: controller.signal,
        prepare,
        onSave: () => {
          saving += 1;
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    // Health check: the abort really landed during the save step.
    expect(saving).toBe(1);
  });

  it("a Cancel after a page is made: the next photo is not even prepared", async () => {
    const controller = new AbortController();
    const prepared: string[] = [];
    await expect(
      scansToPdf(photos, "a4", {
        signal: controller.signal,
        prepare: async (name) => {
          prepared.push(name);
          return prepare(name);
        },
        onPage: (done) => {
          if (done === 1) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(prepared).toEqual(["a"]);
  });

  it("a Cancel after the last page: the PDF is not saved at all", async () => {
    const controller = new AbortController();
    const added: number[] = [];
    let saving = 0;
    await expect(
      scansToPdf(photos, "a4", {
        signal: controller.signal,
        prepare,
        onPage: (done) => {
          added.push(done);
          if (done === 3) controller.abort();
        },
        onSave: () => (saving += 1),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(added).toEqual([1, 2, 3]);
    expect(saving).toBe(0);
  });

  it("control: untouched, it saves once and returns every page", async () => {
    let saving = 0;
    const { pages } = await scansToPdf(photos, "a4", {
      signal: new AbortController().signal,
      prepare,
      onSave: () => (saving += 1),
    });
    expect(saving).toBe(1);
    expect(pages).toHaveLength(3);
  });
});
