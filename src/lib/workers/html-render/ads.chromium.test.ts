// @native-canvas
/**
 * "Hide common ads" (audit wave 2, webpage-to-pdf#1), read back from the PDF
 * a real Chromium prints through the production runner, at THE POINT OF
 * CONSUMPTION:
 *
 *  - REQUESTS: a page that frames an ad from every host in {@link AD_HOSTS}
 *    (one iframe per host) — with the option, not one of them reaches the
 *    fetch seam (counted there, after the policy) and their text is absent;
 *    without it, every one is fetched and printed (the CONTROL).
 *  - SLOTS: one element per {@link AD_SELECTORS} entry, each painted a
 *    colour used nowhere else on the page — with the option, that colour is
 *    never set as a fill in the printed PDF (pdf.js operator list: the slot's
 *    region is blank); without it, it is (the CONTROL).
 *  - The article stays, and a non-ad host on the same page is still fetched.
 *
 * The corpus is the lists themselves, so a host or selector added to them is
 * exercised here, and one that matches nothing it claims fails.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createNativeChromiumPdfRunner, resolveOnPath } from "./native";
import { findChromium } from "./test-chromium";
import { AD_HOSTS, AD_SELECTORS, isAdRequestUrl } from "./ads";
import type { PinnedFetch, Resolve } from "./network";
import { DEFAULT_HTML_RENDER_OPTIONS } from "@/lib/jobs/html-render-options";
import {
  DEFAULT_WEBPAGE_CAPTURE_OPTIONS,
  type WebpageCaptureOptions,
} from "@/lib/jobs/webpage-capture-options";

const BIN = findChromium(resolveOnPath);

const ARTICLE = "Ads proof article body";
const FRIEND = "Non ad framed widget words";
const adToken = (i: number) => `AdHostFrameToken${i}x`;
const slotToken = (i: number) => `AdSlotToken${i}x`;
/** A colour per slot that nothing else on the page paints: rgb(250, 3, i). */
const slotRgb = (i: number) => [250, 3, i] as const;

/** One element per selector, from the selector itself. */
function slotFor(selector: string, i: number): string {
  const [r, g, b] = slotRgb(i);
  const style = `style="display:block;width:300px;height:60px;background:rgb(${r},${g},${b})"`;
  const body = `<p>${slotToken(i)}</p>`;
  let m: RegExpExecArray | null;
  if ((m = /^([a-z]+)\.([\w-]+)$/.exec(selector)))
    return `<${m[1]} class="${m[2]}" ${style}>${body}</${m[1]}>`;
  if ((m = /^\.([\w-]+)$/.exec(selector)))
    return `<div class="${m[1]}" ${style}>${body}</div>`;
  if ((m = /^#([\w-]+)$/.exec(selector)))
    return `<div id="${m[1]}" ${style}>${body}</div>`;
  if ((m = /^\[id\^="([^"]+)"\]$/.exec(selector)))
    return `<div id="${m[1]}7" ${style}>${body}</div>`;
  if ((m = /^\[([\w-]+)\]$/.exec(selector)))
    return `<div ${m[1]}="x" ${style}>${body}</div>`;
  throw new Error(`the fixture cannot build ${selector}`);
}

const AD_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<h1>${ARTICLE}</h1>
${AD_HOSTS.map((host, i) => `<iframe width="300" height="80" src="https://ads.${host}/frame/${i}"></iframe>`).join("\n")}
<iframe width="300" height="80" src="https://widgets.friendly.example/frame"></iframe>
${AD_SELECTORS.map(slotFor).join("\n")}
<p>${ARTICLE} end</p>
</body></html>`;

const fetched: string[] = [];
const resolve: Resolve = async () => [{ address: "93.184.215.14", family: 4 }];
const fetch: PinnedFetch = async (url) => {
  fetched.push(url.href);
  let body = "";
  if (url.hostname === "public.example") body = AD_PAGE;
  else if (url.hostname === "widgets.friendly.example")
    body = `<p>${FRIEND}</p>`;
  else {
    const i = Number(url.pathname.split("/").pop());
    body = `<p>${adToken(i)}</p>`;
  }
  return {
    status: 200,
    rawHeaders: ["Content-Type", "text/html; charset=utf-8"],
    body: new TextEncoder().encode(body),
  };
};

async function readPdf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const doc = await task.promise;
  let text = "";
  const fills = new Set<string>();
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    text += (await page.getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    const ops = await page.getOperatorList();
    ops.fnArray.forEach((fn, k) => {
      if (fn === pdfjs.OPS.setFillRGBColor) {
        // pdf.js hands the colour as a "#rrggbb" string.
        const arg = ops.argsArray[k]?.[0];
        if (typeof arg === "string") fills.add(arg.toLowerCase());
      }
    });
  }
  await task.destroy();
  return { text: text.replace(/\s+/g, " "), fills };
}
const hex = (rgb: readonly number[]) =>
  `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

const work = mkdtempSync(path.join(tmpdir(), "pdfxyz-ads-"));
afterAll(() => {
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 10 });
  } catch {
    /* the OS temp cleaner owns it now */
  }
});

describe("the in-house ad lists (no Chromium needed)", () => {
  it("are small, in-house and non-empty (health check)", () => {
    expect(AD_HOSTS.length).toBeGreaterThanOrEqual(8);
    expect(AD_HOSTS.length).toBeLessThan(60);
    expect(AD_SELECTORS.length).toBeGreaterThanOrEqual(5);
  });

  it("a host and its subdomains match; a look-alike and a path do not", () => {
    expect(isAdRequestUrl("https://doubleclick.net/x")).toBe(true);
    expect(isAdRequestUrl("https://securepubads.g.doubleclick.net/x")).toBe(
      true,
    );
    expect(isAdRequestUrl("https://notdoubleclick.net/x")).toBe(false);
    expect(isAdRequestUrl("https://example.com/doubleclick.net")).toBe(false);
    expect(isAdRequestUrl("not a url")).toBe(false);
  });
});

describe.skipIf(!BIN)(
  `real Chromium: Hide common ads (${BIN ?? "no Chromium found"})`,
  () => {
    const runner = createNativeChromiumPdfRunner(
      {
        enabled: true,
        candidates: [BIN ?? "chromium"],
        overridden: true,
        timeoutMs: 60_000,
        maxInputBytes: 10 * 1024 * 1024,
        maxOutputBytes: 50 * 1024 * 1024,
        tmpDir: work,
      },
      { fileExists: () => true, network: { resolve, fetch } },
    );
    const render = async (o: Partial<WebpageCaptureOptions>) => {
      fetched.length = 0;
      const pdf = await runner.renderUrl(
        "https://public.example/ads",
        { ...DEFAULT_HTML_RENDER_OPTIONS, pageSize: "A4", viewport: "desktop" },
        {},
        { ...DEFAULT_WEBPAGE_CAPTURE_OPTIONS, ...o },
      );
      return { ...(await readPdf(pdf)), fetched: [...fetched] };
    };
    const adFetches = (list: string[]) =>
      list.filter((href) => isAdRequestUrl(href));

    it("CONTROL: without the option every ad host is fetched and every slot is painted", async () => {
      const { text, fills, fetched: got } = await render({});
      expect(adFetches(got)).toHaveLength(AD_HOSTS.length);
      expect(
        AD_HOSTS.map((_, i) => adToken(i)).filter((t) => !text.includes(t)),
      ).toEqual([]);
      expect(
        AD_SELECTORS.map((_, i) => hex(slotRgb(i))).filter(
          (c) => !fills.has(c),
        ),
      ).toEqual([]);
      expect(text).toContain(FRIEND);
    }, 90_000);

    it("with the option no ad host is fetched, no slot is painted, and the page stays", async () => {
      const { text, fills, fetched: got } = await render({ hideAds: true });
      expect(adFetches(got)).toEqual([]);
      expect(
        AD_HOSTS.map((_, i) => adToken(i)).filter((t) => text.includes(t)),
      ).toEqual([]);
      expect(
        AD_SELECTORS.map((_, i) => [AD_SELECTORS[i], hex(slotRgb(i))]).filter(
          ([, c]) => fills.has(c!),
        ),
      ).toEqual([]);
      expect(
        AD_SELECTORS.map((_, i) => slotToken(i)).filter((t) =>
          text.includes(t),
        ),
      ).toEqual([]);
      expect(text).toContain(ARTICLE);
      expect(text).toContain(`${ARTICLE} end`);
      // A non-ad host on the same page is untouched.
      expect(got.some((h) => h.includes("widgets.friendly.example"))).toBe(
        true,
      );
      expect(text).toContain(FRIEND);
    }, 90_000);
  },
);
