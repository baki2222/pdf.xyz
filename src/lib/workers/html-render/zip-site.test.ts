// @vitest-environment node
/**
 * HTML to PDF's ZIP input, worker side, without a browser: the bounded open
 * (the bounds in `./zip-config.ts`, each held with an archive one past it),
 * which page is printed, how a URL Chromium asks for becomes an archive
 * entry (and every way it must NOT), the Content-Type each entry is served
 * with, and the typed refusals. `zip-site.chromium.test.ts` puts the same
 * archives through a real Chromium.
 */
import JSZip from "jszip";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { HTML_DOCUMENT_URL } from "./document-url";
import { openBoundedZip } from "../epub/zip";
import { handZip } from "@/tests/hand-zip";
import {
  HTML_ZIP_MAX_ENTRIES,
  HTML_ZIP_MAX_ENTRY_RATIO,
  HTML_ZIP_MAX_UNPACKED_BYTES,
  HTML_ZIP_RATIO_FLOOR_BYTES,
  chooseHtmlEntry,
  isHtmlEntryName,
  parseHtmlZipEntryOption,
} from "./zip-config";
import {
  HTML_ZIP_LIMITS,
  contentTypeOfEntry,
  htmlZipRefusalMessage,
  looksLikeZip,
  openHtmlZip,
  zipEntryOfUrl,
  zipEntryUrl,
  type HtmlZipRefusal,
} from "./zip-site";
import { htmlDocumentContentType } from "./native";
import { runHtmlToPdf, type ChromiumPdfRunner, type HtmlSite } from "./engine";
import { createHtmlRenderProcessor } from "../processor/html-render";

const enc = (s: string) => new TextEncoder().encode(s);
const MIB = 1024 * 1024;
const PDF = enc("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function zipOf(
  files: Record<string, string | Uint8Array>,
  opts: { platform?: "UNIX" | "DOS"; modes?: Record<string, number> } = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) {
    if (name.endsWith("/")) zip.folder(name.slice(0, -1));
    else
      zip.file(name, body, {
        ...(opts.modes?.[name] !== undefined
          ? { unixPermissions: opts.modes[name] }
          : {}),
      });
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    platform: opts.platform ?? "DOS",
  });
}

const u32 = (b: Uint8Array, i: number) =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
const setU32 = (b: Uint8Array, i: number, v: number) => {
  b[i] = v & 0xff;
  b[i + 1] = (v >>> 8) & 0xff;
  b[i + 2] = (v >>> 16) & 0xff;
  b[i + 3] = (v >>> 24) & 0xff;
};

/**
 * Rewrite the central directory's declared sizes: a directory that lies.
 * `unpacked` may name one figure per entry, in directory order (the last
 * repeats); `packed` is half of each, inside every ratio bound.
 */
function declare(
  bytes: Uint8Array,
  packed: number | null,
  unpacked: number | number[],
) {
  const out = new Uint8Array(bytes);
  const sizes = Array.isArray(unpacked) ? unpacked : [unpacked];
  let n = 0;
  for (let i = 0; i + 46 <= out.length; i++)
    if (u32(out, i) === 0x02014b50) {
      const size = sizes[Math.min(n, sizes.length - 1)]!;
      setU32(out, i + 20, packed ?? Math.ceil(size / 2));
      setU32(out, i + 24, size);
      n += 1;
    }
  return out;
}

const SITE = {
  "index.html":
    '<!doctype html><link rel="stylesheet" href="css/site.css"><img src="images/Logo.png"><p>Hello</p>',
  "css/site.css": "p { color: rgb(1, 2, 3) }",
  "images/Logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  "images/": "",
};

const open = (bytes: Uint8Array, entry?: string) =>
  openHtmlZip(bytes, entry, htmlDocumentContentType);

function site(result: ReturnType<typeof open>): HtmlSite {
  if (!result.ok) throw new Error(`refused: ${result.refusal.kind}`);
  return result.site;
}

describe("the bounded open, with HTML to PDF's own bounds", () => {
  it("passes the bounds the config declares, not EPUB's", () => {
    expect(HTML_ZIP_LIMITS).toEqual({
      maxEntries: HTML_ZIP_MAX_ENTRIES,
      maxUnpackedBytes: HTML_ZIP_MAX_UNPACKED_BYTES,
      maxEntryRatio: HTML_ZIP_MAX_ENTRY_RATIO,
      ratioFloorBytes: HTML_ZIP_RATIO_FLOOR_BYTES,
    });
  });

  it("refuses one entry past the entry bound, and opens at it", async () => {
    const files: Record<string, string> = { "index.html": "<p>x</p>" };
    for (let i = 1; i < HTML_ZIP_MAX_ENTRIES; i++) files[`f${i}.txt`] = "";
    const at = await zipOf(files);
    expect(open(at).ok).toBe(true);
    files.extra = "";
    const past = open(await zipOf(files));
    expect(past).toEqual({
      ok: false,
      refusal: { kind: "bomb", limit: "entries" },
    });
  });

  it("refuses a directory that declares more than the unpacked bound, before inflating", async () => {
    const half = Math.floor(HTML_ZIP_MAX_UNPACKED_BYTES / 2);
    const rest = HTML_ZIP_MAX_UNPACKED_BYTES - half;
    const two = await zipOf({ "index.html": "a", "b.css": "b" });
    // Packed declared at half the unpacked size: within the ratio, so only
    // the total can refuse it — ONE byte past the bound, and exactly at it.
    const over = declare(two, null, [half, rest + 1]);
    expect(open(over)).toEqual({
      ok: false,
      refusal: { kind: "bomb", limit: "unpacked" },
    });
    const within = declare(two, null, [half, rest]);
    // Within the bound, the lie is caught when the page is read instead.
    expect(open(within)).toEqual({
      ok: false,
      refusal: { kind: "unreadable" },
    });
  });

  it("refuses a file that grows more than the ratio bound, and passes one at it", async () => {
    const floor = HTML_ZIP_RATIO_FLOOR_BYTES + 1;
    const one = await zipOf({ "index.html": "a" });
    expect(
      open(
        declare(one, Math.floor(floor / HTML_ZIP_MAX_ENTRY_RATIO) - 1, floor),
      ),
    ).toEqual({ ok: false, refusal: { kind: "bomb", limit: "ratio" } });
    // A real bomb, not a lie: 2 MiB of zeros deflates past 1,000-fold.
    const zeros = await zipOf({
      "index.html": "<p>x</p>",
      "zeros.bin": new Uint8Array(2 * MIB),
    });
    expect(open(zeros)).toEqual({
      ok: false,
      refusal: { kind: "bomb", limit: "ratio" },
    });
    // Under the floor, the ratio is not judged: a small repetitive file.
    const small = await zipOf({
      "index.html": "<p>x</p>",
      "rep.css": "a{}".repeat(100_000),
    });
    expect(open(small).ok).toBe(true);
  });

  it("refuses what is not a ZIP, and ZIP64", async () => {
    expect(open(enc("<html>not a zip</html>"))).toEqual({
      ok: false,
      refusal: { kind: "unreadable" },
    });
    const zip64 = new Uint8Array(await zipOf({ "index.html": "a" }));
    // The end-of-directory record's entry count set to the ZIP64 marker.
    for (let i = zip64.length - 22; i >= 0; i--)
      if (u32(zip64, i) === 0x06054b50) {
        zip64[i + 10] = 0xff;
        zip64[i + 11] = 0xff;
        break;
      }
    expect(open(zip64)).toEqual({
      ok: false,
      refusal: { kind: "unreadable" },
    });
  });

  it("refuses entries that share one data region; the same files each with their own data open (hostile review 2026-11-14)", () => {
    // 2 MiB of zeros, deflated (about 2 KB) and padded with bytes after the
    // stream until its declared packed size sits exactly AT the ratio bound.
    const unpacked = 2 * MIB;
    const stream = deflateRawSync(new Uint8Array(unpacked));
    const packed = new Uint8Array(
      Math.ceil(unpacked / HTML_ZIP_MAX_ENTRY_RATIO),
    );
    packed.set(stream);
    const page = enc("<p>x</p>");
    const names = ["f0.bin", "f1.bin", "f2.bin", "f3.bin"];
    const shared = handZip([
      { name: "index.html", data: page, unpacked: page.length, method: 0 },
      { name: "f0.bin", data: packed, unpacked, method: 8 as const },
      ...names.slice(1).map((name) => ({
        name,
        at: "f0.bin",
        data: packed,
        unpacked,
        method: 8 as const,
      })),
    ]);
    // Health: each entry alone is within every bound, so only sharing is refused.
    expect(shared.length).toBeLessThan(
      ((names.length * unpacked) / HTML_ZIP_MAX_ENTRY_RATIO) * 0.5,
    );
    expect(open(shared)).toEqual({
      ok: false,
      refusal: { kind: "unreadable" },
    });
    // POSITIVE CONTROL: the same four files, each with its own stored region,
    // open — and every one of them serves its 2 MiB.
    const own = handZip([
      { name: "index.html", data: page, unpacked: page.length, method: 0 },
      ...names.map((name) => ({
        name,
        data: packed,
        unpacked,
        method: 8 as const,
      })),
    ]);
    const opened = openHtmlZip(own, undefined, htmlDocumentContentType);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    for (const name of names)
      expect(opened.site.serve(zipEntryUrl(name))?.body.byteLength).toBe(
        unpacked,
      );
  });

  it("reads folders and symbolic links from the directory", async () => {
    const bytes = await zipOf(
      { "index.html": "<p>x</p>", "link.css": "/etc/passwd", "dir/": "" },
      { platform: "UNIX", modes: { "link.css": 0o120777 } },
    );
    const zip = openBoundedZip(bytes, HTML_ZIP_LIMITS);
    expect(zip.ok).toBe(true);
    if (!zip.ok) return;
    expect(zip.zip.isSymlink("link.css")).toBe(true);
    expect(zip.zip.isSymlink("index.html")).toBe(false);
    expect(zip.zip.isDirectory("dir/")).toBe(true);
    expect(zip.zip.isDirectory("index.html")).toBe(false);
  });
});

describe("which page is printed", () => {
  it("index.html at the root", () => {
    expect(
      chooseHtmlEntry(["a.html", "index.html", "sub/index.html"]),
    ).toMatchObject({ kind: "one", entry: "index.html" });
  });

  it("index.html inside the one top-level folder of a zipped folder", () => {
    expect(
      chooseHtmlEntry([
        "site/",
        "site/about.html",
        "site/index.html",
        "site/css/a.css",
      ]),
    ).toMatchObject({ kind: "one", entry: "site/index.html" });
  });

  it("a 'Save page as' export: the page, not the frames saved beside it", () => {
    expect(
      chooseHtmlEntry([
        "Report.html",
        "Report_files/saved_resource.html",
        "Report_files/style.css",
      ]),
    ).toMatchObject({ kind: "one", entry: "Report.html" });
  });

  it("the only page anywhere", () => {
    expect(chooseHtmlEntry(["a/b/page.htm", "x.css"])).toMatchObject({
      kind: "one",
      entry: "a/b/page.htm",
    });
  });

  it("asks when several pages are equal candidates, and lists them in archive order", () => {
    expect(chooseHtmlEntry(["b.html", "a.HTM", "c.css"])).toEqual({
      kind: "choose",
      candidates: ["b.html", "a.HTM"],
    });
  });

  it("none in an archive with no page, and never a page it could not serve", () => {
    expect(chooseHtmlEntry(["a.css", "__MACOSX/._index.html"])).toEqual({
      kind: "none",
    });
    for (const bad of ["../index.html", "/index.html", "a\\index.html", "x/"])
      expect(isHtmlEntryName(bad), bad).toBe(false);
  });

  it("the worker prints the chosen page, and refuses one the archive lacks", async () => {
    const bytes = await zipOf({ ...SITE, "about.html": "<p>About</p>" });
    expect(site(open(bytes, "about.html")).entryUrl).toBe(
      `${HTML_DOCUMENT_URL}about.html`,
    );
    expect(open(bytes, "About.html")).toEqual({
      ok: false,
      refusal: { kind: "entry_not_found" },
    });
    expect(open(bytes, "css/")).toEqual({
      ok: false,
      refusal: { kind: "entry_not_found" },
    });
  });

  it("refuses an archive of several pages that names none, and one with no page", async () => {
    expect(open(await zipOf({ "a.html": "a", "b.html": "b" }))).toEqual({
      ok: false,
      refusal: { kind: "choose_entry", count: 2 },
    });
    expect(open(await zipOf({ "a.css": "a" }))).toEqual({
      ok: false,
      refusal: { kind: "no_html" },
    });
  });
});

describe("a URL becomes an archive entry, exactly or not at all", () => {
  const D = HTML_DOCUMENT_URL;
  it.each([
    [`${D}index.html`, "index.html"],
    [`${D}css/site.css?v=3#x`, "css/site.css"],
    [`${D}images/My%20Logo.png`, "images/My Logo.png"],
    [`${D}%E0%A6%95.css`, "ক.css"],
  ])("%s → %s", (url, entry) => {
    expect(zipEntryOfUrl(url)).toBe(entry);
  });

  it.each([
    ["a parent segment", `${D}../secret.txt`],
    ["an encoded parent segment", `${D}%2e%2e/secret.txt`],
    ["an encoded dot segment", `${D}a/%2E/b.css`],
    ["an encoded slash", `${D}a%2fb.css`],
    ["a backslash", `${D}a\\b.css`],
    ["an encoded backslash", `${D}..%5csecret.txt`],
    ["a NUL", `${D}a%00.css`],
    ["an absolute path", `${D}/etc/passwd`],
    ["a folder", `${D}images/`],
    ["the root", D],
    ["a malformed escape", `${D}%zz.css`],
    ["another origin", "https://evil.example/index.html"],
    ["another scheme", "file:///etc/passwd"],
  ])("refuses %s", (_, url) => {
    expect(zipEntryOfUrl(url)).toBeNull();
  });

  it("round-trips an entry's own URL", () => {
    for (const name of ["a b/c#d.css", "ক/খ.png", "x%y.js"])
      expect(zipEntryOfUrl(zipEntryUrl(name))).toBe(name);
  });

  it("serves case-sensitively, never a folder, never a link, never outside", async () => {
    const bytes = await zipOf(
      {
        ...SITE,
        "../outside.txt": "secret",
        "/abs.txt": "secret",
        "link.css": "index.html",
      },
      { platform: "UNIX", modes: { "link.css": 0o120777 } },
    );
    const s = site(open(bytes));
    expect(s.serve(`${HTML_DOCUMENT_URL}images/Logo.png`)).not.toBeNull();
    expect(s.serve(`${HTML_DOCUMENT_URL}images/logo.png`)).toBeNull();
    expect(s.serve(`${HTML_DOCUMENT_URL}images/`)).toBeNull();
    expect(s.serve(`${HTML_DOCUMENT_URL}link.css`)).toBeNull();
    expect(s.serve(`${HTML_DOCUMENT_URL}../outside.txt`)).toBeNull();
    expect(s.serve(`${HTML_DOCUMENT_URL}%2e%2e/outside.txt`)).toBeNull();
    expect(s.serve(`${HTML_DOCUMENT_URL}outside.txt`)).toBeNull();
    expect(s.serve(`${HTML_DOCUMENT_URL}/abs.txt`)).toBeNull();
    expect(s.serve(`${HTML_DOCUMENT_URL}abs.txt`)).toBeNull();
  });
});

describe("the Content-Type of each entry", () => {
  it.each([
    ["index.html", "text/html"],
    ["A/B.HTM", "text/html"],
    ["s.css", "text/css"],
    ["app.js", "text/javascript"],
    ["m.mjs", "text/javascript"],
    ["p.PNG", "image/png"],
    ["p.jpeg", "image/jpeg"],
    ["i.svg", "image/svg+xml"],
    ["f.woff2", "font/woff2"],
    ["v.mp4", "video/mp4"],
    ["noext", "application/octet-stream"],
    [".htaccess", "application/octet-stream"],
    ["evil.exe", "application/octet-stream"],
  ])("%s is %s", (name, type) => {
    expect(contentTypeOfEntry(name)).toBe(type);
  });

  it("decides an HTML entry's charset as an uploaded file's is decided", async () => {
    const bytes = await zipOf({
      "index.html": "<p>কখ \u{1F600}</p>",
      "legacy.html": '<meta charset="windows-1252"><p>café</p>',
    });
    const s = site(open(bytes));
    expect(s.serve(`${HTML_DOCUMENT_URL}index.html`)?.contentType).toBe(
      "text/html; charset=utf-8",
    );
    expect(s.serve(`${HTML_DOCUMENT_URL}legacy.html`)?.contentType).toBe(
      "text/html",
    );
    expect(s.serve(`${HTML_DOCUMENT_URL}index.html`)?.body).toEqual(
      enc("<p>কখ \u{1F600}</p>"),
    );
  });
});

describe("refusals, typed and worded", () => {
  const ALL: HtmlZipRefusal[] = [
    { kind: "unreadable" },
    { kind: "bomb", limit: "entries" },
    { kind: "bomb", limit: "unpacked" },
    { kind: "bomb", limit: "ratio" },
    { kind: "no_html" },
    { kind: "entry_not_found" },
    { kind: "choose_entry", count: 3 },
    { kind: "not_zip" },
  ];
  it("says nothing was converted, every time, with each bound from its constant", () => {
    for (const r of ALL)
      expect(htmlZipRefusalMessage(r), r.kind).toMatch(
        /nothing was converted|no page to convert/,
      );
    expect(htmlZipRefusalMessage({ kind: "bomb", limit: "entries" })).toContain(
      HTML_ZIP_MAX_ENTRIES.toLocaleString("en-US"),
    );
    expect(
      htmlZipRefusalMessage({ kind: "bomb", limit: "unpacked" }),
    ).toContain(`${HTML_ZIP_MAX_UNPACKED_BYTES / MIB} MB`);
    expect(htmlZipRefusalMessage({ kind: "bomb", limit: "ratio" })).toContain(
      `${HTML_ZIP_MAX_ENTRY_RATIO} times`,
    );
    expect(new Set(ALL.map(htmlZipRefusalMessage)).size).toBe(ALL.length);
  });

  it("recognises a ZIP by its bytes", async () => {
    expect(looksLikeZip(await zipOf(SITE))).toBe(true);
    expect(looksLikeZip(enc("<!doctype html>"))).toBe(false);
    expect(looksLikeZip(enc("PK"))).toBe(false);
  });
});

describe("the job option naming the page", () => {
  it("accepts a servable page path, and refuses anything else", () => {
    expect(parseHtmlZipEntryOption({})).toEqual({ ok: true, entry: undefined });
    expect(parseHtmlZipEntryOption({ entry: "site/index.html" })).toEqual({
      ok: true,
      entry: "site/index.html",
    });
    for (const bad of [
      3,
      "",
      "a.css",
      "../index.html",
      "/index.html",
      "a\\b.html",
      "a\nb.html",
      `${"a".repeat(1100)}.html`,
    ])
      expect(parseHtmlZipEntryOption({ entry: bad }).ok, String(bad)).toBe(
        false,
      );
  });
});

describe("the engine and the processor, through a fake Chromium", () => {
  function runner(): ChromiumPdfRunner & {
    sites: HtmlSite[];
  } {
    const sites: HtmlSite[] = [];
    return {
      sites,
      renderHtml: vi.fn(async () => PDF),
      renderUrl: vi.fn(async () => PDF),
      renderSite: vi.fn(async (s: HtmlSite) => {
        sites.push(s);
        return PDF;
      }),
    };
  }

  it("renders a ZIP as a site, and an HTML file as before", async () => {
    const chromium = runner();
    const zip = await zipOf(SITE);
    const run = await runHtmlToPdf(zip, { chromium });
    expect(run).toMatchObject({ ok: true, meta: { source: "zip" } });
    expect(chromium.renderHtml).not.toHaveBeenCalled();
    expect(chromium.sites[0]?.entryUrl).toBe(`${HTML_DOCUMENT_URL}index.html`);
    expect(
      chromium.sites[0]?.serve(`${HTML_DOCUMENT_URL}css/site.css`)?.contentType,
    ).toBe("text/css");

    const html = enc("<p>plain</p>");
    await runHtmlToPdf(html, { chromium });
    expect(chromium.renderHtml).toHaveBeenCalledTimes(1);
    expect(chromium.renderSite).toHaveBeenCalledTimes(1);
  });

  it("refuses before Chromium starts: bombs, no page, a page not named, a name for a non-ZIP", async () => {
    const chromium = runner();
    const many = await zipOf({ "a.html": "a", "b.html": "b" });
    await expect(runHtmlToPdf(many, { chromium })).resolves.toMatchObject({
      ok: false,
      kind: "refused",
      refusal: { kind: "choose_entry", count: 2 },
    });
    await expect(
      runHtmlToPdf(
        enc("<p>x</p>"),
        { chromium },
        undefined,
        undefined,
        "a.html",
      ),
    ).resolves.toMatchObject({
      ok: false,
      kind: "refused",
      refusal: { kind: "not_zip" },
    });
    expect(chromium.renderSite).not.toHaveBeenCalled();
  });

  it("a renderer with no site support is unsupported, not a mis-render", async () => {
    const old: ChromiumPdfRunner = {
      renderHtml: vi.fn(async () => PDF),
      renderUrl: vi.fn(async () => PDF),
    };
    await expect(
      runHtmlToPdf(await zipOf(SITE), { chromium: old }),
    ).resolves.toMatchObject({ ok: false, kind: "unsupported" });
    expect(old.renderHtml).not.toHaveBeenCalled();
  });

  it("the processor passes the job's page on, refuses a bad one, and never retries a refusal", async () => {
    const chromium = runner();
    const processor = createHtmlRenderProcessor({ chromium });
    const zip = await zipOf({ ...SITE, "about.html": "<p>About</p>" });
    const input = (options: Record<string, unknown>) => ({
      tool: "html-to-pdf",
      options,
      inputs: [
        {
          fileId: "f",
          filename: "site.zip",
          contentType: "application/zip",
          bytes: zip,
        },
      ],
    });
    const ok = await processor.process(input({ entry: "about.html" }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.artifacts[0]?.filename).toBe("site.pdf");
    expect(chromium.sites[0]?.entry).toBe("about.html");

    const bad = await processor.process(input({ entry: "../x.html" }));
    expect(bad).toMatchObject({
      ok: false,
      error: { code: "unprocessable_entity", retryable: false },
    });
    const missing = await processor.process(input({ entry: "nope.html" }));
    expect(missing).toMatchObject({
      ok: false,
      error: {
        code: "unprocessable_entity",
        retryable: false,
        message: htmlZipRefusalMessage({ kind: "entry_not_found" }),
      },
    });
  });
});
