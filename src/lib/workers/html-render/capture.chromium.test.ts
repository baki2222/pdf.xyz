// @native-canvas
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createNativeChromiumPdfRunner, resolveOnPath } from "./native";
import { findChromium } from "./test-chromium";
import { CONSENT_MANAGERS, CONSENT_SELECTORS } from "./overlays";
import { encodePng } from "@/lib/pdf/extract-images";
import type { PinnedFetch, Resolve } from "./network";
import { DEFAULT_HTML_RENDER_OPTIONS } from "@/lib/jobs/html-render-options";
import {
  DEFAULT_WEBPAGE_CAPTURE_OPTIONS,
  type WebpageCaptureOptions,
} from "@/lib/jobs/webpage-capture-options";

/**
 * Webpage to PDF's capture options, read back from the PDF a real Chromium
 * prints — the point of consumption, not the CDP call. Skipped (visibly)
 * where no Chromium exists.
 */
const BIN = findChromium(resolveOnPath);

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const doc = await task.promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    text += " ";
  }
  await task.destroy();
  return text.replace(/\s+/g, " ");
}

const work = mkdtempSync(path.join(tmpdir(), "pdfxyz-capture-"));
afterAll(() => {
  try {
    rmSync(work, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch {
    /* the OS temp cleaner owns it now */
  }
});

const ARTICLE = "Capture proof article body";
const CONSENT = "Consent tool banner text";
const POPUP = "Subscribe pop-up text";
const SHELL = "Fixed app shell article";

/** A OneTrust banner, a full-screen newsletter pop-up, and a scroll lock. */
const OVERLAY_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{overflow:hidden;height:100%}
#pop{position:fixed;inset:0;background:rgba(0,0,0,.6)}
#onetrust-consent-sdk{position:fixed;bottom:0;left:0;right:0;height:60px}</style>
</head><body><h1>${ARTICLE}</h1>
<div style="height:3000px"></div><p>Below the fold ${ARTICLE} end</p>
<div id="pop"><div>${POPUP}</div></div>
<div id="onetrust-consent-sdk"><p>${CONSENT}</p></div>
</body></html>`;

/** A site whose whole layout is a fixed full-screen frame: never hidden. */
const SHELL_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><div style="position:fixed;inset:0;overflow:auto"><main><h1>${SHELL}</h1>
</main></div></body></html>`;

/**
 * One element per selector of every listed consent tool, each holding its
 * own token: the corpus is the list itself, so a tool added to it is
 * exercised here, and a selector that matches nothing it claims fails.
 */
const elementFor = (selector: string, token: string) => {
  const prefix = /^\[id\^="([^"]+)"\]$/.exec(selector);
  const attrs = prefix
    ? `id="${prefix[1]}42"`
    : selector.startsWith("#")
      ? `id="${selector.slice(1)}"`
      : `class="${selector.slice(1)}"`;
  if (!prefix && !/^[#.][\w-]+$/.test(selector))
    throw new Error(`the fixture cannot build ${selector}`);
  return `<div ${attrs}><p>${token}</p></div>`;
};
const consentToken = (i: number) => `ConsentFixtureToken${i}x`;
const CONSENT_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><h1>${ARTICLE}</h1>${CONSENT_SELECTORS.map((sel, i) => elementFor(sel, consentToken(i))).join("")}</body></html>`;

/** Words only print media shows, and words only screen media shows. */
const PRINT_ONLY = "Print stylesheet only words";
const SCREEN_ONLY = "Screen layout only words";
const MEDIA_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
@media print { .screen-only { display: none } }
@media screen { .print-only { display: none } }
</style></head><body><h1>${ARTICLE}</h1>
<p class="print-only">${PRINT_ONLY}</p><p class="screen-only">${SCREEN_ONLY}</p>
</body></html>`;

/**
 * Two images far below the first screen, each loaded only once it is
 * scrolled to: one by an IntersectionObserver, one by a scroll handler —
 * the two patterns audit webpage-to-pdf#4 found printing as blank boxes.
 * Each also writes a word, so the text shows WHICH loader ran.
 */
const OBSERVED_WORD = "Observer loaded words";
const SCROLLED_WORD = "Scroll handler loaded words";
const LAZY_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><h1>${ARTICLE}</h1><div style="height:2600px"></div>
<img id="io" width="40" height="40" alt=""><p id="io-out"></p>
<div style="height:1600px"></div>
<img id="sc" width="40" height="40" alt=""><p id="sc-out"></p>
<script>
new IntersectionObserver((entries, obs) => {
  for (const e of entries) if (e.isIntersecting) {
    io.src = "/observed.png"; document.getElementById("io-out").textContent = "${OBSERVED_WORD}";
    obs.disconnect();
  }
}).observe(io);
addEventListener("scroll", function onScroll() {
  if (sc.getBoundingClientRect().top < innerHeight) {
    sc.src = "/scrolled.png"; document.getElementById("sc-out").textContent = "${SCROLLED_WORD}";
    removeEventListener("scroll", onScroll);
  }
});
</script></body></html>`;
const PNG = encodePng(2, 2, "rgb8", new Uint8Array(12).fill(200));
const fetched: string[] = [];

/** How many images a PDF's pages paint. */
async function pdfImageCount(bytes: Uint8Array): Promise<number> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const doc = await task.promise;
  let count = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const ops = await (await doc.getPage(i)).getOperatorList();
    count += ops.fnArray.filter(
      (fn) => fn === pdfjs.OPS.paintImageXObject,
    ).length;
  }
  await task.destroy();
  return count;
}

/** Headings for the outline, and a <title> that must never be stamped. */
const STAMP_TITLE = "Stamp proof title only in head";
const HEADINGS_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<title>${STAMP_TITLE}</title></head><body>
<h1>Outline first heading</h1><p>${ARTICLE}</p>
<h2>Outline second heading</h2><p>More text</p>
<h2>Outline third heading</h2><p>Last text</p></body></html>`;

/** The PDF's bookmark titles, depth-first. */
async function pdfOutline(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const doc = await task.promise;
  const out: string[] = [];
  const walk = (items: { title: string; items: unknown[] }[] | null) => {
    for (const item of items ?? []) {
      out.push(item.title);
      walk(item.items as { title: string; items: unknown[] }[]);
    }
  };
  walk((await doc.getOutline()) as { title: string; items: unknown[] }[]);
  await task.destroy();
  return out;
}

const pages: Record<string, string> = {
  "/overlay": OVERLAY_PAGE,
  "/shell": SHELL_PAGE,
  "/consent": CONSENT_PAGE,
  "/media": MEDIA_PAGE,
  "/lazy": LAZY_PAGE,
  "/headings": HEADINGS_PAGE,
};

const resolve: Resolve = async (host) => {
  if (host === "public.example")
    return [{ address: "93.184.215.14", family: 4 }];
  throw new Error("NXDOMAIN");
};
const fetch: PinnedFetch = async (url) => {
  fetched.push(url.pathname);
  if (url.pathname.endsWith(".png"))
    return {
      status: 200,
      rawHeaders: ["Content-Type", "image/png"],
      body: PNG,
    };
  const page = pages[url.pathname];
  if (page === undefined)
    return { status: 404, rawHeaders: [], body: new Uint8Array() };
  return {
    status: 200,
    rawHeaders: ["Content-Type", "text/html; charset=utf-8"],
    body: new TextEncoder().encode(page),
  };
};

const capture = (o: Partial<WebpageCaptureOptions>): WebpageCaptureOptions => ({
  ...DEFAULT_WEBPAGE_CAPTURE_OPTIONS,
  ...o,
});

describe.skipIf(!BIN)(
  `real Chromium capture options (${BIN ?? "no Chromium found"})`,
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
    const render = async (
      pathname: string,
      o: Partial<WebpageCaptureOptions>,
    ) =>
      pdfText(
        await runner.renderUrl(
          `https://public.example${pathname}`,
          DEFAULT_HTML_RENDER_OPTIONS,
          {},
          capture(o),
        ),
      );

    // POSITIVE CONTROL: by default the banner and the pop-up are printed and
    // the scroll lock cuts the page at the first screen — the detector below
    // can see each thing it later says is gone.
    it("by default prints the consent banner and the pop-up, cut at the first screen", async () => {
      const text = await render("/overlay", {});
      expect(text).toContain(ARTICLE);
      expect(text).toContain(CONSENT);
      expect(text).toContain(POPUP);
      expect(text).not.toContain(`Below the fold ${ARTICLE} end`);
    }, 90_000);

    it("Hide cookie notices and pop-ups removes both and prints the whole page", async () => {
      const text = await render("/overlay", { hideOverlays: true });
      expect(text).toContain(ARTICLE);
      expect(text).not.toContain(CONSENT);
      expect(text).not.toContain(POPUP);
      expect(text).toContain(`Below the fold ${ARTICLE} end`);
    }, 90_000);

    it("every listed consent tool's container is hidden — and printed without the option", async () => {
      expect(CONSENT_SELECTORS.length).toBeGreaterThanOrEqual(
        CONSENT_MANAGERS.length,
      );
      const tokens = CONSENT_SELECTORS.map((_, i) => consentToken(i));
      const shown = await render("/consent", {});
      expect(tokens.filter((t) => !shown.includes(t))).toEqual([]);
      const hidden = await render("/consent", { hideOverlays: true });
      expect(hidden).toContain(ARTICLE);
      expect(
        tokens
          .map((t, i) => [t, CONSENT_SELECTORS[i]])
          .filter(([t]) => hidden.includes(t!)),
      ).toEqual([]);
    }, 90_000);

    // audit webpage-to-pdf#3. The default is the control: print media.
    it("prints with the site's print styles by default, and with its screen styles when that is unticked", async () => {
      const print = await render("/media", {});
      expect(print).toContain(PRINT_ONLY);
      expect(print).not.toContain(SCREEN_ONLY);
      const screen = await render("/media", { printStyles: false });
      expect(screen).toContain(ARTICLE);
      expect(screen).toContain(SCREEN_ONLY);
      expect(screen).not.toContain(PRINT_ONLY);
    }, 90_000);

    it("one long page measures and prints the screen styles too", async () => {
      const bytes = await runner.renderUrl(
        "https://public.example/media",
        { ...DEFAULT_HTML_RENDER_OPTIONS, onePage: true },
        {},
        capture({ printStyles: false }),
      );
      const text = await pdfText(bytes);
      expect(text).toContain(SCREEN_ONLY);
      expect(text).not.toContain(PRINT_ONLY);
    }, 90_000);

    // audit webpage-to-pdf#4: images loaded on scroll, by either pattern.
    it("images a page loads only when scrolled to are fetched and printed", async () => {
      fetched.length = 0;
      const bytes = await runner.renderUrl("https://public.example/lazy");
      const text = await pdfText(bytes);
      expect(text).toContain(ARTICLE);
      expect(text).toContain(OBSERVED_WORD);
      expect(text).toContain(SCROLLED_WORD);
      expect(fetched).toEqual(
        expect.arrayContaining(["/observed.png", "/scrolled.png"]),
      );
      expect(await pdfImageCount(bytes)).toBe(2);
    }, 90_000);

    // audit webpage-to-pdf#7: bookmarks from the page's headings, always.
    it("a webpage's PDF has bookmarks from its headings", async () => {
      const bytes = await runner.renderUrl("https://public.example/headings");
      expect(await pdfOutline(bytes)).toEqual([
        "Outline first heading",
        "Outline second heading",
        "Outline third heading",
      ]);
    }, 90_000);

    // audit webpage-to-pdf#7: the address and date, only when asked for.
    // The default render is the control: neither is printed.
    it("Add the address and date prints the address asked for and the capture time in UTC, and never the title", async () => {
      const sourceUrl = "https://public.example/headings";
      const plain = await pdfText(await runner.renderUrl(sourceUrl));
      expect(plain).not.toContain("public.example");
      expect(plain).not.toMatch(/\bUTC\b/);
      for (const layout of [
        DEFAULT_HTML_RENDER_OPTIONS,
        { ...DEFAULT_HTML_RENDER_OPTIONS, margin: "none" as const },
        { ...DEFAULT_HTML_RENDER_OPTIONS, onePage: true },
      ]) {
        const text = await pdfText(
          await runner.renderUrl(
            sourceUrl,
            layout,
            {},
            capture({ stamp: true }),
          ),
        );
        expect(text, JSON.stringify(layout)).toContain(ARTICLE);
        expect(text, JSON.stringify(layout)).toContain(sourceUrl);
        expect(text, JSON.stringify(layout)).toMatch(
          /\b\d{1,2} [A-Z][a-z]+ \d{4}, \d{2}:\d{2} UTC\b/,
        );
        expect(text).not.toContain(STAMP_TITLE);
      }
    }, 120_000);

    it("never hides a fixed full-screen frame that holds the page's main content", async () => {
      const text = await render("/shell", { hideOverlays: true });
      expect(text).toContain(SHELL);
    }, 90_000);
  },
);
