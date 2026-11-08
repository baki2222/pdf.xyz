// Bounded cases for conversion-in-l09.test.ts: each builds ONE hostile input,
// calls ONE entry point and reports how it settled. Run through runBounded,
// so a regressed hang or bomb is a red result instead of a frozen run.
import { reportResult } from "./bounded";
import * as F from "./conversion-in.fixtures";

const mode = process.argv[2];

/** "x" and a form feed: one page of Text to PDF in two bytes (built from char codes). */
const XFF = "x" + String.fromCharCode(0x0c);

/** Run `fn`; report its refusal message, or that it produced output. */
async function settle(
  fn: () => Promise<unknown>,
  extra: () => object = () => ({}),
) {
  try {
    await fn();
    reportResult({ output: true, ...extra() });
  } catch (e) {
    reportResult({ refused: (e as Error).message, ...extra() });
  }
}

(async () => {
  if (mode === "png-bomb") {
    const { imagesToPdf } = await import("@/lib/pdf/image-to-pdf");
    const bytes = F.pngBomb(12_000, 12_000);
    await settle(() =>
      imagesToPdf("png", [{ name: "a.png", type: "", bytes }]),
    );
  } else if (mode === "png-claiming") {
    // Record the largest typed array asked for, by a Proxy on the
    // constructor installed BEFORE the engine is loaded.
    let largest = 0;
    const Real = globalThis.Uint8Array;
    globalThis.Uint8Array = new Proxy(Real, {
      construct(target, args, newTarget) {
        if (typeof args[0] === "number") largest = Math.max(largest, args[0]);
        return Reflect.construct(target, args, newTarget);
      },
    });
    const { imagesToPdf } = await import("@/lib/pdf/image-to-pdf");
    // Health check for the probe: an ordinary allocation is seen.
    new Uint8Array(16);
    const bytes = F.pngClaiming(20_000, 20_000, 6);
    await settle(
      () => imagesToPdf("png", [{ name: "a.png", type: "", bytes }]),
      () => ({ largest }),
    );
  } else if (mode === "form-feeds") {
    const { textToPdf } = await import("@/lib/pdf/text-to-pdf");
    await settle(() => textToPdf(XFF.repeat(1_048_576)));
  } else if (mode === "ceiling") {
    const { textToPdf } = await import("@/lib/pdf/text-to-pdf");
    const { MAX_TEXT_PAGES } = await import("@/lib/pdf/text-page-ceiling");
    const { PDFDocument } = await import("pdf-lib");
    try {
      const pdf = await textToPdf(XFF.repeat(MAX_TEXT_PAGES));
      const pages = (await PDFDocument.load(pdf)).getPageCount();
      reportResult({ pages });
    } catch (e) {
      reportResult({ refused: (e as Error).message });
    }
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
})();
