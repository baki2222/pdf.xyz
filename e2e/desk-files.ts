import { expect, type Page } from "@playwright/test";
import { makePdfBytes, waitForHydration } from "./helpers";
import { USER_PASSWORD_PDF_BASE64 } from "../src/tests/fixtures-encrypted";

/**
 * The file sets the home desk is held to, in one place for every spec that
 * drops files on it (`layout-stability`, `home-desk.mobile`, `home-desk`).
 *
 * WHY A CORPUS. The desk's "one box for both states" was certified by a
 * guard that only ever dropped two PDFs — the one set that fitted. The
 * review that found the box growing dropped what visitors drop: one file,
 * three of mixed kinds, four, twenty-three, a HEIC, a stray file, a locked
 * PDF, an oversized photo, the sample. Each set below is a shape the ticket
 * lays out differently (rows, "+N more", the overflow row, notes, a pin, no
 * offers at all), and every set must be exercised by the specs that import
 * this — `DESK_SETS.length` is bounded below where they loop.
 *
 * Fixtures are generated per run (pdf-lib), never committed; the locked PDF
 * is the checked-in encrypted fixture the unit tests use.
 */

/** A file as the page builds it: bytes, or a size with a leading signature. */
export type DeskFile =
  | { readonly name: string; readonly type: string; readonly b64: string }
  | {
      readonly name: string;
      readonly type: string;
      readonly size: number;
      readonly head: readonly number[];
    };

export interface DeskSet {
  readonly name: string;
  /** The files, dropped on the desk; or the desk's own sample button. */
  readonly files: (() => Promise<DeskFile[]>) | "sample";
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const pdf = async (name: string, pages: number): Promise<DeskFile> => ({
  name,
  type: "application/pdf",
  b64: b64(await makePdfBytes(name, pages)),
});
const DOCX: DeskFile = {
  name: "report.docx",
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // A ZIP's signature: what a DOCX starts with. Nothing here unpacks it.
  b64: b64(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x20, 0x64, 0x6f, 0x63])),
};
/** The ISO-BMFF header a HEIC file starts with; nothing here decodes past it. */
const HEIC: DeskFile = {
  name: "photo.heic",
  type: "image/heic",
  b64: b64(
    Uint8Array.from([
      0,
      0,
      0,
      24,
      ...Buffer.from("ftypheic", "latin1"),
      0,
      0,
      0,
      0,
      ...Buffer.from("mif1heic", "latin1"),
    ]),
  ),
};
const UNKNOWN: DeskFile = {
  name: "notes.xyz",
  type: "",
  b64: b64(Buffer.from("plain words", "latin1")),
};
export const LOCKED: DeskFile = {
  name: "locked.pdf",
  type: "application/pdf",
  b64: USER_PASSWORD_PDF_BASE64,
};
/** 31 MB with a PNG signature: over the 25 MB the image tools take. */
const BIG_PNG: DeskFile = {
  name: "photo.png",
  type: "image/png",
  size: 31 * 1024 * 1024,
  head: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

export const DESK_SETS: readonly DeskSet[] = [
  { name: "one PDF", files: async () => [await pdf("contract.pdf", 3)] },
  {
    name: "two PDFs",
    files: async () => [
      await pdf("contract.pdf", 3),
      await pdf("annex.pdf", 1),
    ],
  },
  {
    name: "a Word file and two PDFs",
    files: async () => [
      DOCX,
      await pdf("contract.pdf", 3),
      await pdf("annex.pdf", 1),
    ],
  },
  {
    name: "four PDFs (+1 more)",
    files: async () =>
      Promise.all(["a", "b", "c", "d"].map((n, i) => pdf(`${n}.pdf`, i + 1))),
  },
  {
    name: "23 PDFs (past the ticket's 20)",
    files: async () =>
      Promise.all(
        Array.from({ length: 23 }, (_, i) => pdf(`file-${i + 1}.pdf`, 1)),
      ),
  },
  { name: "a HEIC photo (a note, no offers)", files: async () => [HEIC] },
  {
    name: "two PDFs, a HEIC and an unknown file (two notes)",
    files: async () => [
      await pdf("contract.pdf", 3),
      await pdf("annex.pdf", 1),
      HEIC,
      UNKNOWN,
    ],
  },
  { name: "a PDF that needs a password (a pin)", files: async () => [LOCKED] },
  { name: "a 31 MB PNG (over the image tools)", files: async () => [BIG_PNG] },
  { name: "the sample PDF", files: "sample" },
];

/** Drop `files` on the desk with a synthetic DataTransfer (no input flag). */
export async function dropOnDesk(page: Page, files: readonly DeskFile[]) {
  const desk = page.locator("[data-desk]");
  await waitForHydration(desk);
  const dataTransfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) {
      let bytes: Uint8Array<ArrayBuffer>;
      if ("b64" in f) {
        const bin = atob(f.b64);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        bytes = new Uint8Array(f.size);
        bytes.set(f.head);
      }
      dt.items.add(new File([bytes], f.name, { type: f.type }));
    }
    return dt;
  }, files);
  await desk.dispatchEvent("dragenter", { dataTransfer });
  await desk.dispatchEvent("dragover", { dataTransfer });
  await desk.dispatchEvent("drop", { dataTransfer });
}

/** Bring a set to the desk the way a visitor would. */
export async function bring(page: Page, set: DeskSet) {
  if (set.files === "sample") {
    const sample = page.getByRole("button", { name: /try a sample pdf/i });
    await waitForHydration(sample);
    await sample.click();
  } else {
    await dropOnDesk(page, await set.files());
  }
}

export const TICKET_NAME = "What you can do with these files";

/**
 * The ticket is complete: shown, its placeholder replaced (by offers, or
 * by the note when nothing opens the files), and nothing still measuring.
 */
export async function ticketSettled(page: Page) {
  const ticket = page.getByRole("region", { name: TICKET_NAME });
  await expect(ticket).toBeVisible({ timeout: 15_000 });
  await expect(
    ticket.locator('[data-slot="suggestions"] [aria-busy="true"]'),
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(ticket).not.toContainText("measuring…", { timeout: 15_000 });
  return ticket;
}
