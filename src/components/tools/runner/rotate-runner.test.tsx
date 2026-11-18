// @vitest-environment jsdom
// @native-canvas
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { getRunnerKind } from "@/lib/pdf/registry";
import {
  lostStructure,
  makeStructuredPdf,
  readDocumentStructure,
} from "@/tests/fixtures-structured-pdf";
import { ToolRunner } from "./tool-runner";
import { PageTile } from "./page-tile";
import { runnerMounted } from "@/tests/runner-mounted";

/**
 * The rotate tool, driven the way a visitor drives it, with the verdict read
 * off the bytes the Download button hands the browser.
 *
 * WHY THIS IS A RUNNER TEST AND NOT (ONLY) AN ENGINE TEST: the engine always
 * had an in-place `rotatePages` that kept everything, with a passing test. The
 * tool never called it. The runner rebuilt the document through
 * `organizePages`, so every bookmark, form field, title, page label and
 * language tag was deleted from every file rotated — while the engine's own
 * suite was green. A proof of the function the author meant to call certifies
 * nothing about the function the button calls. This one goes through the
 * button: `ToolRunner` (the component the tool page mounts) for the kind the
 * registry assigns `rotate-pdf`, a real `File` through the dropzone input,
 * "Right", "Apply rotation", "Download rotated PDF", and the Blob that reaches
 * `URL.createObjectURL`.
 *
 * No `vi.mock`: the suite shares one module cache (`isolate: false`), and a
 * module evaluated under a mock stays bound to the stub for every later file.
 * The two browser seams are stubbed on the globals instead and restored.
 */

const SLUG = "rotate-pdf";

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

function Router({ children }: { children: ReactNode }) {
  return (
    <AppRouterContext.Provider value={router as never}>
      {children}
    </AppRouterContext.Provider>
  );
}

let downloads: Blob[] = [];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  downloads = [];
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) downloads.push(obj);
    return `blob:rotate-runner-test/${downloads.length}`;
  };
  URL.revokeObjectURL = () => {};
  // jsdom logs "not implemented: navigation" for an anchor click; the Blob
  // has already been captured by then, which is all this test reads.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Upload `bytes`, press each named button in order (default: one "Right",
 * which turns every page because every page starts selected), apply, and
 * download.
 */
async function rotateThroughTheUi(
  bytes: Uint8Array,
  presses: RegExp[] = [/^right$/i],
): Promise<Uint8Array> {
  const kind = getRunnerKind(SLUG);
  expect(kind, `the registry no longer maps ${SLUG} to a runner`).toBe(
    "rotate",
  );
  const { container } = render(
    <Router>
      <ToolRunner kind={kind!} slug={SLUG} />
    </Router>,
  );
  await runnerMounted(container);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the dropzone file input").not.toBeNull();
  const file = new File([bytes.slice()], "report.pdf", {
    type: "application/pdf",
  });
  fireEvent.change(input!, { target: { files: [file] } });

  await screen.findByRole("button", { name: /^right$/i });
  for (const name of presses) {
    fireEvent.click(screen.getByRole("button", { name }));
  }
  const apply = screen.getByRole("button", { name: /apply rotation/i });
  await waitFor(() => expect(apply).toBeEnabled());
  fireEvent.click(apply);

  const download = await screen.findByRole(
    "button",
    { name: /download rotated pdf/i },
    { timeout: 10_000 },
  );
  fireEvent.click(download);
  expect(
    downloads,
    "the Download button handed the browser no Blob",
  ).toHaveLength(1);
  return blobBytes(downloads[0]!);
}

/**
 * The REBUILD these positive controls are about, reconstructed here: a fresh
 * document with the pages `copyPages`d in and turned — what `organizePages`
 * shipped until wave1/l01-page-leak rebuilt it on the clean page assembler
 * (`./page-copy`), which now carries the catalog, the form and the metadata
 * across. The control used to CALL `organizePages` for this, and so pinned
 * that defect; after the merge it certified nothing (the predicate found
 * nothing to lose). Built with pdf-lib directly, in a test file, which the
 * no-direct-copyPages guard does not walk.
 */
async function bareRebuild(
  bytes: Uint8Array,
  plan: { sourceIndex: number; rotation: number }[],
): Promise<Uint8Array> {
  const { PDFDocument: Doc, degrees } = await import("pdf-lib");
  const src = await Doc.load(bytes);
  const out = await Doc.create();
  const pages = await out.copyPages(
    src,
    plan.map((item) => item.sourceIndex),
  );
  pages.forEach((page, i) => {
    page.setRotation(degrees(plan[i]!.rotation));
    out.addPage(page);
  });
  return out.save();
}

describe("rotate-pdf: what the downloaded file still carries", () => {
  it("rotates every page and keeps every document-level member of the input", async () => {
    const input = await makeStructuredPdf(3);
    const before = await readDocumentStructure(input);
    // Health check: the input carries structure to lose. An empty walk would
    // make `lostStructure` vacuously clean.
    expect(before.catalog.size).toBeGreaterThanOrEqual(6);
    expect(before.info.size).toBeGreaterThanOrEqual(4);
    expect(before.fields.size).toBe(1);

    const after = await readDocumentStructure(await rotateThroughTheUi(input));

    expect(after.rotations).toEqual([90, 90, 90]);
    expect(lostStructure(before, after)).toEqual([]);
  }, 30_000);

  it("Odd pages + Right turns pages 1 and 3 only, and Even pages + Left pages 2 and 4 only", async () => {
    const input = await makeStructuredPdf(4);
    const before = await readDocumentStructure(input);
    // Health check: the fixture starts upright, so any turn is the tool's.
    expect(before.rotations).toEqual([0, 0, 0, 0]);

    const odd = await readDocumentStructure(
      await rotateThroughTheUi(input, [/^odd pages$/i, /^right$/i]),
    );
    expect(odd.rotations).toEqual([90, 0, 90, 0]);
    cleanup();
    downloads = [];

    const even = await readDocumentStructure(
      await rotateThroughTheUi(input, [/^even pages$/i, /^left$/i]),
    );
    expect(even.rotations).toEqual([0, 270, 0, 270]);
    expect(lostStructure(before, even)).toEqual([]);
  }, 30_000);

  it("Rotate all 180° turns every page whatever is selected", async () => {
    const input = await makeStructuredPdf(4);
    // "Odd pages" first, so a 180° that obeyed the selection would leave
    // pages 2 and 4 upright — the press must ignore it, as its name says.
    const after = await readDocumentStructure(
      await rotateThroughTheUi(input, [/^odd pages$/i, /^rotate all 180°$/i]),
    );
    expect(after.rotations).toEqual([180, 180, 180, 180]);
  }, 30_000);

  it("POSITIVE CONTROL: the rebuild the tool used to ship fails the same predicate", async () => {
    // The rebuild the runner shipped before this fix, on the same fixture.
    // Same rotations as the true artifact, so the predicate is the only thing
    // that can tell them apart — and it must. (It called `organizePages`
    // until wave1/l01-page-leak made that keep the structure too; see
    // `bareRebuild`.)
    const input = await makeStructuredPdf(3);
    const before = await readDocumentStructure(input);
    const rebuilt = await bareRebuild(
      input,
      before.rotations.map((_, i) => ({ sourceIndex: i, rotation: 90 })),
    );
    const after = await readDocumentStructure(rebuilt);
    expect(after.rotations).toEqual([90, 90, 90]);
    expect(lostStructure(before, after).length).toBeGreaterThan(0);
  });
});

/**
 * Press a key on `el` the way a browser does for a native `<button>`: Enter
 * clicks on keydown, Space clicks on keyup, and either click is skipped when
 * the keydown was cancelled. jsdom has no activation behaviour of its own, so
 * without this a keyboard test of a button proves nothing in either
 * direction. The cancelled-keydown branch is the one the defect lived in: a
 * selectable tile cancels Enter/Space for its OWN activation, and a button
 * inside it lost its click to that.
 */
function pressLikeABrowser(el: HTMLElement, key: "Enter" | " ") {
  el.focus();
  const proceed = fireEvent.keyDown(el, { key });
  if (key === " ") {
    const up = fireEvent.keyUp(el, { key });
    if (proceed && up) fireEvent.click(el);
  } else if (proceed) {
    fireEvent.click(el);
  }
}

async function mountWithPdf(pages: number): Promise<HTMLElement> {
  const { container } = render(
    <Router>
      <ToolRunner kind={getRunnerKind(SLUG)!} slug={SLUG} />
    </Router>,
  );
  await runnerMounted(container);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the dropzone file input").not.toBeNull();
  const bytes = await makeStructuredPdf(pages);
  fireEvent.change(input!, {
    target: {
      files: [
        new File([bytes.slice()], "report.pdf", { type: "application/pdf" }),
      ],
    },
  });
  await screen.findByRole("button", { name: `Rotate page ${pages} right` });
  return container;
}

/** A page's selectable tile: role=button, named "Page N" exactly. */
function tile(n: number): HTMLElement {
  return screen.getByRole("button", { name: `Page ${n}` });
}

/** The rotation badge a tile draws beside its label, or null when upright. */
function badge(el: HTMLElement): string | null {
  return (
    Array.from(el.querySelectorAll("span")).find((s) =>
      /^\d+\u00b0$/.test(s.textContent ?? ""),
    )?.textContent ?? null
  );
}

describe("rotate-pdf: a page's own rotate buttons work from the keyboard", () => {
  // Found by the 2026-11-18 after-upload axe sweep on production
  // (nested-interactive): the per-page Left/Right buttons sat INSIDE the
  // selectable tile, itself a role=button. The tile cancels Enter and Space
  // to toggle its selection, so a keyboard user pressing "Rotate page 1
  // right" deselected page 1 and rotated nothing.

  it("no button sits inside another (role=button tiles hold no button)", async () => {
    const container = await mountWithPdf(2);
    const tiles = Array.from(
      container.querySelectorAll<HTMLElement>('[role="button"]'),
    );
    // Health check: the tiles were found, so an empty walk cannot pass.
    expect(tiles.length).toBeGreaterThanOrEqual(2);
    const nested = tiles
      .filter((t) => t.querySelector('button, [role="button"]'))
      .map((t) => t.getAttribute("aria-label"));
    expect(nested).toEqual([]);
  }, 30_000);

  it("Enter on 'Rotate page 1 right' turns page 1 and leaves its selection alone", async () => {
    await mountWithPdf(2);
    // Every page starts selected; the press must not change that.
    expect(tile(1).getAttribute("aria-pressed")).toBe("true");
    expect(badge(tile(1))).toBeNull();

    pressLikeABrowser(
      screen.getByRole("button", { name: "Rotate page 1 right" }),
      "Enter",
    );

    expect(badge(tile(1))).toBe("90\u00b0");
    expect(tile(1).getAttribute("aria-pressed")).toBe("true");
    expect(badge(tile(2))).toBeNull();
  }, 30_000);

  it("Space on 'Rotate page 2 left' turns page 2 and leaves its selection alone", async () => {
    await mountWithPdf(2);
    expect(tile(2).getAttribute("aria-pressed")).toBe("true");

    pressLikeABrowser(
      screen.getByRole("button", { name: "Rotate page 2 left" }),
      " ",
    );

    expect(badge(tile(2))).toBe("270\u00b0");
    expect(tile(2).getAttribute("aria-pressed")).toBe("true");
    expect(badge(tile(1))).toBeNull();
  }, 30_000);

  it("a click still rotates, and the tile itself still selects by click and by Enter", async () => {
    await mountWithPdf(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate page 1 right" }),
    );
    expect(badge(tile(1))).toBe("90\u00b0");
    expect(tile(1).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(tile(1));
    expect(tile(1).getAttribute("aria-pressed")).toBe("false");
    pressLikeABrowser(tile(1), "Enter");
    expect(tile(1).getAttribute("aria-pressed")).toBe("true");
    pressLikeABrowser(tile(2), " ");
    expect(tile(2).getAttribute("aria-pressed")).toBe("false");
    // Selecting never turned a page.
    expect(badge(tile(1))).toBe("90\u00b0");
    expect(badge(tile(2))).toBeNull();
  }, 30_000);

  it("PageTile's props refuse actions on a selectable tile (a type check, run by tsc)", () => {
    // A selectable tile IS a button, so anything passed as `actions` would be
    // a control inside a control. This line must not compile; tsc reports an
    // unused directive the day it does.
    // @ts-expect-error -- `selectable` and `actions` are mutually exclusive
    const nestedTile = <PageTile label="Page 1" selectable actions={<b />} />;
    // ...while actions on a tile that is not a button stay allowed.
    const plainTile = <PageTile label="Page 1" actions={<b />} />;
    expect(nestedTile.props).toHaveProperty("actions");
    expect(plainTile.props).toHaveProperty("actions");
  });
});
