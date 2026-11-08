// @vitest-environment jsdom
// @native-canvas
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
 * Extract Images on a RESTRICTED file (audit extract-images#3), through the
 * page's own runner and the Blob the Download button hands the browser.
 *
 * Until 2026-11-08 any encrypted file was refused at upload and sent to the
 * server-side Unlock PDF, even one that opens in every viewer and whose
 * author allows copying its content. Extract Images only reads, so the
 * author's grant decides: copying granted (/P bit 5), the picture comes out
 * of the decrypted copy; withheld, the tool names the permission and the
 * owner password, and offers no Extract.
 */

const SLUG = "extract-images";
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
    return `blob:extract-images-restricted-test/${downloads.length}`;
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
  expect(kind).toBe("extract-images");
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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("extract-images: a PDF its author restricted", () => {
  it("copying granted: opens, says so, and downloads the 8 x 8 picture", async () => {
    await drop(ASSEMBLE_COPY_FIXTURE.file);
    const run = await screen.findByRole(
      "button",
      { name: /extract images/i },
      { timeout: 10_000 },
    );
    expect(screen.getByText(GRANTED_NOTE.copy)).toBeTruthy();
    fireEvent.click(run);
    const download = await screen.findByRole(
      "button",
      { name: /^download image$/i },
      { timeout: 10_000 },
    );
    // The result's previews are object URLs too: the download is the Blob
    // the button adds.
    const before = downloads.length;
    fireEvent.click(download);
    expect(downloads).toHaveLength(before + 1);
    const out = new Uint8Array(await downloads.at(-1)!.arrayBuffer());
    // A PNG, 8 x 8 (IHDR width and height), read off the bytes.
    expect([...out.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    const view = new DataView(out.buffer, out.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([8, 8]);
  }, 30_000);

  it("copying withheld: names the permission and the owner password, and offers no Extract", async () => {
    await drop(NO_ASSEMBLE_COPY_FIXTURE.file);
    const alert = await screen.findByText(
      WITHHELD_MESSAGE.copy,
      {},
      { timeout: 10_000 },
    );
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /extract images/i })).toBe(
      null,
    );
    expect(
      screen.getByRole("link", { name: /unlock pdf/i }).getAttribute("href"),
    ).toBe("/tools/unlock-pdf");
  }, 30_000);

  it("the page says what the runner does: the permission by name", () => {
    const answers = pageFaq(getToolBySlug(SLUG)!).map((f) => f.answer);
    const said = answers.find((a) =>
      a.includes(`the ${GRANT_PERMISSION_NAME.copy} permission`),
    );
    expect(
      said,
      "no FAQ answer names the permission Extract Images asks",
    ).toBeTruthy();
    expect(WITHHELD_MESSAGE.copy).toContain(
      `the ${GRANT_PERMISSION_NAME.copy} permission`,
    );
  });
});
