// @vitest-environment jsdom
// @native-canvas
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument } from "pdf-lib";
import { getRunnerKind } from "@/lib/pdf/registry";
import { PDF_NEEDS_PASSWORD_MESSAGE } from "@/lib/pdf/encryption";
import { getToolBySlug } from "@/lib/tools";
import { pageFaq } from "@/lib/tools/page-copy";
import {
  FIXTURE_OPEN_PASSWORD,
  OPEN_PASSWORD_FIXTURE,
  OPEN_PASSWORD_RESTRICTED_FIXTURE,
  RESTRICTED_FIXTURES,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { ToolRunner } from "./tool-runner";
import { runnerMounted } from "@/tests/runner-mounted";
import {
  GRAYSCALE_OPENED_NOTE,
  GRAYSCALE_PASSWORD_HINT,
  GRAYSCALE_PASSWORD_LABEL,
  GRAYSCALE_WRONG_PASSWORD,
} from "./grayscale-password";

/**
 * Grayscale PDF with an encrypted file (audit grayscale-pdf#6): the password
 * typed into the panel, checked in the browser, and the job finished on the
 * device — instead of a trip through the server's Unlock PDF and back.
 *
 * Until 2026-11-08 every encrypted file was refused with no way forward on
 * the page. The copy is a NEW, unencrypted file, so the password must
 * entitle the person to that: the owner password always does; the open
 * password does only when the author withholds nothing.
 *
 * Driven through the page's own runner, with the Blob the Download button
 * hands the browser read back by pdf-lib — which refuses any encrypted file,
 * so a successful load IS the proof the copy has no encryption. Setup as in
 * `grayscale-runner.test.tsx` (pdf.js on the main thread, a native canvas).
 */

const SLUG = "grayscale-pdf";
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

const requireHere = createRequire(import.meta.url);
const napi = createRequire(requireHere.resolve("pdfjs-dist/package.json"))(
  "@napi-rs/canvas",
) as { createCanvas(width: number, height: number): HTMLCanvasElement };

let downloads: Blob[] = [];
let canvasesMade = 0;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(async () => {
  downloads = [];
  canvasesMade = 0;
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) downloads.push(obj);
    return `blob:grayscale-password-test/${downloads.length}`;
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker: unknown = await import(
    // @ts-expect-error -- pdfjs-dist ships no type declarations for its worker.
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  vi.stubGlobal("pdfjsWorker", worker);
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((
    tag: string,
    options?: ElementCreationOptions,
  ) => {
    if (tag.toLowerCase() !== "canvas") return createElement(tag, options);
    canvasesMade++;
    return napi.createCanvas(1, 1);
  }) as typeof document.createElement);
});

afterEach(() => {
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function drop(fixture: string) {
  const kind = getRunnerKind(SLUG);
  expect(kind).toBe("grayscale");
  const { container } = render(
    <Router>
      <ToolRunner kind={kind!} slug={SLUG} />
    </Router>,
  );
  await runnerMounted(container);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  fireEvent.change(input!, {
    target: {
      files: [
        new File([readRestrictedFixture(fixture).slice()], "locked.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  return screen.findByLabelText(GRAYSCALE_PASSWORD_LABEL, undefined, {
    timeout: 10_000,
  });
}

async function typePassword(field: HTMLElement, password: string) {
  fireEvent.change(field, { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /open with password/i }));
}

async function convert(): Promise<Uint8Array> {
  const run = await screen.findByRole(
    "button",
    { name: /convert to grayscale/i },
    { timeout: 10_000 },
  );
  await waitFor(() => expect(run).toBeEnabled());
  fireEvent.click(run);
  const download = await screen.findByRole(
    "button",
    { name: /download grayscale pdf/i },
    { timeout: 20_000 },
  );
  fireEvent.click(download);
  expect(downloads).toHaveLength(1);
  return new Uint8Array(await downloads[0]!.arrayBuffer());
}

describe("grayscale-pdf: the password typed in the panel", () => {
  it("the open password of a file that withholds nothing: converted on the device, unencrypted", async () => {
    const field = await drop(OPEN_PASSWORD_FIXTURE.file);
    expect(screen.getByText(PDF_NEEDS_PASSWORD_MESSAGE)).toBeTruthy();
    expect(screen.getByText(GRAYSCALE_PASSWORD_HINT)).toBeTruthy();

    await typePassword(field, "not-the-password");
    await screen.findByText(GRAYSCALE_WRONG_PASSWORD, undefined, {
      timeout: 10_000,
    });

    await typePassword(field, FIXTURE_OPEN_PASSWORD);
    await screen.findByText(GRAYSCALE_OPENED_NOTE, undefined, {
      timeout: 10_000,
    });
    const out = await convert();
    // pdf-lib refuses any /Encrypt: loading it proves the copy has none.
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(OPEN_PASSWORD_FIXTURE.pageCount);
    expect(canvasesMade).toBeGreaterThan(0);
  }, 60_000);

  it("the open password of a file whose author restricts it: refused with the reason; the owner password converts", async () => {
    const field = await drop(OPEN_PASSWORD_RESTRICTED_FIXTURE.file);
    await typePassword(field, FIXTURE_OPEN_PASSWORD);
    await screen.findByText(/doesn't allow changing the document/, undefined, {
      timeout: 10_000,
    });
    expect(screen.getByText(/it needs the owner password/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /convert to grayscale/i }),
    ).toBe(null);

    await typePassword(field, OPEN_PASSWORD_RESTRICTED_FIXTURE.owner);
    const out = await convert();
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  }, 60_000);

  it("a file that opens without a password but is restricted: only the owner password converts it", async () => {
    const fixture = RESTRICTED_FIXTURES[0]!;
    const field = await drop(fixture.file);
    await typePassword(field, fixture.owner);
    const out = await convert();
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  }, 60_000);

  it("the page says the password is typed here and checked in the browser", () => {
    const answers = pageFaq(getToolBySlug(SLUG)!).map((f) => f.answer);
    expect(
      answers.some(
        (a) =>
          a.includes(GRAYSCALE_PASSWORD_LABEL) &&
          /checked in your browser/.test(a) &&
          /owner password/.test(a),
      ),
    ).toBe(true);
  });
});
