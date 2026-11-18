import type { Page } from "@playwright/test";
import { tools } from "../../src/lib/tools";
import { makePdfBytes } from "../helpers";
import { encodePng } from "../client-proof/fixtures";
import { READY_WORKER_STATUS } from "../../src/tests/ready-worker-status";

/**
 * The files a spec hands a tool page, one per catalogue format, and the set of
 * tool pages that take a file at all. Moved here 2026-11-18 out of
 * `tool-layout.mobile.spec.ts` (its long-name case) so `axe.spec.ts`'s
 * after-upload sweep loads every tool the SAME way: one derivation of "the
 * tools that take a file" and one fixture per format, not two copies that
 * drift. The PDF fixture gained a page count (default 1, as before) because
 * the axe sweep needs scroll containers that overflow.
 */

const LONG_STEM =
  "Quarterly_Financial_Statement_Consolidated_Final_Approved_Version_2026";
/** `<stem>.<ext>`, 66 characters, one unbroken word. */
export const longName = (ext: string) =>
  `${LONG_STEM.slice(0, 65 - ext.length)}.${ext}`;

export interface Payload {
  name: string;
  mimeType: string;
  buffer: Buffer;
  /** Text a page that reads the file into an editor shows instead of its name. */
  body?: string;
}

const ZIP_HEAD = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);

/**
 * An EPUB's first local entry and nothing after it: a STORED `mimetype` whose
 * value is `application/epub+zip`, which is all the page's sniff
 * (`zipMimetype` in src/lib/intent/sniff.ts) reads. The worker never sees it.
 */
const EPUB_MIMETYPE = "application/epub+zip";
const EPUB_HEAD = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00]),
  Buffer.from([0x00, 0x00, 0x00, 0x00, 0x6f, 0x61, 0xab, 0x2c]),
  Buffer.from([EPUB_MIMETYPE.length, 0, 0, 0, EPUB_MIMETYPE.length, 0, 0, 0]),
  Buffer.from([0x08, 0x00, 0x00, 0x00]),
  Buffer.from(`mimetype${EPUB_MIMETYPE}`, "latin1"),
]);

/**
 * A fixture for one catalogue format, or null when none is made for it.
 * `pdfPages` is the PDF fixture's page count (other formats ignore it).
 */
export async function payloadFor(
  format: string,
  pdfPages = 1,
): Promise<Payload | null> {
  switch (format) {
    case "PDF":
      return {
        name: longName("pdf"),
        mimeType: "application/pdf",
        buffer: Buffer.from(await makePdfBytes("long name", pdfPages)),
      };
    case "PNG":
      return {
        name: longName("png"),
        mimeType: "image/png",
        buffer: encodePng(Buffer.alloc(8 * 8 * 3, 0x80), 8, 8),
      };
    case "DOCX":
      return {
        name: longName("docx"),
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: ZIP_HEAD,
      };
    case "XLSX":
      return {
        name: longName("xlsx"),
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: ZIP_HEAD,
      };
    case "PPTX":
      return {
        name: longName("pptx"),
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: ZIP_HEAD,
      };
    case "EPUB":
      return {
        name: longName("epub"),
        mimeType: EPUB_MIMETYPE,
        buffer: EPUB_HEAD,
      };
    case "HTML":
      return {
        name: longName("html"),
        mimeType: "text/html",
        buffer: Buffer.from("<!doctype html><p>A page.</p>"),
        body: "A page.",
      };
    case "MD":
      return {
        name: longName("md"),
        mimeType: "text/markdown",
        buffer: Buffer.from("# A title\n\nA paragraph.\n"),
        body: "A paragraph.",
      };
    case "TXT":
      return {
        name: longName("txt"),
        mimeType: "text/plain",
        buffer: Buffer.from("A paragraph of plain text.\n"),
        body: "A paragraph of plain text.",
      };
    default:
      return null;
  }
}

export const REFUSED: Payload = {
  name: longName("xyz"),
  mimeType: "application/octet-stream",
  buffer: Buffer.from("not a document"),
};

/** Every catalogue tool whose formats are files: all but the URL tools. */
export const FILE_TOOLS = tools.filter((t) => !t.accept.includes("URL"));

/**
 * The file a tool takes: the first of its formats a fixture is made for.
 * Throws, naming the tool, when none is, so a new format cannot leave a tool
 * out of every sweep that loads it.
 */
export async function takenPayloadFor(
  tool: (typeof tools)[number],
  pdfPages = 1,
): Promise<Payload> {
  for (const format of tool.accept) {
    const taken = await payloadFor(format, pdfPages);
    if (taken) return taken;
  }
  throw new Error(
    `${tool.slug}: no fixture is made for any of its formats (${tool.accept.join(", ")}) — add one to payloadFor`,
  );
}

/** What each page is given: its own format, a PDF if it refuses them, `.xyz`. */
export async function loadsFor(
  tool: (typeof tools)[number],
): Promise<{ label: string; payload: Payload }[]> {
  const taken = await takenPayloadFor(tool);
  const loads = [{ label: `a ${tool.accept[0]} it takes`, payload: taken }];
  if (!tool.accept.includes("PDF"))
    loads.push({
      label: "a PDF it refuses",
      payload: (await payloadFor("PDF"))!,
    });
  loads.push({ label: "a file nothing takes", payload: REFUSED });
  return loads;
}

declare global {
  interface Window {
    __releaseStatus?: () => void;
  }
}

export type StatusStep = "hold-then-fail" | "fail" | "local" | "ready";

/** Answer `/api/worker/status` by plan, in the page (no `page.route`). */
export async function planStatus(
  page: Page,
  plan: StatusStep[],
  readyStatus: object = READY_WORKER_STATUS,
): Promise<void> {
  await page.addInitScript(
    ({ plan, ready }) => {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      window.__releaseStatus = () => release();
      let asked = 0;
      const real = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
          location.href,
        );
        if (url.pathname !== "/api/worker/status") return real(input, init);
        const step = plan[Math.min(asked++, plan.length - 1)];
        if (step === "hold-then-fail") {
          await held;
          throw new TypeError("Failed to fetch");
        }
        if (step === "fail") throw new TypeError("Failed to fetch");
        if (step === "ready")
          return new Response(ready, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        return real(input, init);
      };
    },
    { plan, ready: JSON.stringify(readyStatus) },
  );
}
