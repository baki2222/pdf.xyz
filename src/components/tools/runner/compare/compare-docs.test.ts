import { afterEach, describe, expect, it } from "vitest";
import type { ViewerPdf } from "@/lib/pdf/viewer";
import {
  acquireComparePdf,
  compareDocsOpen,
  releaseComparePdf,
} from "./compare-docs";

/**
 * The page view's two documents: one open per file, shared by every holder,
 * destroyed after the last one lets go, on the next task. Held as a table of
 * the lifetimes React gives an effect, run against the module's own seam
 * (`compareDocsOpen`), never `vi.mock`.
 */

interface Fake {
  doc: ViewerPdf;
  destroyed: number;
}

const real = compareDocsOpen.open;
let opened: Fake[] = [];
let failNext = false;

function install() {
  opened = [];
  compareDocsOpen.open = async () => {
    if (failNext) {
      failNext = false;
      throw new Error("refused");
    }
    const fake: Fake = { doc: null as unknown as ViewerPdf, destroyed: 0 };
    fake.doc = {
      numPages: 1,
      destroy: async () => {
        fake.destroyed += 1;
      },
    } as unknown as ViewerPdf;
    opened.push(fake);
    return fake.doc;
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

afterEach(() => {
  compareDocsOpen.open = real;
  failNext = false;
});

type Step = "acquire" | "release" | "acquire2" | "release2" | "tick";

interface Scenario {
  steps: Step[];
  opens: number;
  destroyed: number;
  /** Whether every acquire handed back the same document. */
  sameDoc?: boolean;
}

/** Two byte arrays: `acquire`/`release` use A, `acquire2`/`release2` use B or A. */
const SCENARIOS: Record<string, Scenario & { shared?: boolean }> = {
  "mount, then unmount": {
    steps: ["acquire", "tick", "release", "tick"],
    opens: 1,
    destroyed: 1,
  },
  "StrictMode: mount, unmount, mount in one go, then unmount": {
    steps: ["acquire", "release", "acquire", "tick", "release", "tick"],
    opens: 1,
    destroyed: 1,
    sameDoc: true,
  },
  "StrictMode, still mounted: nothing destroyed": {
    steps: ["acquire", "release", "acquire", "tick"],
    opens: 1,
    destroyed: 0,
    sameDoc: true,
  },
  "two holders: the first release keeps it": {
    steps: ["acquire", "acquire", "release", "tick"],
    opens: 1,
    destroyed: 0,
  },
  "two holders: the last release destroys it": {
    steps: ["acquire", "acquire", "release", "tick", "release", "tick"],
    opens: 1,
    destroyed: 1,
  },
  "the same bytes on both sides: one document, two holders": {
    shared: true,
    steps: ["acquire", "acquire2", "release", "tick"],
    opens: 1,
    destroyed: 0,
    sameDoc: true,
  },
  "the same bytes on both sides, both released": {
    shared: true,
    steps: ["acquire", "acquire2", "release", "release2", "tick"],
    opens: 1,
    destroyed: 1,
  },
  "two files: two documents, each released on its own": {
    steps: ["acquire", "acquire2", "release", "tick"],
    opens: 2,
    destroyed: 1,
  },
  "release, then acquire again within the timer: the same document": {
    steps: ["acquire", "tick", "release", "acquire", "tick"],
    opens: 1,
    destroyed: 0,
    sameDoc: true,
  },
  "released and destroyed, then acquired again: a fresh open": {
    steps: ["acquire", "release", "tick", "acquire", "tick"],
    opens: 2,
    destroyed: 1,
  },
  "a release with no holder does nothing": {
    steps: ["release", "acquire", "release", "release", "tick"],
    opens: 1,
    destroyed: 1,
  },
};

describe("compare-docs: one open per file, destroyed after the last holder", () => {
  it("health: the table covers StrictMode, sharing, reuse and reopen", () => {
    const names = Object.keys(SCENARIOS);
    expect(names.length).toBeGreaterThanOrEqual(8);
    expect(names.some((n) => n.startsWith("StrictMode"))).toBe(true);
    expect(Object.values(SCENARIOS).some((s) => s.shared)).toBe(true);
  });

  for (const [name, s] of Object.entries(SCENARIOS)) {
    it(name, async () => {
      install();
      const a = new Uint8Array([1]);
      const b = s.shared ? a : new Uint8Array([2]);
      const docs: Promise<ViewerPdf>[] = [];
      for (const step of s.steps) {
        if (step === "acquire") docs.push(acquireComparePdf(a));
        else if (step === "acquire2") docs.push(acquireComparePdf(b));
        else if (step === "release") releaseComparePdf(a);
        else if (step === "release2") releaseComparePdf(b);
        else await tick();
      }
      await tick();
      expect(opened.length, "opens").toBe(s.opens);
      expect(
        opened.reduce((n, f) => n + f.destroyed, 0),
        "destroyed",
      ).toBe(s.destroyed);
      if (s.sameDoc) {
        const resolved = await Promise.all(docs);
        expect(new Set(resolved).size).toBe(1);
      }
      // Leave nothing held for the next scenario.
      for (let i = 0; i < 4; i++) {
        releaseComparePdf(a);
        releaseComparePdf(b);
      }
      await tick();
    });
  }

  it("a refused open is handed to the holder, and the next acquire after release tries again", async () => {
    install();
    const a = new Uint8Array([3]);
    failNext = true;
    await expect(acquireComparePdf(a)).rejects.toThrow("refused");
    releaseComparePdf(a);
    await tick();
    await expect(acquireComparePdf(a)).resolves.toBeTruthy();
    releaseComparePdf(a);
    await tick();
    expect(opened.length).toBe(1);
  });
});
