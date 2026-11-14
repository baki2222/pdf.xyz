/**
 * Does THIS worker image print a ZIP of a web page?
 *
 * The web tier auto-deploys and the worker image is published separately
 * (CLAUDE.md rule 5), so "the code is merged" says nothing about the image
 * that will run a job. And an image built before ZIP input does not refuse
 * a ZIP: it hands the archive's bytes to Chromium as if they were HTML and
 * returns the noise as "Your PDF is ready." So the HTML to PDF page offers
 * ZIP, and the upload and job APIs accept one, only while the live heartbeat
 * carries `htmlZip: true` — and this is the proof the daemon publishes it
 * from. An older image does not contain this module, publishes no such key,
 * and parses as `false`; it does not have to cooperate.
 *
 * ── IT PROBES THE COMPOSED CHAIN, NOT A UNIT ─────────────────────────────────
 * The probe builds the registry the daemon builds (`createProcessorRegistry`)
 * and runs `html-to-pdf` jobs through the processor it resolves, with a
 * stub Chromium that records what it was asked to render. Calling
 * `openHtmlZip` directly would prove the reader exists while a processor
 * that never passed the job's page on, or an engine that sent the archive
 * to `renderHtml`, passed.
 *
 * A pass needs every one of:
 *   1. a ZIP job naming a page reaches the renderer as a SITE whose page is
 *      that one, whose stylesheet is served with `text/css`, and which
 *      refuses a path that climbs out of the archive (`%2e%2e`);
 *   2. an HTML file still renders as a file (`renderHtml`), not as a site;
 *   3. a ZIP of two pages naming neither is refused before the renderer
 *      starts;
 *   4. a ZIP uploaded under an HTML name and type, naming no page, is
 *      refused, finally, and never rendered (the gates read metadata);
 *   5. serving that site is BOUNDED by the render network's limits, through
 *      the very function the renderer answers every archive request with
 *      (`answerArchiveRequest`): with the default limits the request past
 *      `maxRequests` is refused, and with a byte budget of two stylesheets
 *      the third is, as is one answer past `maxResponseBytes`. Added after
 *      hostile review round 2 (2026-11-14): an image whose renderer served
 *      entries uncharged — any image built before the first review's fix,
 *      open to a 656 KB upload that took the worker's heap — would still
 *      have passed 1-4, so `htmlZip: true` said ZIPs were opened, not that
 *      serving them was bounded.
 *
 * ── WHAT A PASS DOES AND DOES NOT MEAN ──────────────────────────────────────
 * Chromium is a stub: a start-up probe launches no browser. A pass means
 * **this image's HTML to PDF opens a ZIP, chooses its page, serves its
 * files within the render network's limits, and refuses what it cannot
 * print**. That `./native.ts` answers through `answerArchiveRequest` rather
 * than around it is held by `zip-site.chromium.test.ts` (a real Chromium
 * past each limit) — at test time, not here. Whether Chromium itself runs
 * here is the html-render processor's own readiness; whether a real job
 * prints the pictures is `zip-site.chromium.test.ts`, and on a deployment,
 * a real job (see the PR's production proof).
 */
import JSZip from "jszip";
import { createProcessorRegistry } from "../processor";
import { HTML_DOCUMENT_URL } from "./document-url";
import type { ChromiumPdfRunner, HtmlSite } from "./engine";
import { DEFAULT_RENDER_NETWORK_LIMITS, createRenderNetwork } from "./network";
import { answerArchiveRequest } from "./zip-site";

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

/** How the probe builds its registry: the daemon's own, unless a test swaps it. */
export type ProbeRegistryBuilder = typeof createProcessorRegistry;

async function probeZip(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/**
 * True when this image's HTML to PDF prints a ZIP as a site — the page
 * asked for, its files served from the archive and nothing outside it — and
 * still prints an HTML file as a file.
 */
export async function provesHtmlZip(
  build: ProbeRegistryBuilder = createProcessorRegistry,
  /** How an archive request is answered: the renderer's own, unless a test swaps it. */
  answer: typeof answerArchiveRequest = answerArchiveRequest,
): Promise<boolean> {
  try {
    const sites: HtmlSite[] = [];
    let htmlCount = 0;
    // Read through a call: the stub runs inside the processor, which a
    // narrowed local could not see.
    const htmlRenders = () => htmlCount;
    const chromium: ChromiumPdfRunner = {
      renderHtml: async () => {
        htmlCount += 1;
        return PDF;
      },
      renderUrl: async () => PDF,
      renderSite: async (site) => {
        sites.push(site);
        return PDF;
      },
    };
    const registry = build({ htmlRender: { chromium } });
    const processor = registry.resolve("html-to-pdf");
    if (!processor) return false;
    const job = (
      bytes: Uint8Array,
      filename: string,
      options: Record<string, unknown>,
    ) =>
      processor.process({
        tool: "html-to-pdf",
        options,
        inputs: [
          {
            fileId: "probe",
            filename,
            contentType: filename.endsWith(".zip")
              ? "application/zip"
              : "text/html",
            bytes,
          },
        ],
      });

    // 1. A ZIP naming its page renders as a site of that page.
    const site = await probeZip({
      "site/index.html": '<link rel="stylesheet" href="s.css"><p>probe</p>',
      "site/about.html": "<p>about</p>",
      "site/s.css": "p{color:red}",
      "secret.txt": "outside the page's folder",
    });
    const zipRun = await job(site, "probe.zip", { entry: "site/about.html" });
    const rendered = sites[0];
    if (!zipRun.ok || sites.length !== 1 || !rendered) return false;
    if (rendered.entryUrl !== `${HTML_DOCUMENT_URL}site/about.html`)
      return false;
    const css = rendered.serve(`${HTML_DOCUMENT_URL}site/s.css`);
    if (css?.contentType !== "text/css") return false;
    if (rendered.serve(`${HTML_DOCUMENT_URL}site/%2e%2e/secret.txt`) !== null)
      return false;
    if (htmlRenders() !== 0) return false;

    // 2. An HTML file is still a file.
    const htmlRun = await job(enc("<p>probe</p>"), "probe.html", {});
    if (!htmlRun.ok || htmlRenders() !== 1 || sites.length !== 1) return false;

    // 3. Two pages, none named: refused before the renderer starts.
    const two = await probeZip({ "a.html": "a", "b.html": "b" });
    const refused = await job(two, "two.zip", {});
    if (refused.ok || refused.error.retryable) return false;
    if (sites.length !== 1 || htmlRenders() !== 1) return false;

    // 4. A ZIP named as HTML: refused, never rendered as either. One page,
    // so nothing ELSE would refuse it (the ZIP of step 1 has two pages and
    // would be refused for naming none — a pass for the wrong reason).
    const onePage = await probeZip({ "index.html": "<p>probe</p>" });
    const renamed = await job(onePage, "probe.html", {});
    if (renamed.ok || renamed.error.retryable) return false;
    if (sites.length !== 1 || htmlRenders() !== 1) return false;

    // 5. Serving is bounded, through the renderer's own answer.
    const get = { method: "GET", url: `${HTML_DOCUMENT_URL}site/s.css` };
    const size = css.body.byteLength;
    const fulfilled = (network: ReturnType<typeof createRenderNetwork>) =>
      answer(rendered, network, get).action === "fulfill";
    const limits = DEFAULT_RENDER_NETWORK_LIMITS;
    const requests = createRenderNetwork();
    for (let i = 0; i < limits.maxRequests; i += 1)
      if (!fulfilled(requests)) return false;
    if (fulfilled(requests)) return false;
    const bytes = createRenderNetwork(
      {},
      { ...limits, maxTotalBytes: 2 * size },
    );
    if (!fulfilled(bytes) || !fulfilled(bytes) || fulfilled(bytes))
      return false;
    const oneBody = createRenderNetwork(
      {},
      { ...limits, maxResponseBytes: size - 1 },
    );
    return !fulfilled(oneBody);
  } catch {
    return false;
  }
}
