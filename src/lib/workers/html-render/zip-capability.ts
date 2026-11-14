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
 *      serving them was bounded;
 *   6. that answer is CHARGED BEFORE THE ENTRY IS READ: refused by a budget,
 *      the site is never asked for its bytes; and a document (the HTML
 *      page) is charged to the site's document budget, which starts at
 *      `HTML_ZIP_MAX_DOCUMENT_BYTES`, while a stylesheet is not;
 *   7. the archive's own bounds hold where every serve depends on them: a
 *      ZIP declaring ONE file a byte past `HTML_ZIP_MAX_ENTRY_BYTES`, and
 *      one declaring files a byte past `HTML_ZIP_MAX_UNPACKED_BYTES` in all
 *      (each file inside every other bound), are each refused, finally,
 *      before the renderer, WITH THAT BOUND'S OWN refusal. Steps 6 and 7
 *      were added after hostile review round 3 (2026-11-14): with either
 *      directory bound deleted the probe still passed, while 80 entries of
 *      20 MiB took the worker from 206 to 2,323 MiB serving one render. The
 *      refusal's words are compared, not only its finality: with a bound
 *      deleted those archives are still refused, as unreadable (their
 *      declared sizes overlap), which a finality check would call a pass.
 *
 * EVERY step's job first passes the FILE-SOUNDNESS GATE the executor runs
 * before any processor, resolved from this process's environment exactly as
 * the daemon's runtime resolves it (`resolveWorkerSoundness`). Added after
 * the production proof of PR #314 (2026-11-14): steps 1-7 called the
 * processor directly, the gate derived HTML to PDF's accepted families from
 * the catalogue alone, and it refused every real ZIP job as an unsupported
 * family while this probe published `htmlZip: true`. The executor's order is
 * gate, then processor; so is the probe's.
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
import { resolveWorkerSoundness, type SoundnessGate } from "../soundness";
import { HTML_DOCUMENT_URL } from "./document-url";
import type { ChromiumPdfRunner, HtmlSite } from "./engine";
import { DEFAULT_RENDER_NETWORK_LIMITS, createRenderNetwork } from "./network";
import {
  HTML_ZIP_MAX_DOCUMENT_BYTES,
  HTML_ZIP_MAX_ENTRY_BYTES,
  HTML_ZIP_MAX_UNPACKED_BYTES,
  htmlZipRefusalMessage,
} from "./zip-config";
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
 * `zip` with its central directory rewritten to DECLARE `unpacked[i]` bytes
 * for entry i (the last figure repeats), each packed at half of that — so
 * inside every ratio bound, and only a size bound can refuse it. Nothing is
 * inflated to judge a directory, so the archive stays a few hundred bytes.
 */
function declaringSizes(zip: Uint8Array, unpacked: readonly number[]) {
  const out = new Uint8Array(zip);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let eocd = out.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("probe ZIP has no directory");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(at, true) !== 0x02014b50)
      throw new Error("probe ZIP directory is broken");
    const size = unpacked[Math.min(n, unpacked.length - 1)]!;
    view.setUint32(at + 20, Math.ceil(size / 2), true);
    view.setUint32(at + 24, size, true);
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  return out;
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
  /** The executor's file-soundness gate, resolved as the daemon's runtime resolves it. */
  soundness: SoundnessGate = resolveWorkerSoundness(),
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
    const job = async (
      bytes: Uint8Array,
      filename: string,
      options: Record<string, unknown>,
    ) => {
      const inputs = [
        {
          fileId: "probe",
          filename,
          contentType: filename.endsWith(".zip")
            ? "application/zip"
            : "text/html",
          bytes,
          declaredBytes: bytes.byteLength,
        },
      ];
      // The executor's order: the soundness gate, then the processor. A gate
      // that refuses the input would fail the real job before it got here.
      if (
        soundness.check({ tool: "html-to-pdf", inputs }).verdict === "unsound"
      )
        throw new Error("the soundness gate refused a probe input");
      return processor.process({ tool: "html-to-pdf", options, inputs });
    };

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
    if (rendered.lookup(`${HTML_DOCUMENT_URL}site/%2e%2e/secret.txt`) !== null)
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
    if (fulfilled(oneBody)) return false;

    // 6. Charged before it is read; documents against their own budget.
    if (rendered.documentBytesLeft !== HTML_ZIP_MAX_DOCUMENT_BYTES)
      return false;
    let reads = 0;
    const tapped = (documentBytesLeft: number) => ({
      lookup: (url: string) => rendered.lookup(url),
      serve: (url: string) => {
        reads += 1;
        return rendered.serve(url);
      },
      documentBytesLeft,
    });
    const refusedBody = createRenderNetwork(
      {},
      { ...limits, maxResponseBytes: size - 1 },
    );
    if (answer(tapped(Infinity), refusedBody, get).action !== "fail")
      return false;
    if (reads !== 0) return false;
    const page = {
      method: "GET",
      url: `${HTML_DOCUMENT_URL}site/about.html`,
    };
    const pageBytes = rendered.lookup(page.url)?.bytes ?? 0;
    if (pageBytes === 0) return false;
    const docs = tapped(pageBytes);
    const free = () => createRenderNetwork();
    if (answer(docs, free(), page).action !== "fulfill") return false;
    if (answer(docs, free(), get).action !== "fulfill") return false;
    if (answer(docs, free(), page).action !== "fail") return false;

    // 7. The archive's own bounds, each refused with its own words.
    const sizes = await probeZip({
      "index.html": "<p>probe</p>",
      "a.css": "a",
      "b.css": "b",
      "c.css": "c",
      "d.css": "d",
      "e.css": "e",
      "f.css": "f",
    });
    const bound = async (
      unpacked: readonly number[],
      limit: "file" | "unpacked",
    ) => {
      const run = await job(declaringSizes(sizes, unpacked), "bound.zip", {});
      return (
        !run.ok &&
        !run.error.retryable &&
        run.error.message === htmlZipRefusalMessage({ kind: "bomb", limit }) &&
        sites.length === 1 &&
        htmlRenders() === 1
      );
    };
    if (!(await bound([1, HTML_ZIP_MAX_ENTRY_BYTES + 1, 1], "file")))
      return false;
    // Six files inside the per-file bound, a byte past the total together.
    const each = Math.ceil((HTML_ZIP_MAX_UNPACKED_BYTES + 1) / 6);
    if (each > HTML_ZIP_MAX_ENTRY_BYTES) return false;
    return bound([1, each], "unpacked");
  } catch {
    return false;
  }
}
