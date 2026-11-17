import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { captureDownload } from "./client-proof/artifacts";
import { attachConsoleGuard, fileInput, waitForHydration } from "./helpers";
import { shownAspect, zoomButton } from "./page-zoom-fixture";
import { PDFJS_DOCUMENT_DEFAULTS } from "../src/lib/pdf/wasm-assets";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import {
  PDF_NEEDS_PASSWORD_MESSAGE,
  PDF_RESTRICTED_MESSAGE,
} from "../src/lib/pdf/encryption";
import {
  OWNER_PASSWORD_BUTTON,
  OWNER_PASSWORD_LABEL,
  type OwnerPasswordTool,
} from "../src/lib/pdf/owner-password-copy";

/**
 * The owner-password field of Merge PDF, Extract Pages, Delete Pages, Rotate
 * PDF and Extract Images (competitor-audit backlog #11), in a real browser
 * against `next start`, with real encrypted fixtures (pypdf, never the
 * handler under test — `src/tests/fixtures/restricted-pdf/README.md`):
 *
 *  - AES-256 and RC4-128 files that open WITHOUT a password and withhold
 *    copying, page assembly and changes;
 *  - an AES-256 file with BOTH passwords (open "open-test").
 *
 * For each tool and file: no password → a refusal that points at the
 * field (never "Unlock PDF first, then try again" over it), and the field;
 * a wrong password → "not this PDF's owner password"; the open password →
 * still refused, with the reason (for a file with no open password there is
 * nothing to type, and the button stays unavailable); the owner password →
 * the tool runs, and the download is read back in THIS process.
 */

const DIR = join(process.cwd(), "src/tests/fixtures/restricted-pdf");
const read = (file: string) => readFileSync(join(DIR, file));

interface Fixture {
  file: string;
  owner: string;
  open: string;
  cipher: string;
  /** What pdf.js reports the author grants. */
  permissions: number[];
}

const FIXTURES: readonly Fixture[] = [
  {
    file: "pypdf-r6-aes256-no-grant.pdf",
    owner: "owner-aes256-test",
    open: "",
    cipher: "AES-256",
    permissions: [4, 512, 2048],
  },
  {
    file: "pypdf-r3-no-assemble-copy.pdf",
    owner: "owner-nogrant-test",
    open: "",
    cipher: "RC4-128",
    permissions: [4, 512, 2048],
  },
  {
    file: "pypdf-r6-aes256-both-passwords.pdf",
    owner: "owner-both-test",
    open: "open-test",
    cipher: "AES-256, both passwords",
    permissions: [4, 512, 2048],
  },
];

const TOOLS: readonly OwnerPasswordTool[] = [
  "merge-pdf",
  "extract-pages",
  "remove-pages",
  "rotate-pdf",
  "extract-images",
];

async function viewer(buf: Buffer, password: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    password,
    useWorkerFetch: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
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

/** pdf-lib refuses any /Encrypt: a page count is the proof there is none. */
async function unencryptedPages(buf: Buffer): Promise<number> {
  return (await PDFDocument.load(new Uint8Array(buf))).getPageCount();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

/** The tools whose opened file shows a page board (#356's zoom on it). */
const BOARD_TOOLS: ReadonlySet<OwnerPasswordTool> = new Set([
  "extract-pages",
  "remove-pages",
  "rotate-pdf",
]);

async function open(page: Page, tool: OwnerPasswordTool, fixture: Fixture) {
  await page.goto(`/tools/${tool}`);
  const input = fileInput(page);
  await waitForHydration(input);
  const locked = {
    name: "locked.pdf",
    mimeType: "application/pdf",
    buffer: read(fixture.file),
  };
  await input.setInputFiles(
    tool === "merge-pdf"
      ? [
          {
            name: "first.pdf",
            mimeType: "application/pdf",
            buffer: read("grant-base.pdf"),
          },
          locked,
        ]
      : [locked],
  );
  return page.getByLabel(OWNER_PASSWORD_LABEL, { exact: true });
}

async function submit(page: Page, password: string, opens = false) {
  const field = page.getByLabel(OWNER_PASSWORD_LABEL, { exact: true });
  await field.fill(password);
  await page.getByRole("button", { name: OWNER_PASSWORD_BUTTON }).click();
  // Cleared before the check returns: nothing is left in the field. (The
  // owner password opens the file, and the field goes with the refusal.)
  if (!opens) await expect(field).toHaveValue("");
}

/** The tool's own work after the owner password, checked on the download. */
async function finish(page: Page, tool: OwnerPasswordTool, fixture: Fixture) {
  switch (tool) {
    case "merge-pdf": {
      const merge = page.getByRole("button", { name: /^merge/i });
      await expect(merge).toBeEnabled({ timeout: 20_000 });
      await merge.click();
      const buf = await captureDownload(
        page,
        page.getByRole("button", { name: /download merged pdf/i }),
      );
      expect(await unencryptedPages(buf)).toBe(4);
      return;
    }
    case "extract-pages": {
      await page.getByRole("button", { name: "Select all" }).click();
      await page.getByRole("button", { name: /^extract 2 pages$/i }).click();
      const buf = await captureDownload(
        page,
        page.getByRole("button", { name: /^download pdf$/i }),
      );
      expect(await unencryptedPages(buf)).toBe(2);
      return;
    }
    case "remove-pages": {
      await page.getByRole("button", { name: "Odd pages" }).click();
      await page.getByRole("button", { name: /^delete 1 page$/i }).click();
      const buf = await captureDownload(
        page,
        page.getByRole("button", { name: /^download pdf$/i }),
      );
      expect(await unencryptedPages(buf)).toBe(1);
      return;
    }
    case "rotate-pdf": {
      await page.getByRole("button", { name: /^right$/i }).click();
      await page.getByRole("button", { name: /apply rotation/i }).click();
      const buf = await captureDownload(
        page,
        page.getByRole("button", { name: /download rotated pdf/i }),
      );
      // The original, byte for byte, then the rotation: still the author's
      // encryption, grant and passwords.
      const original = read(fixture.file);
      expect(buf.subarray(0, original.length).equals(original)).toBe(true);
      const out = await viewer(buf, fixture.open);
      expect(out.encrypted).toBe(true);
      expect(out.permissions).toEqual(fixture.permissions);
      expect(out.rotations).toEqual([90, 90]);
      return;
    }
    case "extract-images": {
      await page.getByRole("button", { name: /^extract images$/i }).click();
      const buf = await captureDownload(
        page,
        page.getByRole("button", { name: /^download image$/i }),
      );
      expect([...buf.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      return;
    }
  }
}

for (const tool of TOOLS)
  for (const fixture of FIXTURES)
    test(`${tool} - ${fixture.cipher}: only the owner password opens it`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const guard = attachConsoleGuard(page);
      const requests: string[] = [];
      page.on("request", (r) => requests.push(r.url() + (r.postData() ?? "")));
      const field = await open(page, tool, fixture);

      // No password: the refusal, worded for the field under it.
      await expect(field).toBeVisible({ timeout: 20_000 });
      const refusal =
        fixture.open !== ""
          ? /is password-protected\. Type its owner password below to use it here\./
          : tool === "rotate-pdf" || tool === "extract-images"
            ? /author doesn't allow .+ Type the owner password below/
            : /has editing restrictions set by its author\. Type the owner password that set them below/;
      await expect(page.getByText(refusal).first()).toBeVisible();
      // INVERTED 2026-11-17 (review): the tool-wide sentences said to
      // remove the password with Unlock PDF first; over the field they are
      // gone.
      for (const old of [PDF_NEEDS_PASSWORD_MESSAGE, PDF_RESTRICTED_MESSAGE])
        await expect(page.getByText(old)).toHaveCount(0);
      // ...but the remedy the tool-wide refusal drew stays under it, in the
      // single-file tools: ONE Unlock PDF link, which password it wants, and
      // that the file goes along and uploads only when started (G.7 row 4;
      // CI Playwright smoke caught the field's refusal dropping all three).
      if (fixture.open !== "" && tool !== "merge-pdf") {
        const alert = page
          .getByRole("alert")
          .filter({ hasText: "is password-protected." });
        await expect(alert.getByRole("link")).toHaveText(["Open Unlock PDF"]);
        await expect(alert).toContainText("with the password that opens it.");
        await expect(alert).toContainText(
          "Your file goes with you, and it uploads to our secure server only when you start it.",
        );
      }
      // The field is outside every live region.
      expect(
        await field.evaluate((el) => el.closest("[role=alert]") === null),
      ).toBe(true);
      const button = page.getByRole("button", { name: OWNER_PASSWORD_BUTTON });
      await expect(button).toHaveAttribute("aria-disabled", "true");

      // A wrong password.
      await submit(page, "not-the-owner-password");
      await expect(
        page.getByText(
          "That password is not this PDF's owner password. Nothing was changed.",
        ),
      ).toBeVisible({ timeout: 20_000 });

      // The open password: still refused, with the reason. A file that opens
      // without one has nothing to type — the field cannot be submitted empty.
      if (fixture.open !== "") {
        await submit(page, fixture.open);
        await expect(
          page.getByText(
            /That password opens this PDF, but it is not the owner password\. The author doesn't allow .+, and only the owner password lifts that\./,
          ),
        ).toBeVisible({ timeout: 20_000 });
      } else {
        await field.fill("");
        await expect(button).toHaveAttribute("aria-disabled", "true");
      }
      await expect(page.locator("[data-owner-opened]")).toHaveCount(0);

      // The owner password: the tool runs, and the output is right.
      await submit(page, fixture.owner, true);
      const opened = page.locator(`[data-owner-opened="${tool}"]`);
      await expect(opened).toBeVisible({ timeout: 20_000 });
      // The form went with the refusal; the focus is on the note, not <body>.
      await expect(opened).toBeFocused();
      // The opened board is the tool's own, with "View page N larger"
      // (#356): page 2's button opens page 2, drawn from the decrypted copy.
      if (BOARD_TOOLS.has(tool)) {
        const second = zoomButton(page, 2);
        await second.click();
        const dialog = page.getByRole("dialog", { name: "Page 2 of 2" });
        await expect(dialog).toBeVisible();
        expect(await shownAspect(dialog)).toBeGreaterThan(0);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(second).toBeFocused();
      }
      await finish(page, tool, fixture);

      // No password left the page.
      for (const typed of [
        fixture.owner,
        "not-the-owner-password",
        ...(fixture.open ? [fixture.open] : []),
      ])
        expect(requests.filter((r) => r.includes(typed))).toEqual([]);
      expect(guard.pageErrors).toEqual([]);
      expect(guard.cspViolations()).toEqual([]);
    });

/**
 * Rotate PDF writes back under the author's encryption and Extract Images
 * writes no PDF, so neither lifts anything: the password that only OPENS a
 * file serves when its author grants what the tool does (review
 * 2026-11-17). `pypdf-r3-open-password-restricted.pdf` grants page assembly
 * (1024) and copying (16).
 */
const GRANTING: Fixture = {
  file: "pypdf-r3-open-password-restricted.pdf",
  owner: "owner-openrestr-test",
  open: "open-test",
  cipher: "RC4-128, open password, grants rotation and copying",
  permissions: [4, 16, 512, 1024, 2048],
};

for (const tool of ["rotate-pdf", "extract-images"] as const)
  test(`${tool} - ${GRANTING.cipher}: the open password serves, and nothing is lifted`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const guard = attachConsoleGuard(page);
    const field = await open(page, tool, GRANTING);
    await expect(field).toBeVisible({ timeout: 20_000 });
    await submit(page, GRANTING.open, true);
    const opened = page.locator(`[data-owner-opened="${tool}"]`);
    await expect(opened).toBeVisible({ timeout: 20_000 });
    await expect(opened).toHaveText(/^Opened with its password, here/);
    await expect(opened).toBeFocused();
    await finish(page, tool, GRANTING);
    expect(guard.pageErrors).toEqual([]);
    expect(guard.cspViolations()).toEqual([]);
  });
