/**
 * Page STATES the contrast audit measures with `--states`: surfaces that
 * exist only after someone does something, so a route list cannot reach
 * them — the home desk's ticket first of all (WP-05), which renders only
 * once files are on the desk, in the browser.
 *
 * Each state is a route and the steps that bring it about, taken the way a
 * visitor takes them (through the desk's own picker, its own buttons), and a
 * wait for the state to be COMPLETE before anything is measured: a ticket
 * still showing its placeholders would be measured as the placeholders.
 *
 * Fixtures are generated here (pdf-lib), never committed; the password one
 * is the checked-in encrypted fixture the unit tests use.
 */
import type { Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { USER_PASSWORD_PDF_BASE64 } from "../src/tests/fixtures-encrypted";

export interface AuditState {
  /** What a log line calls it. */
  readonly name: string;
  readonly route: string;
  /** Bring the state about, and resolve only once it is fully drawn. */
  readonly prepare: (page: Page) => Promise<void>;
}

async function pdf(label: string, pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++)
    doc
      .addPage([320, 240])
      .drawText(`${label} ${i + 1}`, { x: 24, y: 200, size: 16, font });
  return Buffer.from(await doc.save());
}

const TICKET = "What you can do with these files";

/** Stage files through the desk's own picker, then wait for the offers. */
async function stage(
  page: Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
): Promise<void> {
  const input = page.locator('[data-desk] input[type="file"]').first();
  await input.waitFor({ state: "attached" });
  await input.setInputFiles(files);
  await settled(page);
}

async function settled(page: Page): Promise<void> {
  const ticket = page.getByRole("region", { name: TICKET });
  await ticket.waitFor({ state: "visible", timeout: 20_000 });
  // The suggestions (or, for files nothing opens, the note) have replaced
  // the placeholder, and nothing is still being measured.
  await page.waitForFunction(
    (name) => {
      const region = [...document.querySelectorAll("section")].find(
        (s) => s.querySelector("h2")?.textContent === name,
      );
      if (!region) return false;
      const busy = region.querySelector(
        '[data-slot="suggestions"] [aria-busy="true"]',
      );
      return !busy && !region.textContent?.includes("measuring…");
    },
    TICKET,
    { timeout: 20_000 },
  );
  // The rows' entrance has finished (the audit runs with reduced motion,
  // so this is a frame, not an animation).
  await page.waitForTimeout(200);
}

export const A11Y_STATES: readonly AuditState[] = [
  {
    name: "home ticket: two PDFs",
    route: "/",
    prepare: async (page) =>
      stage(page, [
        {
          name: "contract.pdf",
          mimeType: "application/pdf",
          buffer: await pdf("contract", 12),
        },
        {
          name: "annex.pdf",
          mimeType: "application/pdf",
          buffer: await pdf("annex", 3),
        },
      ]),
  },
  {
    name: "home ticket: a PDF that needs a password",
    route: "/",
    prepare: (page) =>
      stage(page, [
        {
          name: "locked.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(USER_PASSWORD_PDF_BASE64, "base64"),
        },
      ]),
  },
  {
    name: "home ticket: a HEIC photo (the note, no offers)",
    route: "/",
    prepare: (page) =>
      stage(page, [
        {
          name: "photo.heic",
          mimeType: "image/heic",
          buffer: Buffer.concat([
            Buffer.from([0, 0, 0, 24]),
            Buffer.from("ftypheic\0\0\0\0mif1heic", "latin1"),
          ]),
        },
      ]),
  },
  {
    name: "home ticket: the sample PDF, More open",
    route: "/",
    prepare: async (page) => {
      await page.getByRole("button", { name: /try a sample pdf/i }).click();
      await settled(page);
      await page.getByText(/^More for these files/).click();
    },
  },
];
