// @vitest-environment jsdom
// @native-canvas
/**
 * Audits extract-pages#4 and remove-pages#2 (2026-11-07): Extract Pages and
 * Delete Pages offered only Select all, Clear and Invert, so pulling the
 * fronts out of a duplex scan, or dropping its blank backs, meant typing
 * "1, 3, 5, …" by hand — the Delete Pages FAQ said exactly that. Rotate PDF
 * already had "Odd pages" / "Even pages" from the shared selection helpers.
 *
 * Driven the way a visitor drives it: ToolRunner for the kind the registry
 * assigns each slug, a real File, the chip, the action, Download PDF, and
 * the Blob the browser is handed. Each page of the fixture has its own
 * width, so the output says WHICH pages survived, not only how many.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { getRunnerKind } from "@/lib/pdf/registry";
import { withAppRouter } from "@/tests/app-router";
import { runnerMounted } from "@/tests/runner-mounted";
import { ToolRunner } from "./tool-runner";

let downloads: Blob[] = [];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  downloads = [];
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) downloads.push(obj);
    return `blob:page-select-odd-even/${downloads.length}`;
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

/** Page n (1-based) is 100 + n points wide, so a width names its page. */
async function pagesPdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= count; n++) doc.addPage([100 + n, 200]);
  return doc.save();
}

async function pagesIn(blob: Blob): Promise<number[]> {
  const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
  return doc.getPages().map((p) => Math.round(p.getWidth()) - 100);
}

/** Mounts the runner for `slug` and loads a `count`-page PDF into it. */
async function mountWith(
  slug: "extract-pages" | "remove-pages",
  count: number,
): Promise<void> {
  const kind = getRunnerKind(slug);
  expect(kind, `the registry no longer maps ${slug}`).toBeTruthy();
  const { container } = render(
    withAppRouter(<ToolRunner kind={kind!} slug={slug} />),
  );
  await runnerMounted(container);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the dropzone file input").not.toBeNull();
  fireEvent.change(input!, {
    target: {
      files: [
        new File([(await pagesPdf(count)).slice()], "scan.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  // Health: the editor is up (its oldest chip is there), so a missing chip
  // below is a missing chip, not a page that never loaded.
  await screen.findByRole(
    "button",
    { name: /^select all$/i },
    { timeout: 10_000 },
  );
}

async function runWith(
  slug: "extract-pages" | "remove-pages",
  chip: RegExp,
  action: RegExp,
  count = 5,
): Promise<number[]> {
  await mountWith(slug, count);
  fireEvent.click(screen.getByRole("button", { name: chip }));
  const go = screen.getByRole("button", { name: action });
  await waitFor(() => expect(go).toBeEnabled());
  fireEvent.click(go);
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: /^download pdf$/i },
      { timeout: 10_000 },
    ),
  );
  expect(downloads, "the Download button handed over no Blob").toHaveLength(1);
  return pagesIn(downloads[0]!);
}

describe("Extract Pages and Delete Pages · Odd pages / Even pages", () => {
  it("the fixture names its pages (health)", async () => {
    expect(await pagesIn(new Blob([(await pagesPdf(5)).slice()]))).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("Extract · Odd pages pulls out pages 1, 3 and 5", async () => {
    expect(
      await runWith("extract-pages", /^odd pages$/i, /^extract 3 pages$/i),
    ).toEqual([1, 3, 5]);
  }, 30_000);

  it("Extract · Even pages pulls out pages 2 and 4", async () => {
    expect(
      await runWith("extract-pages", /^even pages$/i, /^extract 2 pages$/i),
    ).toEqual([2, 4]);
  }, 30_000);

  it("Delete · Even pages removes the backs, leaving 1, 3 and 5", async () => {
    expect(
      await runWith("remove-pages", /^even pages$/i, /^delete 2 pages$/i),
    ).toEqual([1, 3, 5]);
  }, 30_000);

  // Review of 84df0961: nothing held the one-page case, and deleting the
  // disabled state left every test green.
  it.each(["extract-pages", "remove-pages"] as const)(
    "%s · on a one-page PDF, Even pages is disabled and Odd pages is not",
    async (slug) => {
      await mountWith(slug, 1);
      expect(
        screen.getByRole("button", { name: /^even pages$/i }),
      ).toHaveAttribute("aria-disabled", "true");
      expect(
        screen.getByRole("button", { name: /^odd pages$/i }),
      ).not.toHaveAttribute("aria-disabled");
    },
    30_000,
  );

  it("Delete · Odd pages removes 1, 3 and 5, leaving 2 and 4", async () => {
    expect(
      await runWith("remove-pages", /^odd pages$/i, /^delete 3 pages$/i),
    ).toEqual([2, 4]);
  }, 30_000);
});
