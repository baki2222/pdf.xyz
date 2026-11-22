/**
 * Does THIS worker image hide ads when Webpage to PDF's "Hide common ads" is
 * ticked (audit wave 2, webpage-to-pdf#1)?
 *
 * The capture-options parser leaves keys it does not own to other parsers,
 * so an image built before `hideAds` does not refuse the key: it IGNORES it
 * and prints every ad under a ticked box. The web tier auto-deploys and the
 * worker image ships separately (CLAUDE.md rule 5), so the panel offers the
 * box only while the live heartbeat carries `htmlAdBlock: true` — and this
 * is the proof the daemon publishes it from. An older image does not contain
 * this module, publishes no such key, and parses as `false`.
 *
 * A pass needs every one of:
 *   1. a `webpage-to-pdf` job with `hideAds: true`, through the daemon's own
 *      registry (`createProcessorRegistry`) and processor, reaches the
 *      renderer with `capture.hideAds === true`, and returns a PDF artifact;
 *   2. the same job without the key reaches it with `hideAds === false`
 *      (an image that always blocked would change pages nobody asked to);
 *   3. the renderer's own request test (`isAdRequestUrl`, the function
 *      `native.ts` refuses requests with) refuses every listed host and a
 *      subdomain of each, and passes a non-ad host and a look-alike;
 *   4. the slot script the renderer runs carries every listed selector.
 *
 * WHAT A PASS DOES NOT MEAN: Chromium is a stub (a start-up probe launches
 * no browser). That a real Chromium refuses those requests and leaves the
 * slots blank in the printed PDF is `ads.chromium.test.ts`, at test time;
 * on a deployment, a real job.
 */
import { createProcessorRegistry } from "../processor";
import type { ChromiumPdfRunner } from "./engine";
import { AD_HOSTS, AD_SELECTORS, HIDE_ADS_SCRIPT, isAdRequestUrl } from "./ads";
import type { WebpageCaptureOptions } from "@/lib/jobs/webpage-capture-options";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);

export async function provesHtmlAdBlock(
  build: typeof createProcessorRegistry = createProcessorRegistry,
  isAd: (url: string) => boolean = isAdRequestUrl,
  script: string = HIDE_ADS_SCRIPT,
): Promise<boolean> {
  try {
    const seen: WebpageCaptureOptions[] = [];
    const chromium: ChromiumPdfRunner = {
      renderHtml: async () => PDF,
      renderUrl: async (_url, _options, _run, capture) => {
        if (capture) seen.push(capture);
        return PDF;
      },
    };
    const registry = build({ htmlRender: { chromium } });
    const processor = registry.resolve("webpage-to-pdf");
    if (!processor) return false;
    const run = (options: Record<string, unknown>) =>
      processor.process({ tool: "webpage-to-pdf", inputs: [], options });

    // 1 and 2: the option reaches the renderer, and only when it is asked.
    const on = await run({ url: "https://example.com/", hideAds: true });
    if (!on.ok || on.artifacts[0]?.contentType !== "application/pdf")
      return false;
    const off = await run({ url: "https://example.com/" });
    if (!off.ok) return false;
    if (seen.length !== 2) return false;
    if (seen[0]!.hideAds !== true || seen[1]!.hideAds !== false) return false;

    // 3: the renderer's own request test.
    if (AD_HOSTS.length === 0) return false;
    for (const host of AD_HOSTS) {
      if (!isAd(`https://${host}/x`)) return false;
      if (!isAd(`https://sub.${host}/x`)) return false;
      if (isAd(`https://not${host}/x`)) return false;
    }
    if (isAd("https://example.com/doubleclick.net")) return false;

    // 4: the slot script carries every selector.
    if (AD_SELECTORS.length === 0) return false;
    if (!script.includes(JSON.stringify(AD_SELECTORS))) return false;
    return true;
  } catch {
    return false;
  }
}
