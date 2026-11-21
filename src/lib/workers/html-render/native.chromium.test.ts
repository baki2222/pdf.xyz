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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNativeChromiumPdfRunner, resolveOnPath } from "./native";
import { WebpageFetchError } from "./engine";
import { findChromium } from "./test-chromium";
import type { PinnedFetch, Resolve } from "./network";
import { printChromeLeaks } from "./print-chrome";
import { HTML_DOCUMENT_URL } from "./document-url";

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

/** Every link annotation: its URL, or a count of in-document jumps. */
async function pdfLinks(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const doc = await task.promise;
  const urls: string[] = [];
  let internal = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== "Link") continue;
      if (typeof a.url === "string") urls.push(a.url);
      else if (a.dest) internal += 1;
    }
  }
  await task.destroy();
  return { urls, internal };
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

/**
 * How long the pre-fix argv may run before it is killed. Below the 90 s of
 * each control, so the kill's readable message is the one that fires.
 */
const PRE_FIX_TIMEOUT_MS = 60_000;

/**
 * The argv this module used until 2026-09 (`chromiumPdfArgs` before
 * ba4bfb0d), verbatim: the defect under proof is that it opens the upload as
 * a file:// document, and nothing here may change that.
 */
const preFixArgv = (output: string, source: string) => [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--run-all-compositor-stages-before-draw",
  "--virtual-time-budget=10000",
  `--print-to-pdf=${output}`,
  source,
];

/**
 * What the HARNESS adds, none of it about file access: a fresh profile per
 * call, and no first-run or background work in it, so a control never
 * depends on the runner's default profile or reaches the network on its
 * own. The control still has to LEAK: if any of these stopped a file://
 * page reading a local file, it would go red.
 *
 * These are hygiene, NOT the fix for the slow first launch (an earlier
 * version of this comment said they were, and the failing run contradicts
 * it). In run 44924793701 attempt 1, capture.chromium and zip-site.chromium
 * started 48 s and 55 s into this file, while its first launch was still
 * running, and their first tests, which launch through the production
 * runner with exactly these flags and a fresh profile, took 29,256 ms and
 * 22,043 ms (736-2,335 ms in the passing runs, where they start after this
 * file). So the cost is the MACHINE's first Chromium launch, whatever the
 * profile; `warmUp` below pays it before any control runs.
 */
const harnessFlags = (profile: string) => [
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
];

/** How a Chromium run that wrote no PDF ended, in words. */
interface ChromiumExit {
  error: (Error & { killed?: boolean; signal?: string }) | null;
  /** `ChildProcess.killed`: true once the timeout sent its signal. */
  childKilled: boolean;
  elapsedMs: number;
}
function exitCause(exit: ChromiumExit, timeoutMs: number): string {
  // The ChildProcess and the clock, not error.killed: see the test below.
  const killed =
    exit.error?.killed || exit.childKilled || exit.elapsedMs >= timeoutMs;
  return killed
    ? `killed by the ${timeoutMs / 1000} s timeout (${exit.error?.signal ?? (exit.error ? "no signal" : "then exited 0")})`
    : exit.error
      ? `exited: ${exit.error.message}`
      : "exited 0";
}

/** Chromium's stderr without the D-Bus lines a runner with no bus prints. */
const stderrTail = (stderr: string) =>
  stderr
    .split("\n")
    .filter((line) => !line.includes("dbus/bus.cc"))
    .join("\n")
    .slice(-1200);

/**
 * Runs Chromium with `argv` on a fresh profile in `dir`, killed at
 * `timeoutMs`, and returns how long it took; throws, saying why, when it
 * wrote no `output`. Chromium's exit is kept, not swallowed: on a slow CI
 * runner it has hung until the kill (run 41104611412), and the control then
 * failed as a bare ENOENT on the missing PDF — red for a reason nobody could
 * read. A non-zero exit WITH a PDF written is normal for headless Chromium.
 */
async function printOrExplain(
  dir: string,
  argv: string[],
  output: string,
  timeoutMs: number,
): Promise<number> {
  const startedAt = Date.now();
  const exit = await new Promise<{
    error: ChromiumExit["error"];
    childKilled: boolean;
    stderr: string;
  }>((done) => {
    const child = execFile(
      BIN!,
      [...harnessFlags(path.join(dir, "profile")), ...argv],
      { timeout: timeoutMs },
      (error, _stdout, stderr) =>
        done({ error, childKilled: child.killed, stderr: String(stderr) }),
    );
  });
  const elapsedMs = Date.now() - startedAt;
  if (!existsSync(output))
    throw new Error(
      `Chromium wrote no PDF, ${exitCause({ ...exit, elapsedMs }, timeoutMs)}, after ${elapsedMs} ms; stderr tail without D-Bus noise: ${stderrTail(exit.stderr)}`,
    );
  return elapsedMs;
}

/**
 * How long the warm-up launch may take. The first Chromium launch in a CI
 * job took 7.3-46.2 s in the 22 passing runs of 11-18..11-21 (max 46,233 ms,
 * run 44910288854) and more than 65,096 ms in the failure (44924793701
 * attempt 1, killed at 60 s; the machine was fast again about 80 s after
 * the file started). 150 s is 3.2x the passing max and 2.3x the failure's
 * lower bound, and stays under the hook's own timeout so this message wins.
 */
const WARM_UP_TIMEOUT_MS = 150_000;

/**
 * One throwaway print of an empty page, before any control: the machine's
 * first Chromium launch (binary, font and GPU caches read cold) is paid
 * here, under its own timeout, instead of inside the first control's 60 s
 * kill. It prints how long it took, so the cost stays visible in every CI
 * log. If even this writes no PDF, the hook fails and says why.
 */
async function warmUp(): Promise<void> {
  const dir = mkdtempSync(path.join(work, "pdfxyz-warm-"));
  const output = path.join(dir, "warm.pdf");
  const ms = await printOrExplain(
    dir,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--print-to-pdf=${output}`,
      "about:blank",
    ],
    output,
    WARM_UP_TIMEOUT_MS,
  );
  console.log(`[native.chromium] warm-up launch: ${ms} ms`);
}

/**
 * The pre-fix argv on a page: the upload written to a `pdfxyz-html-` temp
 * dir, as the pre-fix code named it, and opened as file://.
 */
async function renderWithPreFixArgv(html: string, name: string) {
  const dir = mkdtempSync(path.join(work, "pdfxyz-html-"));
  const input = path.join(dir, `${name}.html`);
  const output = path.join(dir, `${name}.pdf`);
  writeFileSync(input, html);
  await printOrExplain(
    dir,
    preFixArgv(output, pathToFileURL(input).toString()),
    output,
    PRE_FIX_TIMEOUT_MS,
  );
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

describe("how a Chromium run that wrote no PDF is reported", () => {
  /*
   * Run 44924793701 attempt 1 (2026-11-21): "Chromium wrote no PDF, exited
   * 0" after 65,096 ms of a 60 s kill. On Linux Chromium handles the
   * timeout's SIGTERM and exits 0, so execFile hands back error === null and
   * error.killed was never set; only the ChildProcess knew it had been
   * killed. A Windows kill sets error.killed, so no local run could see this.
   */
  it("a child the timeout killed is reported as killed, even when it then exits 0", () => {
    expect(
      exitCause({ error: null, childKilled: true, elapsedMs: 60_004 }, 60_000),
    ).toMatch(/^killed by the 60 s timeout/);
  });

  it("a child that exited 0 on its own, before the timeout, says so", () => {
    expect(
      exitCause({ error: null, childKilled: false, elapsedMs: 900 }, 60_000),
    ).toBe("exited 0");
  });

  it("a Windows kill (error.killed) and a crash keep their own words", () => {
    const killed = Object.assign(new Error("Command failed"), {
      killed: true,
      signal: "SIGTERM",
    });
    expect(
      exitCause(
        { error: killed, childKilled: true, elapsedMs: 60_001 },
        60_000,
      ),
    ).toBe("killed by the 60 s timeout (SIGTERM)");
    expect(
      exitCause(
        { error: new Error("boom"), childKilled: false, elapsedMs: 50 },
        60_000,
      ),
    ).toBe("exited: boom");
  });
});

describe.skipIf(!BIN)(
  `real Chromium isolation (${BIN ?? "no Chromium found"})`,
  () => {
    // The hook's timeout is above WARM_UP_TIMEOUT_MS, so the kill's message,
    // which names the cause, is the one that fires.
    beforeAll(warmUp, WARM_UP_TIMEOUT_MS + 30_000);

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

    /*
     * Audit #5 (2026-11-06): an upload with neither a BOM nor a charset
     * declaration was served as bare `text/html`, so Chromium decoded UTF-8
     * as windows-1252 and printed "cafÃ©" — and the job succeeded.
     */
    it("a UTF-8 upload with no charset declaration prints as its own text", async () => {
      const text = await pdfText(
        await runner.renderHtml(
          new TextEncoder().encode(
            "<h1>Résumé – café naïve 日本語</h1><p>Zoë’s plain body</p>",
          ),
        ),
      );
      expect(text, text).toContain("Résumé – café naïve");
      expect(text, text).toContain("Zoë’s plain body");
      expect(text, text).not.toContain("Ã");
    }, 90_000);

    it("an upload that declares a legacy charset is still read in it", async () => {
      // "café" in windows-1252: é is the single byte 0xE9, invalid as UTF-8.
      const head = new TextEncoder().encode(
        '<meta charset="windows-1252"><h1>Legacy caf',
      );
      const bytes = new Uint8Array([
        ...head,
        0xe9,
        ...new TextEncoder().encode(" body</h1>"),
      ]);
      const text = await pdfText(await runner.renderHtml(bytes));
      expect(text, text).toContain("Legacy café body");
    }, 90_000);

    /*
     * Audit #48 (2026-11-06): the upload is served at HTML_DOCUMENT_URL, so a
     * relative link such as about.html became a clickable link to
     * https://document.invalid/about.html — our reserved host, never theirs.
     */
    it("an uploaded page's relative links do not become links to the synthetic origin", async () => {
      const page = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<p><a href="about.html">About page link</a></p>
<p><a href="?q=1">Query link</a> <a href="">Empty link</a></p>
<p><a href="#later">Jump link</a></p>
<p><a href="https://example.com/outside">Outside link</a></p>
<h2 id="later" style="margin-top:400px">Later heading</h2></body></html>`;
      const pdf = await runner.renderHtml(new TextEncoder().encode(page));
      const links = await pdfLinks(pdf);
      expect(
        links.urls.filter((u) => u.startsWith(HTML_DOCUMENT_URL)),
        links.urls.join(" | "),
      ).toEqual([]);
      // Positive controls: a link the user wrote survives, and so does the
      // in-page jump (as a destination, not a URL).
      expect(links.urls).toContain("https://example.com/outside");
      expect(links.internal).toBeGreaterThan(0);
      // The text of a stripped link still prints.
      expect(await pdfText(pdf)).toContain("About page link");
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
