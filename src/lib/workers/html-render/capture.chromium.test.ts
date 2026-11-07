// @native-canvas
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createNativeChromiumPdfRunner, resolveOnPath } from "./native";
import { findChromium } from "./test-chromium";
import { CONSENT_MANAGERS, CONSENT_SELECTORS } from "./overlays";
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

const pages: Record<string, string> = {
  "/overlay": OVERLAY_PAGE,
  "/shell": SHELL_PAGE,
  "/consent": CONSENT_PAGE,
};

const resolve: Resolve = async (host) => {
  if (host === "public.example")
    return [{ address: "93.184.215.14", family: 4 }];
  throw new Error("NXDOMAIN");
};
const fetch: PinnedFetch = async (url) => {
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

    it("never hides a fixed full-screen frame that holds the page's main content", async () => {
      const text = await render("/shell", { hideOverlays: true });
      expect(text).toContain(SHELL);
    }, 90_000);
  },
);
