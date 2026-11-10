import type { ViewerPdf } from "@/lib/pdf/viewer";
import type { PrintPlan } from "@/lib/pdf/viewer-geometry";

/**
 * Print, the only way a browser can print a PDF it drew itself: each page
 * of `plan` (`printPlan`: from page 1, at VIEWER_PRINT_DPI, within the page
 * and pixel caps it states) is drawn to an image, the images are put in a
 * container that is the only thing the print stylesheet shows, and the
 * browser's print dialog opens on them. Every image is DECODED before the
 * dialog opens, so no page prints blank for having been still loading.
 *
 * Images, not vectors: text prints as sharp as the resolution allows, and
 * the copy says it is an image print. Everything is removed after the
 * dialog closes (`afterprint`), or when `signal` aborts.
 */
export async function printPages(
  doc: ViewerPdf,
  plan: PrintPlan,
  onProgress: (done: number) => void,
  signal: AbortSignal,
): Promise<"printed" | "aborted" | "failed"> {
  const urls: string[] = [];
  const container = document.createElement("div");
  container.setAttribute("data-viewer-print", "");
  const style = document.createElement("style");
  style.textContent =
    "@media screen{[data-viewer-print]{display:none!important}}" +
    "@media print{body>*:not([data-viewer-print]){display:none!important}" +
    "[data-viewer-print] img{display:block;width:100%;height:auto;break-after:page;page-break-after:always}" +
    "[data-viewer-print] img:last-child{break-after:auto;page-break-after:auto}" +
    "@page{margin:0}}";
  const cleanup = () => {
    container.remove();
    style.remove();
    for (const url of urls) URL.revokeObjectURL(url);
    urls.length = 0;
  };
  try {
    let done = 0;
    for (const page of plan.pages) {
      if (signal.aborted) {
        cleanup();
        return "aborted";
      }
      const canvas = await doc.renderForPrint(
        page.index,
        page.width,
        page.height,
        signal,
      );
      if (!canvas) {
        cleanup();
        return signal.aborted ? "aborted" : "failed";
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) {
        cleanup();
        return "failed";
      }
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = document.createElement("img");
      img.alt = `Page ${page.index + 1}`;
      img.src = url;
      await img.decode().catch(() => {});
      container.append(img);
      done += 1;
      onProgress(done);
    }
    if (signal.aborted) {
      cleanup();
      return "aborted";
    }
    document.head.append(style);
    document.body.append(container);
    window.addEventListener("afterprint", cleanup, { once: true });
    signal.addEventListener("abort", cleanup, { once: true });
    window.print();
    return "printed";
  } catch {
    cleanup();
    return "failed";
  }
}
