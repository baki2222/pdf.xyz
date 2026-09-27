// @vitest-environment jsdom
/**
 * THE COMPOSED CHAIN for the "linked files are missing" note: what the
 * browser-side scan TELLS the user, against what the real renderer DOES.
 *
 * The scan (`findUnbundledAssets`) runs on the user's machine before upload;
 * the render runs on the worker afterwards. Each can be right about itself and
 * the two still disagree — a note for a file that would have loaded, or
 * silence for one that will not. So every assertion here puts the SAME page
 * through both: the scan over jsdom's DOM (the browser's DOMParser in
 * production), the render through a real Chromium and the real render network.
 *
 * WHAT CHROMIUM ASKED FOR is read from the runner's `onRequest` tap, which
 * sees every request BEFORE the policy decides it. A reference that resolves
 * against the upload's own address is refused before any fetch seam could
 * record it, so the tap is the only place the renderer's real configuration
 * (no `<base>`, the upload's own origin) shows what it tried to load.
 *
 * TWO CORPORA, on purpose:
 *   - `ASSET_SOURCES`' own samples prove every table entry is something
 *     Chromium fetches (no entry is decoration). They CANNOT prove the table
 *     is complete: a page built from the table only fetches what the table
 *     already names. History: this file used to claim "no element kind is a
 *     hole" from that corpus alone. A review then rendered <feImage>,
 *     <video src>, <audio src> and a bare-string `image-set()` through the
 *     same renderer; Chromium fetched all four and the scan reported none.
 *   - `FETCHING_FORMS` and `SAVED_PAGE` are written from the HTML, SVG and
 *     CSS specs and from what a browser's "Save page as" writes — never from
 *     `ASSET_SOURCES` — and every sub-resource Chromium fetches from them must
 *     be reported, or be on `NON_PRINTING` with its reason.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as TS from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { HTML_DOCUMENT_URL } from "./document-url";
import { createNativeChromiumPdfRunner, resolveOnPath } from "./native";
import type { PinnedFetch, Resolve } from "./network";
import { findChromium } from "./test-chromium";
import { ASSET_SOURCES, findUnbundledAssets } from "./unbundled-assets";

const BIN = findChromium(resolveOnPath);
const PUBLIC = "https://assets.example/";
const SERVED_HOST = new URL(HTML_DOCUMENT_URL).host;

const work = mkdtempSync(path.join(tmpdir(), "pdfxyz-assets-"));
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

const tapped: string[] = [];
const fetched: string[] = [];
const resolve: Resolve = async (host) => {
  if (host === new URL(PUBLIC).hostname)
    return [{ address: "93.184.215.14", family: 4 }];
  throw new Error("NXDOMAIN");
};
const fetch: PinnedFetch = async (url) => {
  fetched.push(url.toString());
  return {
    status: 200,
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
    maxInputBytes: 10 * 1024 * 1024,
    maxOutputBytes: 50 * 1024 * 1024,
    tmpDir: work,
  },
  {
    fileExists: () => true,
    network: { resolve, fetch },
    onRequest: (request) => tapped.push(request.url),
  },
);

const withoutHash = (url: string) => url.split("#")[0]!;

/** Render; return what Chromium asked for at the upload's own address, and what the network fetched. */
async function render(
  html: string,
): Promise<{ served: string[]; fetched: string[] }> {
  tapped.length = 0;
  fetched.length = 0;
  await runner.renderHtml(new TextEncoder().encode(html));
  const served = new Set(
    tapped
      .filter((u) => new URL(u).host === SERVED_HOST)
      .map((u) => withoutHash(u)),
  );
  return { served: [...served], fetched: [...fetched] };
}

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

/** The scan's references, as the absolute URLs Chromium would ask for. */
function reportedUrls(html: string): string[] {
  return findUnbundledAssets(parse(html)).references.map((r) =>
    withoutHash(new URL(r, HTML_DOCUMENT_URL).toString()),
  );
}

/*
 * THE SCAN WHERE IT RUNS. In production the scan runs in the user's browser,
 * over the browser's DOMParser — not jsdom's. The two differ: jsdom's
 * `element.matches("svg feImage")` is false for the element its own
 * `querySelectorAll("svg feImage")` returns. So the module is loaded, as
 * shipped, into a Chromium page, run over the same corpora, and its answer
 * read back off the wire (an image request the tap sees).
 *
 * The module graph is WALKED from `unbundled-assets.ts`, not listed; an import
 * that is not a sibling module is fatal, because a page with no bundler
 * cannot load it and the result would fail for the wrong reason.
 */
const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const SCAN_RESULT = `${HTML_DOCUMENT_URL}__scan-result`;

function moduleGraph(entry: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (name: string) => {
    if (name in out) return;
    const file = path.join(__dirname, `${name.replace(/^\.\//, "")}.ts`);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    out[name] = code;
    for (const m of code.matchAll(/require\("([^"]+)"\)/g)) {
      if (!/^\.\/[\w-]+$/.test(m[1]!))
        throw new Error(
          `${name} imports ${m[1]}, which a bare page cannot load`,
        );
      visit(m[1]!);
    }
  };
  visit(entry);
  return out;
}

/** A page that runs the shipped scan over each input and reports back. */
function scanInChromiumPage(inputs: string[]): string {
  // `<` escaped everywhere: the inputs carry `</script>` and `<!--`.
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  return `<!doctype html><html><body><p>scan</p><script>
const SOURCES = ${json(moduleGraph("./unbundled-assets"))};
const cache = {};
function load(name) {
  if (cache[name]) return cache[name].exports;
  const module = (cache[name] = { exports: {} });
  new Function("exports", "require", "module", SOURCES[name])(module.exports, load, module);
  return module.exports;
}
const scan = load("./unbundled-assets").findUnbundledAssetsInHtml;
const answers = ${json(inputs)}.map((html) => scan(html).references);
new Image().src = ${json(SCAN_RESULT)} + "?" + encodeURIComponent(JSON.stringify(answers));
</script></body></html>`;
}

async function scanInChromium(inputs: string[]): Promise<string[][]> {
  tapped.length = 0;
  await runner.renderHtml(new TextEncoder().encode(scanInChromiumPage(inputs)));
  const hit = tapped.find((u) => u.startsWith(`${SCAN_RESULT}?`));
  if (!hit) throw new Error("the in-page scan never reported back");
  return JSON.parse(
    decodeURIComponent(hit.slice(SCAN_RESULT.length + 1)),
  ) as string[][];
}

const page = (body: string, head = "") =>
  `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>
<h1>Asset scan proof</h1>
${body}
</body></html>`;

/*
 * One element or rule per way a page makes Chromium fetch something, written
 * from the specs — NOT from ASSET_SOURCES. Each must make Chromium fetch its
 * reference (a form Chromium ignores tests nothing, so the health check below
 * fails on it).
 */
const FETCHING_FORMS: Record<string, (u: string) => string> = {
  img: (u) => `<img src="${u}" alt="">`,
  imgSrcset: (u) => `<img srcset="${u} 1x" alt="">`,
  imgLazy: (u) => `<img loading="lazy" src="${u}" alt="">`,
  imgDisplayNone: (u) => `<img style="display:none" src="${u}" alt="">`,
  pictureSource: (u) => `<picture><source srcset="${u}"><img alt=""></picture>`,
  inputImage: (u) => `<input type="image" src="${u}" alt="">`,
  videoPoster: (u) => `<video poster="${u}"></video>`,
  videoSrc: (u) => `<video src="${u}"></video>`,
  videoSource: (u) => `<video><source src="${u}" type="video/mp4"></video>`,
  audioSrc: (u) => `<audio src="${u}" controls></audio>`,
  audioSource: (u) => `<audio controls><source src="${u}"></audio>`,
  trackDefault: (u) =>
    `<video><track default kind="captions" src="${u}"></video>`,
  trackCrossOrigin: (u) =>
    `<video><track default kind="captions" crossorigin="anonymous" src="${u}"></video>`,
  iframe: (u) => `<iframe src="${u}"></iframe>`,
  iframeLazy: (u) => `<iframe loading="lazy" src="${u}"></iframe>`,
  iframeSrcdoc: (u) => `<iframe srcdoc="<img src='${u}' alt=''>"></iframe>`,
  embed: (u) => `<embed src="${u}" type="image/png">`,
  object: (u) => `<object data="${u}" type="image/png"></object>`,
  tableBackground: (u) =>
    `<table background="${u}"><tr><td>x</td></tr></table>`,
  linkStylesheet: (u) => `<link rel="stylesheet" href="${u}">`,
  linkAlternateStylesheet: (u) =>
    `<link rel="alternate stylesheet" title="alt" href="${u}">`,
  linkPrintStylesheet: (u) =>
    `<link rel="stylesheet" media="print" href="${u}">`,
  linkPreloadImage: (u) => `<link rel="preload" as="image" href="${u}">`,
  linkPreloadFont: (u) =>
    `<link rel="preload" as="font" crossorigin href="${u}">`,
  linkPreloadStyle: (u) => `<link rel="preload" as="style" href="${u}">`,
  linkPrefetch: (u) => `<link rel="prefetch" href="${u}">`,
  linkModulepreload: (u) => `<link rel="modulepreload" href="${u}">`,
  script: (u) => `<script src="${u}"></script>`,
  scriptModule: (u) => `<script type="module" src="${u}"></script>`,
  svgImage: (u) =>
    `<svg width="10" height="10"><image href="${u}" width="10" height="10"/></svg>`,
  svgImageXlink: (u) =>
    `<svg width="10" height="10"><image xlink:href="${u}" width="10" height="10"/></svg>`,
  svgPatternImage: (u) =>
    `<svg width="10" height="10"><defs><pattern id="p1" width="10" height="10" patternUnits="userSpaceOnUse"><image href="${u}" width="10" height="10"/></pattern></defs><rect width="10" height="10" fill="url(#p1)"/></svg>`,
  svgUse: (u) => `<svg width="10" height="10"><use href="${u}#i"/></svg>`,
  svgUseXlink: (u) =>
    `<svg width="10" height="10"><use xlink:href="${u}#i"/></svg>`,
  svgFeImage: (u) =>
    `<svg width="10" height="10"><filter id="fe1"><feImage href="${u}"/></filter><rect width="10" height="10" filter="url(#fe1)"/></svg>`,
  svgFeImageXlink: (u) =>
    `<svg width="10" height="10"><filter id="fe2"><feImage xlink:href="${u}"/></filter><rect width="10" height="10" filter="url(#fe2)"/></svg>`,
  svgScript: (u) => `<svg><script href="${u}"></script></svg>`,
  svgFilterAttribute: (u) =>
    `<svg width="10" height="10"><rect width="10" height="10" filter="url(${u}#f)"/></svg>`,
  svgMaskAttribute: (u) =>
    `<svg width="10" height="10"><rect width="10" height="10" mask="url(${u}#m)"/></svg>`,
  svgClipPathAttribute: (u) =>
    `<svg width="10" height="10"><rect width="10" height="10" clip-path="url(${u}#c)"/></svg>`,
  svgMarkerAttribute: (u) =>
    `<svg width="10" height="10"><path d="M0 0L10 10" stroke="red" marker-end="url(${u}#m)"/></svg>`,
  svgStyleFill: (u) =>
    `<svg width="10" height="10"><style>rect.sf{fill:url(${u}#g)}</style><rect class="sf" width="10" height="10"/></svg>`,
  cssBackgroundImage: (u) =>
    `<div style="width:10px;height:10px;background-image:url('${u}')"></div>`,
  cssBackgroundShorthand: (u) =>
    `<div style="width:10px;height:10px;background:url(${u}) no-repeat"></div>`,
  cssUppercaseUrl: (u) =>
    `<div style="width:10px;height:10px;background-image:URL('${u}')"></div>`,
  cssEscapedUrl: (u) =>
    `<div style="width:10px;height:10px;background-image:u\\72l('${u}')"></div>`,
  cssCustomProperty: (u) =>
    `<div style="--bg:url(${u});width:10px;height:10px;background-image:var(--bg)"></div>`,
  cssListStyleImage: (u) =>
    `<ul style="list-style-image:url('${u}')"><li>x</li></ul>`,
  cssBorderImage: (u) =>
    `<div style="width:10px;height:10px;border:5px solid;border-image-source:url('${u}')"></div>`,
  cssContent: (u) =>
    `<style>.cc::before{content:url("${u}")}</style><div class="cc"></div>`,
  cssCursor: (u) => `<div style="cursor:url('${u}'),auto">x</div>`,
  cssMaskImage: (u) =>
    `<div style="width:10px;height:10px;background:red;mask-image:url('${u}')"></div>`,
  cssFilter: (u) =>
    `<div style="width:10px;height:10px;background:red;filter:url('${u}#f')"></div>`,
  cssClipPath: (u) =>
    `<div style="width:10px;height:10px;background:red;clip-path:url('${u}#c')"></div>`,
  cssShapeOutside: (u) =>
    `<div style="float:left;width:10px;height:10px;shape-outside:url('${u}')"></div>`,
  cssStyleBlock: (u) =>
    `<style>.sb{width:10px;height:10px;background-image:url(${u})}</style><div class="sb"></div>`,
  cssFontFace: (u) =>
    `<style>@font-face{font-family:Probe;src:url("${u}")}.ff{font-family:Probe}</style><p class="ff">font</p>`,
  cssImportString: (u) => `<style>@import "${u}";</style>`,
  cssImportUrl: (u) => `<style>@import url(${u});</style>`,
  cssImportMedia: (u) => `<style>@import url("${u}") print;</style>`,
  cssImportLayer: (u) => `<style>@import url("${u}") layer(base);</style>`,
  cssImageSetString: (u) =>
    `<div style="width:10px;height:10px;background-image:image-set('${u}' 1x)"></div>`,
  cssWebkitImageSetString: (u) =>
    `<div style="width:10px;height:10px;background-image:-webkit-image-set('${u}' 1x)"></div>`,
  cssImageSetType: (u) =>
    `<div style="width:10px;height:10px;background-image:image-set('${u}' type('image/png'))"></div>`,
  cssImageSetUrl: (u) =>
    `<div style="width:10px;height:10px;background-image:image-set(url('${u}') 1x)"></div>`,
  cssImageSetCandidates: (u) =>
    `<style>.is{width:10px;height:10px;background-image:image-set("${u}" 1x, "data:image/png;base64,AA" 2x)}</style><div class="is"></div>`,
};

/*
 * Fetches that cannot change the printed page, so the scan need not report
 * them. Each is still in FETCHING_FORMS, so each must still be fetched — an
 * allowance for something Chromium never asks for would be decoration.
 */
const NON_PRINTING: Record<string, string> = {
  linkPreloadImage:
    "a resource hint: the <img> or rule that USES the file is its own reference, and that is what the scan reports",
  linkPreloadFont: "a resource hint (as above): the @font-face is reported",
  linkPreloadStyle:
    "a resource hint (as above): preloading a stylesheet does not apply it",
  linkPrefetch: "a hint for a LATER navigation; this page never uses it",
  linkModulepreload: "a resource hint (as above): the <script> is reported",
};

const FORM_NAMES = Object.keys(FETCHING_FORMS);
const formUrl = (name: string) => `c/${name}.bin`;
const FORMS_PAGE = page(
  FORM_NAMES.map((n) => FETCHING_FORMS[n]!(formUrl(n))).join("\n"),
);
const formOf = (url: string) =>
  /\/c\/([A-Za-z]+)\.bin$/.exec(new URL(url).pathname)?.[1];

/*
 * A page as a browser's "Save page as… (complete)" writes it: references
 * rewritten to a sibling `<title>_files/` folder the user never uploads,
 * mixed with what must stay quiet (absolute URLs, data:, fragments, mailto:).
 * `https://assets.example/partner.png` is the positive control: public, so
 * the renderer fetches it and the scan must not name it.
 */
const SAVED_PAGE = `<!DOCTYPE html>
<!-- saved from url=(0040)https://www.example.com/reports/q3-2026 -->
<html lang="en"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Q3 report – Example Co.</title>
<link rel="icon" href="https://www.example.com/favicon.ico">
<link rel="preconnect" href="https://fonts.gstatic.com">
<link rel="stylesheet" href="./Q3 report_files/css2" media="all">
<link rel="stylesheet" href="./Q3 report_files/main.3f2a1c.css">
<link rel="preload" as="image" href="./Q3 report_files/hero.jpg">
<style>
  @font-face { font-family: "Brand"; src: url("./Q3 report_files/brand.woff2") format("woff2"); }
  body { font-family: "Brand", sans-serif; }
  .hero { min-height: 80px; background: #111 url(./Q3%20report_files/hero-bg.jpg) center/cover; }
  .ticks { list-style-image: url('./Q3 report_files/tick.svg'); }
  .card { width: 60px; height: 40px; background-image: image-set("./Q3 report_files/card.webp" 1x, "./Q3 report_files/card@2x.webp" 2x); }
</style>
<script async src="./Q3 report_files/analytics.js"></script>
</head>
<body class="post">
<header id="top"><a href="https://www.example.com/"><img src="./Q3 report_files/logo.svg" alt="Example Co." width="120"></a>
<nav><a href="https://www.example.com/reports">Reports</a></nav></header>
<main>
<section class="hero"><h1>Q3 report</h1></section>
<img class="hero-img" src="./Q3 report_files/hero.jpg" alt="Our new office">
<img srcset="./Q3%20report_files/team-480.jpg 480w, ./Q3%20report_files/team-960.jpg 960w" sizes="480px" alt="The team">
<figure><iframe src="./Q3 report_files/saved_resource.html" width="320" height="180" title="Embedded video"></iframe></figure>
<ul class="ticks"><li>Revenue up</li><li>Costs down</li></ul>
<div class="card"></div>
<p style="background-image:url(&quot;./Q3 report_files/quote-bg.png&quot;)">A quote.</p>
<svg class="icon" width="24" height="24" aria-hidden="true"><use href="./Q3 report_files/sprite.svg#share"></use></svg>
<video poster="./Q3 report_files/intro-poster.jpg" controls width="320"><source src="./Q3 report_files/intro.mp4" type="video/mp4"></video>
<img src="https://assets.example/partner.png" alt="Partner">
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="">
</main>
<footer><a href="#top">Back to top</a> · <a href="mailto:ir@example.com">Investor relations</a></footer>
<script src="./Q3 report_files/app.8c1d.js"></script>
</body></html>`;

/** Table corpus: one relative reference per ASSET_SOURCES entry. */
const REFS = ASSET_SOURCES.map((_, i) => `assets/ref-${i}.bin`);
const TABLE_BODY = ASSET_SOURCES.map((s, i) => s.sample(REFS[i]!)).join("\n");
const TABLE_PAGE = page(TABLE_BODY);
const PUBLIC_BASE = `<base href="${PUBLIC}">`;
const TABLE_WITH_BASE = page(TABLE_BODY, PUBLIC_BASE);
const FORMS_WITH_BASE = page(
  FORM_NAMES.map((n) => FETCHING_FORMS[n]!(formUrl(n))).join("\n"),
  PUBLIC_BASE,
);

describe.skipIf(!BIN)(
  `asset scan vs the real renderer (${BIN ?? "no Chromium found"})`,
  () => {
    // Health checks: a corpus that shrank would pass everything below.
    it("each corpus is complete and big enough to mean something", () => {
      expect(new Set(REFS).size).toBe(ASSET_SOURCES.length);
      expect(ASSET_SOURCES.length).toBeGreaterThanOrEqual(10);
      expect(FORM_NAMES.length).toBeGreaterThanOrEqual(60);
      // Every allowance names a form that exists — a typo is not an allowance.
      expect(
        Object.keys(NON_PRINTING).filter((n) => !FORM_NAMES.includes(n)),
      ).toEqual([]);
    });

    /*
     * No table entry is decoration: each sample, in the renderer's real
     * configuration, makes Chromium ask for its reference at the upload's
     * address — and the scan reports exactly those references.
     */
    it("every ASSET_SOURCES sample is a reference Chromium asks for, and the scan reports it", async () => {
      const { served } = await render(TABLE_PAGE);
      const expected = REFS.map((r) => new URL(r, HTML_DOCUMENT_URL).href);
      const unfetched = ASSET_SOURCES.filter(
        (_, i) => !served.includes(expected[i]!),
      ).map((s) => s.selector);
      expect(unfetched).toEqual([]);
      expect([...reportedUrls(TABLE_PAGE)].sort()).toEqual(
        [...expected].sort(),
      );
    }, 90_000);

    /*
     * No element kind is a hole, over a corpus the table did not write:
     * everything Chromium asks for at the upload's address is reported, or
     * allowed as non-printing with a reason.
     */
    it("every form Chromium fetches from the spec corpus is reported, or allowed with a reason", async () => {
      const { served } = await render(FORMS_PAGE);
      // Every form exercised: one Chromium ignores would assert nothing.
      const ignored = FORM_NAMES.filter(
        (n) => !served.includes(new URL(formUrl(n), HTML_DOCUMENT_URL).href),
      );
      expect(ignored).toEqual([]);
      // Nothing else was asked for — every served request maps to a form.
      expect(served.filter((u) => formOf(u) === undefined)).toEqual([]);

      const reported = reportedUrls(FORMS_PAGE);
      const holes = served
        .filter((u) => !reported.includes(u))
        .map((u) => formOf(u)!)
        .filter((n) => !(n in NON_PRINTING));
      expect(holes).toEqual([]);
    }, 90_000);

    it("a saved-page export: every file Chromium asks for from its _files folder is reported", async () => {
      const { served, fetched: gotPublic } = await render(SAVED_PAGE);
      // Health: this is a real export's worth of sub-resources, not two.
      expect(served.length).toBeGreaterThanOrEqual(15);
      const reported = reportedUrls(SAVED_PAGE);
      expect(served.filter((u) => !reported.includes(u))).toEqual([]);
      // Positive control: the public reference loads, and is not named.
      expect(gotPublic).toContain(`${PUBLIC}partner.png`);
      expect(findUnbundledAssets(parse(SAVED_PAGE)).references).not.toContain(
        `${PUBLIC}partner.png`,
      );
    }, 90_000);

    /*
     * Behind a public <base>, every relative reference points somewhere the
     * renderer CAN reach — and yet a few kinds still do not load, because
     * Chromium takes them from the document's own origin only. This test,
     * in its first run, found <use>, <track> and `filter` that way: the
     * scan called them fine behind the base, and none of them loaded. (The
     * earlier version of it asserted "everything loads behind a public base"
     * — true only of the kinds the table then knew.) The scan must name
     * exactly the ones that fail: silence for one that loads nothing is the
     * defect, and a note for one that loads is a false alarm.
     */
    it("behind a public <base>, the scan names exactly the table entries Chromium still cannot load", async () => {
      const withBase = TABLE_WITH_BASE;
      const { fetched: got, served } = await render(withBase);
      expect(served).toEqual([]);
      const named = findUnbundledAssets(parse(withBase)).references.map((r) =>
        withoutHash(r),
      );
      const disagree = ASSET_SOURCES.flatMap((s, i) => {
        const loads = got.includes(new URL(REFS[i]!, PUBLIC).href);
        return loads === named.includes(REFS[i]!) ? [s.selector] : [];
      });
      expect(disagree).toEqual([]);
    }, 90_000);

    it("behind a public <base>, the scan names exactly the spec-corpus forms Chromium still cannot load", async () => {
      const withBase = FORMS_WITH_BASE;
      const { fetched: got, served } = await render(withBase);
      expect(served).toEqual([]);
      const loaded = new Set(got.map(formOf));
      const named = new Set(
        findUnbundledAssets(parse(withBase)).references.map((r) =>
          formOf(new URL(r, PUBLIC).href),
        ),
      );
      // Health, both branches: most forms load, and some do not — so the
      // agreement below is tested on each side, not vacuously on one.
      expect(loaded.size).toBeGreaterThanOrEqual(50);
      const unloaded = FORM_NAMES.filter((n) => !loaded.has(n));
      expect(unloaded.length).toBeGreaterThanOrEqual(3);
      const disagree = FORM_NAMES.filter((n) => !(n in NON_PRINTING)).filter(
        (n) => loaded.has(n) === named.has(n),
      );
      expect(disagree).toEqual([]);
    }, 90_000);

    /*
     * Every assertion above ran the scan in jsdom. The user's browser runs it,
     * so the shipped module runs in Chromium too, over every page above, and
     * must give the same answer.
     */
    it("the shipped scan gives the same answer in Chromium's own DOMParser as in jsdom", async () => {
      const inputs = [
        TABLE_PAGE,
        TABLE_WITH_BASE,
        FORMS_PAGE,
        FORMS_WITH_BASE,
        SAVED_PAGE,
      ];
      const inBrowser = await scanInChromium(inputs);
      const inJsdom = inputs.map(
        (h) => findUnbundledAssets(parse(h)).references,
      );
      // Health: a real answer on each side, not an agreement between two blanks.
      expect(inJsdom[2]!.length).toBeGreaterThanOrEqual(50);
      expect(inBrowser[2]!.length).toBeGreaterThanOrEqual(50);
      expect(inBrowser).toEqual(inJsdom);
    }, 90_000);

    /*
     * Without a <base>, the scan's verdict must be the renderer's outcome:
     * everything it reports is never fetched, and the absolute public
     * reference it stays quiet about IS fetched (the positive control).
     */
    it("what the scan reports missing is what the renderer never loads", async () => {
      const absolute = `${PUBLIC}absolute.bin`;
      const html = page(
        ASSET_SOURCES.map((s, i) => s.sample(REFS[i]!)).join("\n") +
          `<img src="${absolute}" alt=""><img src="data:image/png;base64,AAAA" alt="">`,
      );
      const reported = findUnbundledAssets(parse(html)).references;
      expect(reported.map(withoutHash).sort()).toEqual([...REFS].sort());
      const { fetched: got } = await render(html);
      expect(got).toEqual([absolute]);
    }, 90_000);
  },
);
