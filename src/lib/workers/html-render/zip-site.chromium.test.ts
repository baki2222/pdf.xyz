// @native-canvas
/**
 * THE POINT OF CONSUMPTION for HTML to PDF's two new inputs: the bytes a user
 * sends, through the REAL engine (`runHtmlToPdf`) and the production Chromium
 * runner, and the PDF read back with pdf.js (`../epub/proof`'s reader, which
 * reports each page's text, painted images and fill colours).
 *
 *   1. A ZIP of a page and its files prints WITH its stylesheet and its
 *      pictures. NEGATIVE CONTROL: the same page uploaded alone — the
 *      renderer's old and only path — must print with neither, so a pass
 *      cannot come from a reader that would have seen them anyway.
 *   2. A reference outside the archive is never served, and every request
 *      that is not at the document origin goes through the render network
 *      exactly as an upload's does (public http(s) only).
 *   3. Pasted text keeps its characters. The page's own script writes the
 *      code points it decoded as ASCII hex into the page, so what the PDF
 *      says about the charset does not depend on which fonts this machine
 *      has. NEGATIVE CONTROL: the same text without the paste box's
 *      byte-order mark, declaring windows-1252, must come back as mojibake.
 *
 * Runs wherever a Chromium exists (`findChromium`); SKIPPED, visibly, where
 * none does.
 */
import JSZip from "jszip";
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createNativeChromiumPdfRunner, resolveOnPath } from "./native";
import { findChromium } from "./test-chromium";
import { HTML_DOCUMENT_URL } from "./document-url";
import { runHtmlToPdf, type HtmlRenderDeps, type HtmlSite } from "./engine";
import type { PinnedFetch, Resolve } from "./network";
import { htmlDocumentContentType } from "./charset";
import { openHtmlZip } from "./zip-site";
import { pastedHtmlBytes } from "./pasted-html";
import { readEpubPdf } from "../epub/proof";
import { solidPng } from "@/tests/epub-fixtures";

const BIN = findChromium(resolveOnPath);
const PUBLIC = "https://assets.example/";

const work = mkdtempSync(path.join(tmpdir(), "pdfxyz-htmlzip-"));
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

const fetched: string[] = [];
const resolve: Resolve = async (host) => {
  if (host === new URL(PUBLIC).hostname)
    return [{ address: "93.184.215.14", family: 4 }];
  throw new Error("NXDOMAIN");
};
const fetch: PinnedFetch = async (url) => {
  fetched.push(url.toString());
  return {
    status: 404,
    rawHeaders: ["Content-Type", "text/plain"],
    body: new TextEncoder().encode("x"),
  };
};

const runner = createNativeChromiumPdfRunner(
  {
    enabled: true,
    candidates: [BIN ?? "chromium"],
    overridden: true,
    timeoutMs: 60_000,
    maxInputBytes: 20 * 1024 * 1024,
    maxOutputBytes: 50 * 1024 * 1024,
    tmpDir: work,
  },
  { fileExists: () => true, network: { resolve, fetch } },
);
const deps: HtmlRenderDeps = { chromium: runner };

const STYLED = "ZIPSTYLEDMARKER";
const PAGE = `<!doctype html><html><head>
<link rel="stylesheet" href="css/site.css">
</head><body>
<p class="styled">${STYLED}</p>
<img src="images/blue.png" alt="" style="width:96px;height:96px">
<div class="bg"></div>
<img src="../../outside.png" alt="" style="width:50px;height:50px">
<img src="%2e%2e/outside.png" alt="" style="width:50px;height:50px">
<img src="${PUBLIC}remote.png" alt="">
<img src="http://127.0.0.1/private.png" alt="">
</body></html>`;
const CSS = `.styled { color: rgb(200, 30, 90); font-size: 28px }
.bg { width: 80px; height: 80px; background-image: url(../images/green.png); background-size: cover }`;

async function siteZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("site/index.html", PAGE);
  zip.file("site/css/site.css", CSS);
  zip.file("site/images/blue.png", solidPng(24, [20, 120, 220]));
  zip.file("site/images/green.png", solidPng(24, [30, 200, 60]));
  // Outside the page's folder, and named to climb out of the archive: the
  // page's `../../outside.png` resolves (in Chromium, against the URL) to
  // the origin's root, where no entry of that exact name exists.
  zip.file("../outside.png", solidPng(24, [250, 0, 0]));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

const near = (a: readonly number[], b: readonly number[]) =>
  a.every((v, i) => Math.abs(v - b[i]!) <= 2);
/**
 * The archive's pictures, by their own size: every fixture PNG is 24x24.
 * Chromium paints a broken image too (its icon, at another size), so a bare
 * count of painted images would count the failures as well.
 */
const ours = (images: [number, number][][]) =>
  images.flat().filter(([w, h]) => w === 24 && h === 24).length;

describe.skipIf(!BIN)("a ZIP page through the real renderer", () => {
  it("prints the page WITH its stylesheet and pictures; the page alone prints neither", async () => {
    const run = await runHtmlToPdf(await siteZip(), deps);
    if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
    expect(run.meta.source).toBe("zip");
    const zipped = await readEpubPdf(run.output);
    expect(zipped.pages.join(" ")).toContain(STYLED);
    // The stylesheet's colour paints the text; its background-image and the
    // <img> are painted: exactly the two in-archive pictures (the outside
    // one is never served, see below).
    expect(zipped.fills.flat().some((rgb) => near(rgb, [200, 30, 90]))).toBe(
      true,
    );
    expect(ours(zipped.images)).toBe(2);

    // NEGATIVE CONTROL: the same page as one uploaded file.
    const alone = await runHtmlToPdf(new TextEncoder().encode(PAGE), deps);
    if (!alone.ok) throw new Error(`${alone.kind}: ${alone.message}`);
    expect(alone.meta.source).toBe("html");
    const single = await readEpubPdf(alone.output);
    expect(single.pages.join(" ")).toContain(STYLED);
    expect(single.fills.flat().some((rgb) => near(rgb, [200, 30, 90]))).toBe(
      false,
    );
    expect(ours(single.images)).toBe(0);
  }, 120_000);

  it("never serves a reference outside the archive; every other request goes to the render network as before", async () => {
    const opened = openHtmlZip(
      await siteZip(),
      undefined,
      htmlDocumentContentType,
    );
    if (!opened.ok) throw new Error(opened.refusal.kind);
    const answers: { url: string; served: boolean }[] = [];
    const tapped: HtmlSite = {
      ...opened.site,
      serve(url) {
        const hit = opened.site.serve(url);
        answers.push({ url, served: hit !== null });
        return hit;
      },
    };
    fetched.length = 0;
    const pdf = await runner.renderSite!(tapped);
    const reading = await readEpubPdf(pdf);

    const at = (p: string) =>
      answers.filter((a) => new URL(a.url).pathname === p);
    expect(at("/site/css/site.css")).toEqual([
      { url: `${HTML_DOCUMENT_URL}site/css/site.css`, served: true },
    ]);
    expect(at("/site/images/blue.png")[0]?.served).toBe(true);
    // `../../outside.png` from /site/index.html is /outside.png: asked for,
    // and answered 404 — the archive's `../outside.png` is never reachable.
    expect(at("/outside.png").length).toBeGreaterThan(0);
    expect(at("/outside.png").every((a) => !a.served)).toBe(true);
    // `%2e%2e/outside.png`: Chromium treats an encoded dot segment as `..`
    // (WHATWG URL), so it too lands on /outside.png, and is refused.
    expect(answers.some((a) => a.served && /outside/.test(a.url))).toBe(false);
    // The red picture never painted: exactly the two in-archive pictures.
    expect(ours(reading.images)).toBe(2);

    // Not at the origin: decided by the render network, exactly as before.
    expect(fetched).toContain(`${PUBLIC}remote.png`);
    expect(fetched.some((u) => u.includes("127.0.0.1"))).toBe(false);
    expect(answers.some((a) => !a.url.startsWith(HTML_DOCUMENT_URL))).toBe(
      false,
    );
  }, 120_000);
});

/** The page's script writes the code points it decoded, as hex, into the page. */
const PROBE = `<script>
const text = document.getElementById("t").textContent;
document.getElementById("hex").textContent =
  "CP" + Array.from(text).map((c) => c.codePointAt(0).toString(16)).join("-") + "END";
</script>`;
const SAMPLE = "বাংলা café \u{1F600}";
const HEX = Array.from(SAMPLE)
  .map((c) => c.codePointAt(0)!.toString(16))
  .join("-");

const hexOf = (pages: string[]) =>
  /CP([0-9a-f-]+)END/.exec(pages.join("").replace(/\s+/g, ""))?.[1] ?? null;

describe.skipIf(!BIN)("pasted HTML through the real renderer", () => {
  it("keeps Bengali, accents and emoji, even under a contrary <meta charset>", async () => {
    for (const head of ["", '<meta charset="windows-1252">']) {
      const html = `<!doctype html><html><head>${head}</head><body><p id="t">${SAMPLE}</p><p id="hex"></p>${PROBE}</body></html>`;
      const run = await runHtmlToPdf(pastedHtmlBytes(html), deps);
      if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
      const reading = await readEpubPdf(run.output);
      expect(hexOf(reading.pages), head || "no meta").toBe(HEX);
      // The glyphs, where a font for them is on this machine: Latin-1 always.
      expect(reading.pages.join(" ")).toContain("café");
    }
  }, 120_000);

  it("NEGATIVE CONTROL: the same bytes without the mark, declaring windows-1252, come back as mojibake", async () => {
    const html = `<!doctype html><html><head><meta charset="windows-1252"></head><body><p id="t">${SAMPLE}</p><p id="hex"></p>${PROBE}</body></html>`;
    const run = await runHtmlToPdf(new TextEncoder().encode(html), deps);
    if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
    const hex = hexOf((await readEpubPdf(run.output)).pages);
    expect(hex).not.toBeNull();
    expect(hex).not.toBe(HEX);
    // "é" read as windows-1252 is "Ã©": c3, a9.
    expect(hex).toContain("c3-a9");
  }, 120_000);
});

/**
 * A page that asks for ONE of its own files `n` times at once, each with a
 * query string (stripped when the entry is looked up), and prints how many
 * answers it got. Hostile review 2026-11-14: archive requests skipped the
 * render network's budgets entirely, so a 656 KB upload fetching one large
 * entry a few hundred times built that many copies of it in the worker's
 * heap and took the daemon down.
 */
const hammer = (n: number) => `<!doctype html><html><body><p id="out">WAIT</p>
<script>
Promise.allSettled(Array.from({ length: ${n} }, (_, i) =>
  fetch("data/blob.txt?" + i).then((r) => { if (!r.ok) throw new Error(); return r.text(); })))
  .then((all) => {
    const ok = all.filter((a) => a.status === "fulfilled").length;
    document.getElementById("out").textContent = "GOT" + ok + "OF${n}END";
  });
</script></body></html>`;

async function hammerZip(n: number, blobBytes: number): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("index.html", hammer(n));
  zip.file("data/blob.txt", "x".repeat(blobBytes));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Render `zip` with `limits`; what the page got, and what the origin was asked. */
async function hammered(
  zip: Uint8Array,
  limits?: import("./network").RenderNetworkLimits,
) {
  let originRequests = 0;
  const hammerRunner = createNativeChromiumPdfRunner(
    {
      enabled: true,
      candidates: [BIN ?? "chromium"],
      overridden: true,
      timeoutMs: 90_000,
      maxInputBytes: 20 * 1024 * 1024,
      maxOutputBytes: 50 * 1024 * 1024,
      tmpDir: work,
    },
    {
      fileExists: () => true,
      network: { resolve, fetch },
      ...(limits ? { networkLimits: limits } : {}),
      onRequest: ({ url }) => {
        if (url.startsWith(HTML_DOCUMENT_URL)) originRequests += 1;
      },
    },
  );
  const opened = openHtmlZip(zip, undefined, htmlDocumentContentType);
  if (!opened.ok) throw new Error(opened.refusal.kind);
  const reading = await readEpubPdf(
    await hammerRunner.renderSite!(opened.site),
  );
  const text = reading.pages.join("").replace(/\s+/g, "");
  const m = /GOT(\d+)OF(\d+)END/.exec(text);
  return { got: m ? Number(m[1]) : null, originRequests };
}

describe.skipIf(!BIN)(
  "a ZIP page's own files spend the render's budgets",
  () => {
    it("POSITIVE CONTROL: inside the budgets, every one of 40 answers arrives", async () => {
      const run = await hammered(await hammerZip(40, 1024));
      expect(run.got).toBe(40);
    }, 120_000);

    it("past the REAL request budget (500 per render, the page itself included), the rest are refused", async () => {
      const run = await hammered(await hammerZip(600, 64));
      // Health: the page really asked for all of them at the origin.
      expect(run.originRequests).toBeGreaterThanOrEqual(600);
      expect(run.got).toBe(499);
    }, 180_000);

    it("past the byte budget, the rest are refused: no more bytes reach the page than one render may spend", async () => {
      const run = await hammered(await hammerZip(30, 256 * 1024), {
        maxResponseBytes: 20 * 1024 * 1024,
        maxTotalBytes: 1024 * 1024,
        maxRequests: 500,
        requestTimeoutMs: 20_000,
      });
      expect(run.originRequests).toBeGreaterThanOrEqual(30);
      // 1 MiB, less the page itself, holds three 256 KiB answers and no fourth.
      expect(run.got).toBe(3);
    }, 120_000);

    // Hostile review round 2 (2026-11-14): archive answers skipped the
    // largest single response the network hands over, and a 76 MiB entry
    // hung the render to its timeout. One file ONE byte past
    // `maxResponseBytes` never reaches the page; one at it does.
    it("one archive answer past maxResponseBytes is refused, one at it arrives", async () => {
      const limits = {
        maxResponseBytes: 256 * 1024,
        maxTotalBytes: 100 * 1024 * 1024,
        maxRequests: 500,
        requestTimeoutMs: 20_000,
      };
      const at = await hammered(await hammerZip(1, 256 * 1024), limits);
      expect(at.got).toBe(1);
      const past = await hammered(await hammerZip(1, 256 * 1024 + 1), limits);
      // Health: it was asked for, and refused rather than never requested.
      expect(past.originRequests).toBeGreaterThanOrEqual(2);
      expect(past.got).toBe(0);
    }, 120_000);
  },
);
