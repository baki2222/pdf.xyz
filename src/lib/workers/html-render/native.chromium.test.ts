import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createNativeChromiumPdfRunner, resolveOnPath } from "./native";
import type { PinnedFetch, Resolve } from "./network";

/**
 * THE POINT OF CONSUMPTION for the renderer's isolation: a real Chromium,
 * a real PDF, and the text a user would get back — decoded, not assumed.
 *
 * Runs wherever a Chromium exists: `PDFXYZ_TEST_CHROMIUM_BIN`, one on PATH
 * (GitHub's ubuntu runners ship google-chrome), or Playwright's cache. When
 * none exists the suite reports itself SKIPPED, which is visible; it never
 * reports a pass it did not run.
 */
function findChromium(): string | null {
  const pinned = process.env.PDFXYZ_TEST_CHROMIUM_BIN;
  if (pinned && existsSync(pinned)) return pinned;
  const caches = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "ms-playwright"),
    path.join(homedir(), ".cache", "ms-playwright"),
    path.join(homedir(), "Library", "Caches", "ms-playwright"),
  ].filter((d): d is string => !!d && existsSync(d));
  for (const cache of caches) {
    for (const dir of readdirSync(cache)
      .filter((d) => d.startsWith("chromium_headless_shell-"))
      .sort()
      .reverse()) {
      for (const sub of readdirSync(path.join(cache, dir))) {
        for (const exe of [
          "chrome-headless-shell.exe",
          "chrome-headless-shell",
        ]) {
          const candidate = path.join(cache, dir, sub, exe);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  }
  for (const name of [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
  ])
    if (resolveOnPath(name)) return name;
  return null;
}

const BIN = findChromium();

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
      const input = path.join(work, "input.html");
      const output = path.join(work, "old.pdf");
      writeFileSync(input, LOCAL_ONLY_PAGE);
      await new Promise<void>((done) =>
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
          { timeout: 60_000 },
          () => done(),
        ),
      );
      const text = await pdfText(readFileSync(output));
      expect(text).toContain(VISIBLE);
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

    it("a public URL that redirects to the metadata address is refused", async () => {
      fetched.length = 0;
      await expect(
        runner.renderUrl("https://public.example/to-metadata"),
      ).rejects.toThrow(/BLOCKED_BY_CLIENT/);
      expect(fetched).toEqual(["https://public.example/to-metadata"]);
    }, 90_000);
  },
);
