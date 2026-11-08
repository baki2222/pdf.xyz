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
  ASSEMBLE_COPY_FIXTURE,
  NO_ASSEMBLE_COPY_FIXTURE,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { ToolRunner } from "./tool-runner";
import { runnerMounted } from "@/tests/runner-mounted";
import { GRANTED_NOTE, WITHHELD_MESSAGE } from "./restricted-grant";
import { GRANT_PERMISSION_NAME } from "@/lib/pdf/restricted-grant-names";
import { getToolBySlug } from "@/lib/tools";
import { pageFaq } from "@/lib/tools/page-copy";

/**
 * Rotate PDF on a RESTRICTED file (audit rotate-pdf#2), through the button:
 * the page's own runner, a real File, "Right", "Apply rotation", "Download
 * rotated PDF", and the Blob handed to the browser — read back by pdf.js.
 *
 * Until 2026-11-08 every such file was refused at upload and sent to Unlock
 * PDF (a server upload needing an owner password the user rarely has),
 * although rotating pages is a permission the author can grant on its own
 * (/P bit 11). Now the author's grant decides: granted, the copy is rotated
 * under the author's own encryption; withheld, the tool names the
 * permission and the owner password, and offers no Apply.
 *
 * No `vi.mock` (shared module cache): the browser seams are stubbed on the
 * globals and restored, as in `rotate-runner.test.tsx`.
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
    return `blob:rotate-restricted-test/${downloads.length}`;
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

async function drop(file: string) {
  const kind = getRunnerKind(SLUG);
  expect(kind).toBe("rotate");
  const { container } = render(
    <Router>
      <ToolRunner kind={kind!} slug={SLUG} />
    </Router>,
  );
  await runnerMounted(container);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the dropzone file input").not.toBeNull();
  const bytes = readRestrictedFixture(file);
  fireEvent.change(input!, {
    target: {
      files: [
        new File([bytes.slice()], "statement.pdf", { type: "application/pdf" }),
      ],
    },
  });
  return bytes;
}

async function readAsViewer(bytes: Uint8Array) {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = lib.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  try {
    const { info } = await doc.getMetadata();
    const rotations: number[] = [];
    for (let i = 1; i <= doc.numPages; i += 1)
      rotations.push((await doc.getPage(i)).rotate);
    return {
      encrypted:
        (info as { EncryptFilterName?: unknown }).EncryptFilterName != null,
      permissions: await doc.getPermissions(),
      rotations,
    };
  } finally {
    await task.destroy();
  }
}

describe("rotate-pdf: a PDF its author restricted", () => {
  it("assembly granted: opens, says so, and downloads a rotated copy under the author's encryption", async () => {
    const original = await drop(ASSEMBLE_COPY_FIXTURE.file);
    await screen.findByRole(
      "button",
      { name: /^right$/i },
      { timeout: 10_000 },
    );
    expect(screen.getByText(GRANTED_NOTE.assemble)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^right$/i }));
    const apply = screen.getByRole("button", { name: /apply rotation/i });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    const download = await screen.findByRole(
      "button",
      { name: /download rotated pdf/i },
      { timeout: 10_000 },
    );
    expect(screen.getByText(/author's protection kept/)).toBeTruthy();
    fireEvent.click(download);
    expect(downloads).toHaveLength(1);
    const out = new Uint8Array(await downloads[0]!.arrayBuffer());

    expect(out.subarray(0, original.length)).toEqual(original);
    const read = await readAsViewer(out);
    expect(read.encrypted).toBe(true);
    expect(read.permissions).toEqual(ASSEMBLE_COPY_FIXTURE.permissions);
    expect(read.rotations).toEqual([90, 90]);
  }, 30_000);

  it("assembly withheld: names the permission and the owner password, and offers no Apply", async () => {
    await drop(NO_ASSEMBLE_COPY_FIXTURE.file);
    const alert = await screen.findByText(
      WITHHELD_MESSAGE.assemble,
      {},
      { timeout: 10_000 },
    );
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /apply rotation/i })).toBe(
      null,
    );
    expect(
      screen.getByRole("link", { name: /unlock pdf/i }).getAttribute("href"),
    ).toBe("/tools/unlock-pdf");
    // And the way back is a real control.
    fireEvent.click(
      screen.getByRole("button", { name: /choose another pdf/i }),
    );
    await waitFor(() =>
      expect(screen.queryByText(WITHHELD_MESSAGE.assemble)).toBeNull(),
    );
  }, 30_000);

  it("the page says what the runner does: the permission by name, and the author's encryption kept", () => {
    const answers = pageFaq(getToolBySlug(SLUG)!).map((f) => f.answer);
    const said = answers.find((a) =>
      a.includes(`the ${GRANT_PERMISSION_NAME.assemble} permission`),
    );
    expect(
      said,
      "no FAQ answer names the permission Rotate PDF asks",
    ).toBeTruthy();
    expect(said).toContain("keeps the author's encryption");
    // The message the runner shows names the same permission.
    expect(WITHHELD_MESSAGE.assemble).toContain(
      `the ${GRANT_PERMISSION_NAME.assemble} permission`,
    );
  });
});
