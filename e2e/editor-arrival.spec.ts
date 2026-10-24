import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { recordedShifts, startFrames, stopFrames, type Shift } from "./frames";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { getRunnerKind, supportedToolSlugs } from "../src/lib/pdf/registry";

/**
 * THE EDITOR AS A FILE ARRIVES (2026-10-20). A file dropped on the page or
 * pasted into it opens no input window, so whatever the editor moves while
 * it opens — a page preview drawn at a size its placeholder did not hold, a
 * toolbar arriving late above it — is counted CLS, on a page the reader is
 * already looking at.
 *
 * Measured by two reviews on 2026-10-17, and REPORTED by the batch C matrix
 * (`continue-chain.spec.ts`'s "inside the editor as it opened" annotation)
 * without being bounded: Edit, Annotate and Redact PDF 0.13–0.16 at 360 and
 * 390 px, Merge PDF 0.012–0.045. Here it is bounded: the SUM of every
 * layout shift outside an input's window, from the drop (or paste) until
 * the editor has been still for {@link QUIET_MS}, is at most a tenth of
 * Google's "good" line — whatever moved.
 *
 * The file goes in through the page's own drop and paste paths
 * (`drop-anywhere.spec.ts`'s synthetic `DataTransfer`: a real browser
 * object, dispatched on the tool's heading or the body), never through the
 * file input — a pick through the system dialog is forgiven by its input
 * window and would measure nothing.
 *
 * Health, per row: the instrument saw a shift of its own making at this
 * size (a sum of nothing is the strongest possible pass), and the editor
 * opened with THIS file in it.
 *
 * The editors are DERIVED (2026-10-20, after Crop PDF was found drawing the
 * same pulsing box #184 removed from three others): every runner the
 * dispatcher mounts whose source draws a page-preview placeholder — the
 * shared `<PagePreviewPlaceholder` or a `bg-wash aspect-[…]` page box of its
 * own — through `tool-runner.tsx`'s `case "kind": return <X />` and
 * `X = dynamic(() => import("./file"))`, then every slug the registry gives
 * that kind. Merge PDF draws neither and stays because a review named it.
 * Every other runner's arrival is reported by `continue-chain.spec.ts`.
 *
 * Crop PDF measured 0.0000 here in all six cells WITH its pulsing box, so
 * this bound cannot see that box; {@link PULSING_BOX} is what holds it out.
 */

const RUNNER_DIR = join(process.cwd(), "src/components/tools/runner");

/** A page-preview placeholder, either shape: the shared one, or a page box. */
const PLACEHOLDER = [
  /<PagePreviewPlaceholder[\s/>]/,
  /className=(?="(?:[^"]* )?bg-wash )(?="(?:[^"]* )?aspect-\[)"[^"]*"/,
] as const;

/** The box #184 removed: a page-shaped placeholder that pulses. */
const PULSING_BOX =
  /className=(?="(?:[^"]* )?aspect-\[)(?="(?:[^"]* )?animate-pulse[" ])"[^"]*"/g;

/** Positive controls: the boxes as they shipped, before #184 and this fix. */
const SHIPPED_PULSING_BOXES = [
  // crop-runner.tsx, until 2026-10-20
  `<div className="bg-wash aspect-[3/4] w-full max-w-[200px] animate-pulse rounded-lg" />`,
];

/**
 * A runner's source: its module, plus the modules it imports from a
 * SUBDIRECTORY of the runner directory (`./editor/…`) — a runner split into
 * components of its own — and, inside that subdirectory, what those import
 * in turn. Edit PDF became `edit-runner.tsx` → `./editor/…` on 2026-10-24
 * and its placeholder moved with the editor; the same day Edit, Annotate and
 * Sign PDF all became `<EditorRunner>` (`./editor/editor-session`, which
 * loads `./wysiwyg-editor`: two hops). Reading the runner file alone dropped
 * them from this list. Shared siblings (`./runner-kit`) are not followed,
 * the walk never leaves the subdirectory, and a broken link is fatal.
 */
function runnerSource(file: string): string {
  const read = (rel: string) => {
    for (const ext of [".tsx", ".ts"]) {
      try {
        return readFileSync(join(RUNNER_DIR, `${rel}${ext}`), "utf8");
      } catch {
        // try the next extension
      }
    }
    throw new Error(`${file}.tsx reaches ./${rel}, which is no file`);
  };
  const src = read(file);
  const specs = (text: string, pattern: RegExp) =>
    [...text.matchAll(pattern)].map(([, spec]) => spec!);
  const seen = new Set(
    specs(src, /(?:from |import\(\s*)"\.\/([\w-]+\/[\w/-]+)"/g),
  );
  const queue = [...seen];
  const texts = [src];
  while (queue.length > 0) {
    const rel = queue.shift()!;
    const text = read(rel);
    texts.push(text);
    const dir = rel.slice(0, rel.lastIndexOf("/"));
    for (const spec of specs(text, /(?:from |import\(\s*)"\.\/([\w-]+)"/g)) {
      const next = `${dir}/${spec}`;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return texts.join("\n");
}

function placeholderEditors(): string[] {
  const dispatcher = readFileSync(join(RUNNER_DIR, "tool-runner.tsx"), "utf8");
  const fileOf = new Map(
    [
      ...dispatcher.matchAll(
        /const (\w+) = dynamic\(\(\) =>\s*import\("\.\/([\w-]+)"\)/g,
      ),
    ].map(([, name, file]) => [name!, file!]),
  );
  const kinds = [
    ...dispatcher.matchAll(/case "([\w-]+)":\s*return <(\w+)/g),
  ].map(([, kind, name]) => ({ kind: kind!, file: fileOf.get(name!) }));
  if (fileOf.size < 20 || kinds.length < 20 || kinds.some((k) => !k.file))
    throw new Error(
      `tool-runner.tsx parsed implausibly: ${fileOf.size} loaders, ${kinds.length} cases`,
    );
  const drawing = new Set(
    kinds
      .filter(({ file }) => {
        const src = runnerSource(file!);
        return PLACEHOLDER.some((re) => re.test(src));
      })
      .map(({ kind }) => kind),
  );
  return supportedToolSlugs.filter((slug) => drawing.has(getRunnerKind(slug)!));
}

const DERIVED = placeholderEditors();
/** Pages per file, where one is not enough to exercise the editor. */
const PAGES: Record<string, number> = { "redact-pdf": 2, "merge-pdf": 3 };
const EDITORS = [...new Set([...DERIVED, "merge-pdf"])].map((slug) => ({
  slug,
  pages: PAGES[slug] ?? 1,
}));

test("the editor list is derived, and plausibly sized", () => {
  // Edit, Annotate, Redact and Crop on 2026-10-20: fewer is a broken parse.
  expect(DERIVED.length, DERIVED.join(", ")).toBeGreaterThanOrEqual(4);
  expect(DERIVED, DERIVED.join(", ")).toEqual(
    expect.arrayContaining([
      "edit-pdf",
      "annotate-pdf",
      "redact-pdf",
      "crop-pdf",
      // Since 2026-10-24: Sign PDF opens the shared editor.
      "sign-pdf",
    ]),
  );
});

test("no editor draws a pulsing page box", () => {
  for (const box of SHIPPED_PULSING_BOXES)
    expect(box.match(PULSING_BOX), "the ban misses a shipped box").toHaveLength(
      1,
    );
  const files = readdirSync(RUNNER_DIR).filter((f) => f.endsWith(".tsx"));
  expect(files.length, "the runner directory read implausibly").toBeGreaterThan(
    30,
  );
  const found = files.flatMap((f) =>
    [...readFileSync(join(RUNNER_DIR, f), "utf8").matchAll(PULSING_BOX)].map(
      ([box]) => `${f}: ${box}`,
    ),
  );
  expect(found, found.join("\n")).toEqual([]);
});

/** Two phones the reviews measured, and one desktop. */
const SCREENS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
] as const;

const ARRIVALS = ["drop", "paste"] as const;
type Arrival = (typeof ARRIVALS)[number];

/** A tenth of Google's 0.1. */
const MAX_CLS = 0.01;
/** The editor is settled once nothing has shifted for this long. */
const QUIET_MS = 1500;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

/** US Letter, portrait, with a line of text on each page. */
async function letterPdf(label: string, pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++)
    doc
      .addPage([612, 792])
      .drawText(`${label} — page ${i + 1}`, { x: 72, y: 700, size: 18, font });
  return Buffer.from(await doc.save()).toString("base64");
}

/** The same shift the page-CLS specs make: proof the observer is live here. */
async function shiftOfOurOwn(page: Page): Promise<number> {
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

/** A file delivered the way a drop or a paste delivers one: no input window. */
async function deliver(page: Page, how: Arrival, name: string, b64: string) {
  const dt = await page.evaluateHandle(
    ({ name, b64 }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: "application/pdf" }));
      return dt;
    },
    { name, b64 },
  );
  if (how === "drop") {
    const heading = page.locator("main h1").first();
    await heading.dispatchEvent("dragenter", { dataTransfer: dt });
    await heading.dispatchEvent("dragover", { dataTransfer: dt });
    await heading.dispatchEvent("drop", { dataTransfer: dt });
  } else {
    await page.evaluate((clipboardData) => {
      document.body.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, dt);
  }
}

/** Resolves once no shift has been recorded for {@link QUIET_MS}. */
async function settled(page: Page) {
  await page.waitForFunction(
    (quiet) => {
      const w = window as unknown as {
        __shifts: { t: number }[];
        __quietFrom?: number;
      };
      const last = w.__shifts.at(-1)?.t ?? 0;
      return performance.now() - Math.max(last, w.__quietFrom ?? 0) >= quiet;
    },
    QUIET_MS,
    { polling: 100, timeout: 20_000 },
  );
}

async function arrive(
  page: Page,
  slug: string,
  pages: number,
  screen: (typeof SCREENS)[number],
  how: Arrival,
) {
  await page.setViewportSize(screen);
  await page.goto(`/tools/${slug}`);
  await waitForHydration(fileInput(page));
  await page
    .locator("html[data-drop-layer]")
    .waitFor({ state: "attached", timeout: 5000 });
  await page.evaluate(() => document.fonts.ready);
  await startFrames(page, { tops: {}, present: {} });
  const ownAt = await shiftOfOurOwn(page);
  const name = `arrival-${slug}.pdf`;
  const b64 = await letterPdf(name, pages);
  const arrivedAt = await page.evaluate(() => {
    (window as unknown as { __quietFrom: number }).__quietFrom =
      performance.now();
    return performance.now();
  });
  await deliver(page, how, name, b64);
  await expect(
    page.locator("main").getByText(name, { exact: true }).first(),
    "the editor did not open with the file",
  ).toBeVisible({ timeout: 15_000 });
  await settled(page);
  const shifts = await recordedShifts(page);
  await stopFrames(page);
  const counted = shifts.filter((s) => !s.input && s.t >= arrivedAt);
  return {
    own: shifts.filter((s) => s.t >= ownAt && s.t < arrivedAt),
    counted,
    cls: counted.reduce((sum, s) => sum + s.value, 0),
    listed: (list: readonly Shift[]) =>
      list
        .map(
          (s) =>
            `${s.value.toFixed(4)} @${Math.round(s.t - arrivedAt)}ms [${s.sources.join(" | ")}]`,
        )
        .join("\n") || "none",
  };
}

test.describe("the editor as a file arrives", () => {
  for (const { slug, pages } of EDITORS)
    for (const screen of SCREENS)
      for (const how of ARRIVALS)
        test(`${slug} at ${screen.width} x ${screen.height}, by ${how}: CLS ≤ ${MAX_CLS} until the editor is still`, async ({
          page,
        }, testInfo) => {
          test.setTimeout(60_000);
          const m = await arrive(page, slug, pages, screen, how);
          testInfo.annotations.push({
            type: "cls",
            description: m.cls.toFixed(4),
          });
          expect(
            m.own.length,
            "the instrument saw no shift of its own making",
          ).toBeGreaterThan(0);
          expect(
            m.cls,
            `${slug} at ${screen.width} x ${screen.height}, by ${how}: CLS ${m.cls.toFixed(4)} over ${m.counted.length} shift(s):\n${m.listed(m.counted)}`,
          ).toBeLessThanOrEqual(MAX_CLS);
        });
});
