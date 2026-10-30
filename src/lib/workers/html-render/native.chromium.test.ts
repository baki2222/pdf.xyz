// @native-canvas
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createNativeChromiumPdfRunner, resolveOnPath } from "./native";
import { WebpageFetchError } from "./engine";
import { findChromium } from "./test-chromium";
import type { PinnedFetch, Resolve } from "./network";
import { printChromeLeaks } from "./print-chrome";

/**
 * THE POINT OF CONSUMPTION for the renderer's isolation: a real Chromium,
 * a real PDF, and the text a user would get back — decoded, not assumed.
 *
 * Runs wherever a Chromium exists: `PDFXYZ_TEST_CHROMIUM_BIN`, one on PATH
 * (GitHub's ubuntu runners ship google-chrome), or Playwright's cache. When
 * none exists the suite reports itself SKIPPED, which is visible; it never
 * reports a pass it did not run.
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
  }
  await task.destroy();
  return text.replace(/\s+/g, " ");
}

const work = mkdtempSync(path.join(tmpdir(), "pdfxyz-isolation-"));
afterAll(() => {
  // A browser that is still exiting holds its profile open on Windows.
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

/** A file only this test knows about — what `/etc/passwd` is in production. */
const SECRET = `WORKER-FILE-${process.pid}-${Date.now()}`;
const secretPath = path.join(work, "secret.txt");
writeFileSync(secretPath, SECRET);
const secretUrl = pathToFileURL(secretPath).toString();

const VISIBLE = "Isolation proof visible text";
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<h1>${VISIBLE}</h1>
<iframe src="${secretUrl}" width="600" height="100"></iframe>
<iframe src="http://169.254.169.254/latest/meta-data/"></iframe>
<iframe src="https://internal.example/"></iframe>
<iframe src="https://frame.example/"></iframe>
<div id="out"></div>
<script>
fetch("${secretUrl}").then(r => r.text()).then(t => out.append("SCRIPT-READ:" + t))
  .catch(() => out.append(" script-read-refused"));
</script>
</body></html>`;

/**
 * The positive control's page: only the local-file read. It must not touch
 * the network — the pre-fix argv has a live one, and a CI runner's metadata
 * address is real.
 */
const LOCAL_ONLY_PAGE = `<!doctype html><html><body><h1>${VISIBLE}</h1>
<iframe src="${secretUrl}" width="600" height="100"></iframe></body></html>`;

/**
 * A page whose `<title>` appears nowhere in its body: if that title is in the
 * PDF, Chromium's print header put it there.
 */
const TITLE = `Header-only title ${process.pid}`;
const CHROME_VISIBLE = "Print chrome proof body";
const TITLED_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<title>${TITLE}</title></head><body><h1>${CHROME_VISIBLE}</h1></body></html>`;

/** A page that navigates itself to the canary file the moment it loads. */
const REFRESH_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${secretUrl}"></head>
<body><h1>${VISIBLE}</h1></body></html>`;

/** How long the pre-fix argv may run before it is killed. */
const PRE_FIX_TIMEOUT_MS = 60_000;

/**
 * The argv this module used until 2026-09: the upload written to a
 * `pdfxyz-html-` temp dir, as the pre-fix code named it, and opened as file://.
 */
async function renderWithPreFixArgv(html: string, name: string) {
  const dir = mkdtempSync(path.join(work, "pdfxyz-html-"));
  const input = path.join(dir, `${name}.html`);
  const output = path.join(dir, `${name}.pdf`);
  writeFileSync(input, html);
  // Chromium's exit is kept, not swallowed: on a slow CI runner it has hung
  // until the 60 s kill (run 41104611412), and the control then failed as a
  // bare ENOENT on the missing PDF — red for a reason nobody could read.
  const exit = await new Promise<{
    error: (Error & { killed?: boolean; signal?: string }) | null;
    stderr: string;
  }>((done) =>
    execFile(
      BIN!,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=10000",
        `--print-to-pdf=${output}`,
        pathToFileURL(input).toString(),
      ],
      { timeout: PRE_FIX_TIMEOUT_MS },
      (error, _stdout, stderr) => done({ error, stderr: String(stderr) }),
    ),
  );
  // A non-zero exit with a PDF written is normal for headless Chromium, so
  // only a MISSING PDF is an error, and it says why.
  if (!existsSync(output)) {
    const cause = exit.error?.killed
      ? `killed by the ${PRE_FIX_TIMEOUT_MS / 1000} s timeout (${exit.error.signal ?? "no signal"})`
      : exit.error
        ? `exited: ${exit.error.message}`
        : "exited 0";
    throw new Error(
      `Chromium wrote no PDF, ${cause}; stderr tail: ${exit.stderr.slice(-600)}`,
    );
  }
  return {
    text: await pdfText(readFileSync(output)),
    url: pathToFileURL(input).toString(),
  };
}

/**
 * A site's error page: real HTML with real text, exactly what a 404 or a bot
 * check hands a browser. Rendered, it makes a perfectly good PDF — which is
 * why "Chromium produced a PDF" never meant "the page was captured".
 */
const ERROR_PAGE_TEXT = "Error page body the user never asked for";
const ERROR_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<title>Just a moment...</title></head><body><h1>${ERROR_PAGE_TEXT}</h1></body></html>`;
const BROKEN_PARTS_TEXT = "A page with a broken image and frame";
const BROKEN_PARTS_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><h1>${BROKEN_PARTS_TEXT}</h1><img src="https://frame.example/nope.png">
<iframe src="https://frame.example/missing"></iframe></body></html>`;

const fetched: string[] = [];
const resolve: Resolve = async (host) => {
  if (host === "frame.example")
    return [{ address: "93.184.215.14", family: 4 }];
  if (host === "public.example")
    return [{ address: "93.184.215.14", family: 4 }];
  if (host === "internal.example") return [{ address: "10.1.2.3", family: 4 }];
  throw new Error("NXDOMAIN");
};
const fetch: PinnedFetch = async (url) => {
  fetched.push(url.toString());
  if (url.pathname === "/report")
    return {
      status: 200,
      rawHeaders: ["Content-Type", "text/html; charset=utf-8"],
      body: new TextEncoder().encode(TITLED_PAGE),
    };
  const html = (status: number, page: string, extra: string[] = []) => ({
    status,
    rawHeaders: ["Content-Type", "text/html; charset=utf-8", ...extra],
    body: new TextEncoder().encode(page),
  });
  if (url.pathname === "/missing") return html(404, ERROR_PAGE);
  if (url.pathname === "/error-page-as-200") return html(200, ERROR_PAGE);
  if (url.pathname === "/challenge")
    return html(403, ERROR_PAGE, ["cf-mitigated", "challenge"]);
  if (url.pathname === "/broken-parts") return html(200, BROKEN_PARTS_PAGE);
  if (url.pathname === "/nope.png")
    return { status: 404, rawHeaders: [], body: new Uint8Array() };
  if (url.pathname === "/to-metadata")
    return {
      status: 302,
      rawHeaders: ["Location", "http://169.254.169.254/latest/meta-data/"],
      body: new Uint8Array(),
    };
  return {
    status: 200,
    rawHeaders: ["Content-Type", "text/html; charset=utf-8"],
    body: new TextEncoder().encode("<p>Public frame rendered</p>"),
  };
};

describe.skipIf(!BIN)(
  `real Chromium isolation (${BIN ?? "no Chromium found"})`,
  () => {
    /*
     * POSITIVE CONTROL. The argv this module used until 2026-09, run on the
     * same page. It must LEAK the secret — otherwise the assertions below could
     * be passing because the extractor is blind, not because the leak is gone.
     */
    it("the pre-fix argv leaks a local file into the PDF (the detector can see a leak)", async () => {
      const { text } = await renderWithPreFixArgv(LOCAL_ONLY_PAGE, "old");
      expect(text).toContain(VISIBLE);
      expect(text).toContain(SECRET);
    }, 90_000);

    /*
     * POSITIVE CONTROL for the header/footer assertions below: the same
     * predicate, on the pre-fix argv's output, must SEE the header and footer.
     * A predicate that finds nothing here would pass anything.
     */
    it("the pre-fix argv stamps a print header and footer (the detector can see them)", async () => {
      const { text, url } = await renderWithPreFixArgv(TITLED_PAGE, "chrome");
      expect(text).toContain(CHROME_VISIBLE);
      const leaks = printChromeLeaks(text, { title: TITLE, sourceUrl: url });
      // The extracted text rides on the failure: on CI's Linux Chromium the
      // footer URL printed elided, which only the text could show.
      expect(
        leaks,
        `url: ${url}\nextracted text:\n${text.slice(0, 1500)}`,
      ).toContain("the page URL");
      expect(leaks).toContain("the page <title>");
      expect(leaks).toContain("a file:// URL (the worker's copy)");
      expect(leaks).toContain("the worker's temp directory");
      expect(leaks).toContain("a print date");
    }, 90_000);

    it("the pre-fix argv follows a meta refresh into a local file (the detector can see it)", async () => {
      const { text } = await renderWithPreFixArgv(REFRESH_PAGE, "refresh");
      expect(text).toContain(SECRET);
    }, 90_000);

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

    it("an uploaded page cannot read a local file or reach a private address", async () => {
      fetched.length = 0;
      const text = await pdfText(
        await runner.renderHtml(new TextEncoder().encode(PAGE)),
      );
      expect(text).toContain(VISIBLE);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("SCRIPT-READ");
      // Public content still renders — through the policy, as a cross-site frame.
      expect(text).toContain("Public frame rendered");
      expect(fetched).toEqual(["https://frame.example/"]);
    }, 90_000);

    it("an uploaded page cannot navigate itself into a local file", async () => {
      const text = await pdfText(
        await runner.renderHtml(new TextEncoder().encode(REFRESH_PAGE)),
      );
      expect(text).toContain(VISIBLE);
      expect(text).not.toContain(SECRET);
    }, 90_000);

    it("an uploaded page's PDF carries the page and no print header or footer", async () => {
      const text = await pdfText(
        await runner.renderHtml(new TextEncoder().encode(TITLED_PAGE)),
      );
      expect(text).toContain(CHROME_VISIBLE);
      expect(printChromeLeaks(text, { title: TITLE })).toEqual([]);
    }, 90_000);

    it("a webpage's PDF carries the page and neither its title nor its URL", async () => {
      const sourceUrl = "https://public.example/report";
      const text = await pdfText(await runner.renderUrl(sourceUrl));
      expect(text).toContain(CHROME_VISIBLE);
      expect(printChromeLeaks(text, { title: TITLE, sourceUrl })).toEqual([]);
    }, 90_000);

    /*
     * CHANGED 2026-09: this matched `/BLOCKED_BY_CLIENT/` in the generic
     * render error. The refusal is now typed, so the user is told the
     * redirect led somewhere that is never fetched.
     */
    it("a public URL that redirects to the metadata address is refused", async () => {
      fetched.length = 0;
      const error = await runner
        .renderUrl("https://public.example/to-metadata")
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WebpageFetchError);
      expect((error as WebpageFetchError).failure).toEqual({
        reason: "blocked",
      });
      expect(fetched).toEqual(["https://public.example/to-metadata"]);
    }, 90_000);

    /*
     * The status is read from the main-frame document on a REAL Chromium: the
     * fake-pipe tests in native.test.ts assume the navigation arrives on the
     * frame id Page.getFrameTree reported, and only a browser can confirm it.
     */
    it("a site that answers 404 fails the render instead of printing its error page", async () => {
      // Positive control: the very same page, answered 200, renders and its
      // text is readable — so the refusal below is the STATUS, not a page
      // Chromium could not print or a reader that could not see it.
      const control = await pdfText(
        await runner.renderUrl("https://public.example/error-page-as-200"),
      );
      expect(control).toContain(ERROR_PAGE_TEXT);

      const error = await runner
        .renderUrl("https://public.example/missing")
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WebpageFetchError);
      expect((error as WebpageFetchError).failure).toEqual({
        reason: "http",
        status: 404,
      });
    }, 90_000);

    it("a bot-check answer is named as one", async () => {
      const error = await runner
        .renderUrl("https://public.example/challenge")
        .catch((e: unknown) => e);
      expect((error as WebpageFetchError).failure).toEqual({
        reason: "challenge",
        status: 403,
      });
    }, 90_000);

    it("a broken image or iframe inside a page does not fail it", async () => {
      fetched.length = 0;
      const text = await pdfText(
        await runner.renderUrl("https://public.example/broken-parts"),
      );
      expect(text).toContain(BROKEN_PARTS_TEXT);
      // Both broken parts were really asked for, and answered with errors.
      expect(fetched).toEqual(
        expect.arrayContaining([
          "https://frame.example/nope.png",
          "https://frame.example/missing",
        ]),
      );
    }, 90_000);
  },
);
