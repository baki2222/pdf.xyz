// @vitest-environment node
// @native-canvas
/**
 * Compare PDF's card count (audit compare-pdf#5 review): only `numPages`.
 * `readPagesWithPdfjs` also walks every page for rotations Compare throws
 * away, a full page walk on a large file each time one is added.
 */
import { describe, expect, it } from "vitest";
import { PdfEncryptedError } from "./engine-errors";
import { loadPdfjs, type PdfjsModule } from "./pdfjs";
import { countPagesWithPdfjs } from "./pdfjs-page-count";
import {
  ASSEMBLE_COPY_FIXTURE,
  OPEN_PASSWORD_FIXTURE,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";

/** pdf.js, with every document's `getPage` counted. */
function countingLoader(): {
  load: () => Promise<PdfjsModule>;
  pages: () => number;
} {
  let pages = 0;
  const load = async () => {
    const pdfjs = await loadPdfjs();
    const getDocument: PdfjsModule["getDocument"] = (src) => {
      const task = pdfjs.getDocument(src);
      const promise = task.promise.then((doc) => {
        const getPage = doc.getPage.bind(doc);
        doc.getPage = (n: number) => {
          pages += 1;
          return getPage(n);
        };
        return doc;
      });
      return {
        promise,
        destroy: () => task.destroy(),
      } as unknown as ReturnType<PdfjsModule["getDocument"]>;
    };
    return { ...pdfjs, getDocument } as PdfjsModule;
  };
  return { load, pages: () => pages };
}

describe("countPagesWithPdfjs", () => {
  it("counts a restricted file's pages without opening any page", async () => {
    const probe = countingLoader();
    const count = await countPagesWithPdfjs(
      readRestrictedFixture(ASSEMBLE_COPY_FIXTURE.file),
      probe.load,
    );
    expect(count).toBe(2);
    expect(probe.pages()).toBe(0);
  });

  it("the health check: the counting loader does see a page walk", async () => {
    const probe = countingLoader();
    const pdfjs = await probe.load();
    const task = pdfjs.getDocument({
      data: readRestrictedFixture(ASSEMBLE_COPY_FIXTURE.file).slice(),
    });
    const doc = await task.promise;
    await doc.getPage(1);
    expect(probe.pages()).toBe(1);
    await task.destroy();
  });

  it("refuses a file that needs a password, as password-protected", async () => {
    await expect(
      countPagesWithPdfjs(readRestrictedFixture(OPEN_PASSWORD_FIXTURE.file)),
    ).rejects.toBeInstanceOf(PdfEncryptedError);
  });
});
