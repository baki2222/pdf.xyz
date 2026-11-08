// @native-canvas
// @vitest-environment node
/**
 * SIB-09 verify: a trailer /Encrypt that is dangling, or a reference to an
 * object that is not an encryption dictionary, is read as "unencrypted" by
 * classifyPdfAccess while the streams are ciphertext and openProtectedPdf
 * refuses the same bytes. Also checks what pdf-lib (the in-browser editors'
 * loader) and pdf.js page text do with the same bytes, for user impact.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { ONE_PAGE, ownerOnlyEncrypted } from "./security-in-browser.fixtures";
import { classifyPdfAccess, probePdfEncryption } from "@/lib/pdf/encryption";
import { openProtectedPdf } from "@/lib/pdf/security/protected-pdf";

const requireHere = createRequire(import.meta.url);
const pdfjsLegacy = () =>
  import(
    pathToFileURL(requireHere.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href
  );

const CASES = {
  dangling: () => ownerOnlyEncrypted(ONE_PAGE, { encryptEntry: () => "77 0 R" }),
  selfRef: () =>
    ownerOnlyEncrypted([...ONE_PAGE, "5 0 R"], { encryptEntry: () => "5 0 R" }),
  control: () => ownerOnlyEncrypted(ONE_PAGE),
};

async function contentOps(bytes: Uint8Array) {
  const lib = await pdfjsLegacy();
  const task = lib.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const ops = await page.getOperatorList();
    return ops.fnArray.length as number;
  } finally {
    await task.destroy();
  }
}

describe("SIB-09", () => {
  for (const [name, make] of Object.entries(CASES)) {
    it(
      name,
      async () => {
        const bytes = make();
        const tail = new TextDecoder("latin1").decode(bytes.slice(-200));
        const classify = await classifyPdfAccess(bytes, await pdfjsLegacy());
        const lib = await pdfjsLegacy();
        const probe = await probePdfEncryption(bytes, async () => lib);
        const opened = await openProtectedPdf(bytes);
        const openedSummary =
          opened.kind === "opened" ? { kind: "opened" } : opened;
        let pdfLib: unknown;
        try {
          const { PDFDocument } = await import("pdf-lib");
          const d = await PDFDocument.load(bytes);
          pdfLib = { pages: d.getPageCount(), isEncrypted: d.isEncrypted };
        } catch (e) {
          pdfLib = { error: String((e as Error).message).slice(0, 120) };
        }
        let ops: unknown;
        try {
          ops = await contentOps(bytes);
        } catch (e) {
          ops = { error: String(e) };
        }
        (await import("node:fs")).appendFileSync((await import("node:path")).join((await import("node:os")).tmpdir(), "sib09.json"),
          JSON.stringify(
            { name, tail, classify, probe, openedSummary, pdfLib, ops },
            null,
            1,
          ) + "\n",
        );
        if (name === "control")
          expect(classify.kind).toBe("restricted");
      },
      30_000,
    );
  }
});
