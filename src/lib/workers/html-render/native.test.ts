import { describe, expect, it, vi } from "vitest";
import {
  CHROMIUM_ENV_PASSTHROUGH,
  HTML_DOCUMENT_URL,
  chromiumArgs,
  chromiumEnv,
  createNativeChromiumPdfRunner,
  htmlDocumentContentType,
  nativeHtmlRenderDeps,
  probeChromiumFromConfig,
  PRINT_TO_PDF_OPTIONS,
  UNLINK_SYNTHETIC_ORIGIN,
  VIRTUAL_TIME_BUDGET_MS,
  type ChromiumLaunch,
} from "./native";
import type { NativeHtmlRenderConfig } from "./native-config";
import type { RenderNetworkSeams } from "./network";
import { WebpageFetchError, type WebpageFetchFailure } from "./engine";
import { DEFAULT_HTML_RENDER_OPTIONS } from "@/lib/jobs/html-render-options";
import { DEFAULT_WEBPAGE_CAPTURE_OPTIONS } from "@/lib/jobs/webpage-capture-options";
import { HIDE_OVERLAYS_SCRIPT } from "./overlays";
import {
  LAZY_SCROLL_MAX_MS,
  LAZY_SCROLL_MEASURE,
  LAZY_SCROLL_NEXT_FRAMES,
  LAZY_SCROLL_SETTLE_MS,
  LAZY_SCROLL_STEP_MS,
  lazyScrollPositions,
  lazyScrollTo,
} from "./lazy-scroll";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const HTML = new TextEncoder().encode("<h1>Hello</h1>");
const config: NativeHtmlRenderConfig = {
  enabled: true,
  candidates: ["chromium"],
  overridden: false,
  timeoutMs: 10_000,
  maxInputBytes: 1000,
  maxOutputBytes: 1000,
  tmpDir: "/tmp",
};

interface Sent {
  id: number;
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

interface Paused {
  url: string;
  resourceType?: string;
  /** Default "T", the main frame. Anything else is a child frame. */
  frameId?: string;
}

/**
 * A fake browser on the other end of the CDP pipe. It answers the commands a
 * render sends, pauses the requests a page would make, and records every
 * command — so a test can assert what Chromium was TOLD, in what order.
 */
function fakeChromium(
  opts: {
    pdf?: Uint8Array;
    navError?: string;
    paused?: Paused[];
    /** Requests the page makes once loaded, while its virtual time runs. */
    pausedAfterLoad?: Paused[];
    /**
     * How many loads, counted from the first, show Chromium's XML
     * `<parsererror>` in the DOM (a package document that is not
     * well-formed). Default 0.
     */
    parserErrorLoads?: number;
  } = {},
) {
  const sent: Sent[] = [];
  const launched: {
    command: string;
    args: readonly string[];
    env: Record<string, string>;
  }[] = [];
  const launch: ChromiumLaunch = (command, args, options) => {
    launched.push({ command, args, env: options.env });
    let onData: (chunk: Buffer) => void = () => {};
    let exit: () => void = () => {};
    const exited = new Promise<void>((resolve) => (exit = resolve));
    const emit = (message: unknown) =>
      setTimeout(() => onData(Buffer.from(`${JSON.stringify(message)}\0`)));
    const outstanding = new Set<string>();
    let navReply: (() => void) | null = null;
    let budgetReply: (() => void) | null = null;
    const pause = (p: Paused, requestId: string) => {
      outstanding.add(requestId);
      emit({
        method: "Fetch.requestPaused",
        sessionId: "S",
        params: {
          requestId,
          request: { url: p.url, method: "GET", headers: {} },
          frameId: p.frameId ?? "T",
          resourceType: p.resourceType ?? "Image",
        },
      });
    };
    const reply = (msg: Sent, result: unknown) =>
      emit({ id: msg.id, result, sessionId: msg.sessionId });
    let loads = 0;

    const handle = (msg: Sent) => {
      sent.push(msg);
      const requestId = msg.params.requestId as string | undefined;
      switch (msg.method) {
        case "Target.createTarget":
          return reply(msg, { targetId: "T" });
        case "Target.attachToTarget":
          return reply(msg, { sessionId: "S" });
        case "Page.getFrameTree":
          return reply(msg, { frameTree: { frame: { id: "T" } } });
        case "Page.navigate": {
          loads += 1;
          const url = msg.params.url as string;
          const pauses: Paused[] = [
            { url, resourceType: "Document" },
            ...(opts.paused ?? []),
          ];
          pauses.forEach((p, i) => pause(p, `r${i}`));
          navReply = () =>
            reply(
              msg,
              opts.navError ? { errorText: opts.navError } : { frameId: "T" },
            );
          return;
        }
        case "Fetch.fulfillRequest":
        case "Fetch.failRequest":
          reply(msg, {});
          if (requestId) outstanding.delete(requestId);
          if (outstanding.size === 0 && navReply) {
            navReply();
            navReply = null;
          }
          if (outstanding.size === 0 && budgetReply) {
            budgetReply();
            budgetReply = null;
          }
          return;
        case "Emulation.setVirtualTimePolicy": {
          reply(msg, {});
          const expire = () =>
            emit({
              method: "Emulation.virtualTimeBudgetExpired",
              sessionId: "S",
              params: {},
            });
          const later = opts.pausedAfterLoad ?? [];
          if (later.length === 0) return expire();
          budgetReply = expire;
          later.forEach((p, i) => pause(p, `a${i}`));
          return;
        }
        case "Page.printToPDF":
          return reply(msg, { stream: "H" });
        case "DOM.getDocument":
          return reply(msg, { root: { nodeId: 1 } });
        case "DOM.querySelector":
          return reply(msg, {
            nodeId:
              msg.params.selector === "parsererror" &&
              loads <= (opts.parserErrorLoads ?? 0)
                ? 9
                : 0,
          });
        case "Page.createIsolatedWorld":
          return reply(msg, { executionContextId: 7 });
        case "Runtime.evaluate":
          // A page three screens tall, for the scroll pass's measure.
          return reply(
            msg,
            msg.params.expression === LAZY_SCROLL_MEASURE
              ? { result: { value: { height: 3000, viewport: 800 } } }
              : {},
          );
        case "Page.getLayoutMetrics":
          return reply(msg, { cssContentSize: { height: 2400 } });
        case "IO.read":
          return reply(msg, {
            data: Buffer.from(opts.pdf ?? PDF).toString("base64"),
            base64Encoded: true,
            eof: true,
          });
        default:
          return reply(msg, {});
      }
    };
    return {
      pipe: {
        write: (message) => handle(JSON.parse(message.slice(0, -1)) as Sent),
        onData: (listener) => {
          onData = listener;
        },
        onClose: () => {},
      },
      kill: () => exit(),
      exited,
    };
  };
  return { launch, sent, launched };
}

function fsStub() {
  return {
    mkdtemp: vi.fn(async () => "/tmp/pdfxyz-html-1"),
    rm: vi.fn(async () => {}),
  };
}

const publicNet: RenderNetworkSeams = {
  resolve: async (host) =>
    host === "public.example"
      ? [{ address: "93.184.215.14", family: 4 }]
      : host === "rebind.example"
        ? [
            { address: "93.184.215.14", family: 4 },
            { address: "10.0.0.5", family: 4 },
          ]
        : [],
  fetch: async () => ({
    status: 200,
    rawHeaders: ["Content-Type", "image/png"],
    body: new Uint8Array([1, 2, 3]),
  }),
};

function runner(fake: ReturnType<typeof fakeChromium>, extra = {}) {
  return createNativeChromiumPdfRunner(config, {
    launch: fake.launch,
    fs: fsStub(),
    resolveOnPath: () => true,
    network: publicNet,
    ...extra,
  });
}

describe("native Chromium HTML renderer", () => {
  /*
   * INVERTED 2026-09. This test used to pin the defect:
   *
   *   expect(chromiumPdfArgs("/tmp/in.html", "/tmp/out.pdf")).toEqual([
   *     "--headless=new", …, "--print-to-pdf=/tmp/out.pdf", "/tmp/in.html"])
   *
   * and its sibling asserted the argv carried
   * `pathToFileURL(join(dir, "input.html"))` — i.e. that Chromium READ THE
   * UPLOAD FROM A file:// URL, which is what let an uploaded page iframe any
   * file on the worker. Now the argv must name no document at all.
   */
  it("argv names no document and no file:// URL; the network is a dead end", () => {
    const args = chromiumArgs("/tmp/pdfxyz-html-1/profile");
    expect(args.filter((a) => /file:|\.html\b|print-to-pdf/i.test(a))).toEqual(
      [],
    );
    expect(args).toContain("--remote-debugging-pipe");
    expect(args).toContain("--user-data-dir=/tmp/pdfxyz-html-1/profile");
    expect(args).toContain("--host-resolver-rules=MAP * ~NOTFOUND");
    expect(args).toContain("--proxy-bypass-list=<-loopback>");
    expect(args.some((a) => a.startsWith("--proxy-server="))).toBe(true);
    // No flag that opens a debugging PORT anyone else could attach to.
    expect(args.filter((a) => a.startsWith("--remote-debugging-port"))).toEqual(
      [],
    );
  });

  it("Chromium never inherits the worker's environment", async () => {
    const secrets = {
      PDFXYZ_S3_SECRET_ACCESS_KEY: "s3-canary",
      PDFXYZ_REDIS_REST_TOKEN: "redis-canary",
      PDFXYZ_AI_API_KEY: "ai-canary",
      OPENAI_API_KEY: "openai-canary",
    };
    const parentEnv = { ...secrets, PATH: "/usr/bin:/bin", LANG: "C.UTF-8" };
    const fake = fakeChromium();
    await runner(fake, { parentEnv, platform: "linux" }).renderHtml(HTML);
    const { env } = fake.launched[0]!;
    const leaked = Object.entries(env).filter(([, v]) =>
      Object.values(secrets).includes(v),
    );
    expect(leaked).toEqual([]);
    // Positive control: what SHOULD pass through does.
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/tmp/pdfxyz-html-1");
    // And the allowlist is the whole story: nothing outside it plus the
    // per-job directories.
    const allowed = new Set([
      ...CHROMIUM_ENV_PASSTHROUGH,
      "HOME",
      "TMPDIR",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
    ]);
    expect(Object.keys(env).filter((k) => !allowed.has(k))).toEqual([]);
  });

  it("on Windows keeps only the system roots Chromium needs", () => {
    const env = chromiumEnv(
      "C:\\job",
      { Path: "C:\\bin", SystemRoot: "C:\\Windows", SECRET: "x" },
      "win32",
    );
    expect(env.PATH).toBe("C:\\bin");
    expect(env.SystemRoot).toBe("C:\\Windows");
    expect(Object.values(env)).not.toContain("x");
  });

  it("serves the upload as an https document — never from disk — with interception on first", async () => {
    const fake = fakeChromium();
    const output = await runner(fake).renderHtml(HTML);
    expect([...output]).toEqual([...PDF]);

    const methods = fake.sent.map((m) => m.method);
    const nav = fake.sent.find((m) => m.method === "Page.navigate")!;
    expect(nav.params.url).toBe(HTML_DOCUMENT_URL);
    expect(String(nav.params.url).startsWith("file:")).toBe(false);
    // ORDER: interception must exist before the first request does.
    expect(methods.indexOf("Fetch.enable")).toBeGreaterThanOrEqual(0);
    expect(methods.indexOf("Fetch.enable")).toBeLessThan(
      methods.indexOf("Page.navigate"),
    );
    const doc = fake.sent.find(
      (m) => m.method === "Fetch.fulfillRequest" && m.params.requestId === "r0",
    )!;
    expect(Buffer.from(String(doc.params.body), "base64").toString()).toBe(
      "<h1>Hello</h1>",
    );
  });

  /*
   * Audit #5 (2026-11-06): the upload was served as bare `text/html`, so a
   * UTF-8 file with no declaration decoded as windows-1252 ("cafÃ©"). The
   * decoded-PDF proof is in native.chromium.test.ts; this pins the header.
   */
  it("serves an undeclared UTF-8 upload as UTF-8", async () => {
    const fake = fakeChromium();
    await runner(fake).renderHtml(new TextEncoder().encode("<h1>café</h1>"));
    const doc = fake.sent.find(
      (m) => m.method === "Fetch.fulfillRequest" && m.params.requestId === "r0",
    )!;
    expect(doc.params.responseHeaders).toEqual([
      { name: "Content-Type", value: "text/html; charset=utf-8" },
    ]);
  });

  /*
   * Audit #48 (2026-11-06): an upload's relative links printed as links to
   * the synthetic origin. The decoded-annotation proof is in
   * native.chromium.test.ts; this pins the ORDER — unlinked before printing —
   * and that a webpage's own links are never touched.
   */
  it("unlinks an upload's synthetic-origin links before printing, and only an upload's", async () => {
    const fake = fakeChromium();
    await runner(fake).renderHtml(HTML);
    const methods = fake.sent.map((m) => m.method);
    const unlink = fake.sent.findIndex(
      (m) =>
        m.method === "Runtime.evaluate" &&
        m.params.expression === UNLINK_SYNTHETIC_ORIGIN,
    );
    expect(unlink).toBeGreaterThan(methods.indexOf("Page.navigate"));
    expect(unlink).toBeLessThan(methods.indexOf("Page.printToPDF"));

    const web = fakeChromium();
    await runner(web)
      .renderUrl("https://public.example/")
      .catch(() => {});
    // Health check: the webpage really reached the print, so the absence
    // below is not a render that stopped early.
    expect(web.sent.map((m) => m.method)).toContain("Page.printToPDF");
    // CHANGED 2026-11-08 (audit webpage-to-pdf#4): this asserted no
    // Runtime.evaluate at all for a webpage. A webpage now evaluates the
    // scroll pass's measure, so the property is stated as what it always
    // meant: the UNLINK script never runs on a webpage.
    expect(
      web.sent.filter(
        (m) =>
          m.method === "Runtime.evaluate" &&
          m.params.expression === UNLINK_SYNTHETIC_ORIGIN,
      ),
    ).toEqual([]);
    expect(
      web.sent.filter((m) => m.method === "Runtime.evaluate").length,
    ).toBeGreaterThan(0);
  });

  /*
   * Review of a5d422c3 (audit #6): the reload-as-HTML sequence was proven
   * only through a real Chromium, which never shows a chapter that fails
   * BOTH parsers — so the refusal to print the banner had no test at all.
   */
  describe("a package document Chromium's XML parser rejects", () => {
    const chapter = `${HTML_DOCUMENT_URL}OEBPS/ch1.xhtml`;
    const XHTML =
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title/>' +
      '<style type="text/css"/></head><body><p>BODY&nbsp;TEXT</p>' +
      '<a id="p5"/>after<br/><img src="i.png" alt=""/></body></html>';
    const pkg = {
      documents: [{ url: chapter, viewport: null, printParams: {} }],
      serve: (url: string) =>
        url === chapter
          ? {
              body: new TextEncoder().encode(XHTML),
              contentType: "application/xhtml+xml",
            }
          : null,
    };
    const chapterAnswers = (fake: ReturnType<typeof fakeChromium>) =>
      fake.sent.filter(
        (m) =>
          m.method === "Fetch.fulfillRequest" &&
          m.params.responseCode === 200 &&
          (m.params.responseHeaders as { value: string }[]).length === 1,
      );

    it("is loaded again as text/html, and printed once", async () => {
      const fake = fakeChromium({ parserErrorLoads: 1 });
      const pdfs = await runner(fake).renderPackage(pkg);
      expect(pdfs).toHaveLength(1);
      const answers = chapterAnswers(fake);
      expect(answers).toHaveLength(2);
      expect(answers.map((m) => m.params.responseHeaders)).toEqual([
        [{ name: "Content-Type", value: "application/xhtml+xml" }],
        [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
      ]);
      expect(
        fake.sent.filter((m) => m.method === "Page.printToPDF"),
      ).toHaveLength(1);
    });

    /*
     * Review of a5d422c3: the HTML parser reads `<title/>` as an OPEN title,
     * which swallows the chapter as title text — silently, past the second
     * parsererror check. An XHTML empty element is served as an open-close
     * pair; a void element (`<br/>`, `<img/>`) is left alone.
     */
    it("is served with its empty elements as open-close pairs", async () => {
      const fake = fakeChromium({ parserErrorLoads: 1 });
      await runner(fake).renderPackage(pkg);
      const [first, second] = chapterAnswers(fake).map((m) =>
        Buffer.from(m.params.body as string, "base64").toString("utf8"),
      );
      expect(first).toBe(XHTML);
      expect(second).toBe(
        XHTML.replace("<title/>", "<title></title>")
          .replace(
            '<style type="text/css"/>',
            '<style type="text/css"></style>',
          )
          .replace('<a id="p5"/>', '<a id="p5"></a>'),
      );
      // Health check: the void elements really are in what was served.
      expect(second).toContain("<br/>");
      expect(second).toContain('<img src="i.png" alt=""/>');
    });

    it("fails the render when the HTML parser rejects it too; nothing is printed", async () => {
      const fake = fakeChromium({ parserErrorLoads: 2 });
      await expect(runner(fake).renderPackage(pkg)).rejects.toThrow(
        /could not be parsed as XML or HTML/,
      );
      // Health check: the reload really happened, so the absence of a print
      // below is the refusal, not a render that stopped at the first load.
      expect(chapterAnswers(fake)).toHaveLength(2);
      expect(fake.sent.map((m) => m.method)).not.toContain("Page.printToPDF");
    });
  });

  it("leaves a BOM, a declared charset, or non-UTF-8 bytes to Chromium", () => {
    const utf8 = (s: string) => new TextEncoder().encode(s);
    expect(htmlDocumentContentType(utf8("<p>café</p>"))).toBe(
      "text/html; charset=utf-8",
    );
    expect(
      htmlDocumentContentType(
        new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("<p>café</p>")]),
      ),
    ).toBe("text/html");
    expect(
      htmlDocumentContentType(utf8('<meta charset="windows-1252"><p>x</p>')),
    ).toBe("text/html");
    expect(
      htmlDocumentContentType(
        utf8(
          '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=iso-8859-1">',
        ),
      ),
    ).toBe("text/html");
    /*
     * Review of 9b169477: "charset=" anywhere counted as a declaration, so
     * these undeclared UTF-8 files stayed windows-1252. A declaration is a
     * meta tag's own charset attribute naming a real encoding, or an
     * http-equiv Content-Type meta — in the first 1024 bytes, outside
     * comments, where Chromium's prescan looks.
     */
    const undeclared = [
      "<p>Set charset= in your page. café</p>",
      '<meta name="description" content="on charset=utf-8 errors"><p>café</p>',
      "<p>prose: <meta charset= here café</p>",
      '<!-- <meta charset="windows-1252"> --><p>café</p>',
      `<p>${"x".repeat(1100)}</p><meta charset="windows-1252"><p>café</p>`,
    ];
    for (const html of undeclared)
      expect(htmlDocumentContentType(utf8(html)), html).toBe(
        "text/html; charset=utf-8",
      );
    expect(
      htmlDocumentContentType(utf8("<meta charset=windows-1252><p>café</p>")),
    ).toBe("text/html");
    expect(
      htmlDocumentContentType(
        utf8(
          "<meta content='text/html; charset=iso-8859-1' http-equiv=content-type>",
        ),
      ),
    ).toBe("text/html");
    // "café" in windows-1252, undeclared: not UTF-8, so the old default.
    expect(
      htmlDocumentContentType(new Uint8Array([0x63, 0x61, 0x66, 0xe9])),
    ).toBe("text/html");
  });

  /*
   * The mechanism half of the header/footer fix. The property half — the
   * decoded PDF carries no title, date or address — is read back from a real
   * Chromium in native.chromium.test.ts; this one runs everywhere.
   */
  it("asks Chromium for the page alone — no print header or footer — for both render kinds", async () => {
    for (const render of [
      (r: ReturnType<typeof runner>) => r.renderHtml(HTML),
      (r: ReturnType<typeof runner>) => r.renderUrl("https://public.example/"),
    ]) {
      const fake = fakeChromium();
      await render(runner(fake));
      const prints = fake.sent.filter((m) => m.method === "Page.printToPDF");
      expect(prints).toHaveLength(1);
      expect(prints[0]!.params.displayHeaderFooter).toBe(false);
      // The call IS the exported object the tool pages are held to, not a
      // second copy of it that could drift.
      expect(prints[0]!.params).toMatchObject(PRINT_TO_PDF_OPTIONS);
    }
  });

  it("with no layout asked for, it emulates nothing and measures nothing", async () => {
    const fake = fakeChromium();
    await runner(fake).renderHtml(HTML);
    const methods = fake.sent.map((m) => m.method);
    expect(methods).not.toContain("Emulation.setDeviceMetricsOverride");
    expect(methods).not.toContain("Emulation.setEmulatedMedia");
    expect(methods).not.toContain("Page.getLayoutMetrics");
    const print = fake.sent.find((m) => m.method === "Page.printToPDF")!;
    const { transferMode, ...params } = print.params;
    expect(transferMode).toBe("ReturnAsStream");
    expect(params).toEqual(PRINT_TO_PDF_OPTIONS);
  });

  it("a screen width is emulated BEFORE the page loads; one long page is measured in print layout BEFORE printing", async () => {
    const fake = fakeChromium();
    await runner(fake).renderUrl("https://public.example/", {
      ...DEFAULT_HTML_RENDER_OPTIONS,
      pageSize: "A4",
      viewport: "desktop",
      onePage: true,
    });
    const methods = fake.sent.map((m) => m.method);
    const at = (m: string) => methods.indexOf(m);
    const firstOverride = fake.sent.find(
      (m) => m.method === "Emulation.setDeviceMetricsOverride",
    )!;
    expect(firstOverride.params).toMatchObject({ width: 1280, height: 800 });
    expect(at("Emulation.setDeviceMetricsOverride")).toBeLessThan(
      at("Page.navigate"),
    );
    expect(
      fake.sent.find((m) => m.method === "Emulation.setEmulatedMedia")!.params,
    ).toEqual({ media: "print" });
    expect(at("Emulation.setVirtualTimePolicy")).toBeLessThan(
      at("Page.getLayoutMetrics"),
    );
    expect(at("Page.getLayoutMetrics")).toBeLessThan(at("Page.printToPDF"));
    // The page height is the MEASURED one (2400px from the fake's layout).
    const print = fake.sent.find((m) => m.method === "Page.printToPDF")!;
    const scale = print.params.scale as number;
    expect(print.params.paperHeight as number).toBeCloseTo(
      ((2400 + 16) * scale) / 96 + 0.8,
      9,
    );
    expect(print.params.displayHeaderFooter).toBe(false);
  });

  it("Hide cookie notices and pop-ups runs its script in an isolated world after the page's time, before printing — and only when asked, only for a webpage (audit webpage-to-pdf#1)", async () => {
    const evaluated = (fake: ReturnType<typeof fakeChromium>) =>
      fake.sent.filter(
        (m) =>
          m.method === "Runtime.evaluate" &&
          m.params.expression === HIDE_OVERLAYS_SCRIPT,
      );
    const fake = fakeChromium();
    await runner(fake).renderUrl(
      "https://public.example/",
      DEFAULT_HTML_RENDER_OPTIONS,
      {},
      { ...DEFAULT_WEBPAGE_CAPTURE_OPTIONS, hideOverlays: true },
    );
    const hits = evaluated(fake);
    expect(hits).toHaveLength(1);
    expect(typeof hits[0]!.params.contextId).toBe("number");
    const at = (m: Sent) => fake.sent.indexOf(m);
    const budget = fake.sent.find(
      (m) => m.method === "Emulation.setVirtualTimePolicy",
    )!;
    const print = fake.sent.find((m) => m.method === "Page.printToPDF")!;
    expect(at(budget)).toBeLessThan(at(hits[0]!));
    expect(at(hits[0]!)).toBeLessThan(at(print));

    for (const off of [
      (r: ReturnType<typeof runner>) => r.renderUrl("https://public.example/"),
      (r: ReturnType<typeof runner>) => r.renderHtml(HTML),
    ]) {
      const quiet = fakeChromium();
      await off(runner(quiet));
      expect(evaluated(quiet)).toEqual([]);
    }
  });

  it("Use the site's print styles unticked sends screen media before measuring and printing — and nothing by default (audit webpage-to-pdf#3)", async () => {
    const media = (fake: ReturnType<typeof fakeChromium>) =>
      fake.sent.filter((m) => m.method === "Emulation.setEmulatedMedia");
    const fake = fakeChromium();
    await runner(fake).renderUrl(
      "https://public.example/",
      { ...DEFAULT_HTML_RENDER_OPTIONS, onePage: true },
      {},
      { ...DEFAULT_WEBPAGE_CAPTURE_OPTIONS, printStyles: false },
    );
    const sent = media(fake);
    expect(sent.map((m) => m.params)).toEqual([
      { media: "screen" },
      { media: "screen" },
    ]);
    const at = (m: Sent) => fake.sent.indexOf(m);
    const measure = fake.sent.find(
      (m) => m.method === "Page.getLayoutMetrics",
    )!;
    const print = fake.sent.find((m) => m.method === "Page.printToPDF")!;
    expect(at(sent[1]!)).toBeLessThan(at(measure));
    expect(at(measure)).toBeLessThan(at(print));

    const quiet = fakeChromium();
    await runner(quiet).renderUrl("https://public.example/");
    expect(media(quiet)).toEqual([]);
  });

  it("a webpage is scrolled down a screen at a time after its budget, given time at each stop, and scrolled back before printing; an upload never (audit webpage-to-pdf#4)", async () => {
    const fake = fakeChromium();
    await runner(fake).renderUrl("https://public.example/");
    const evals = fake.sent
      .filter((m) => m.method === "Runtime.evaluate")
      .map((m) => m.params.expression as string);
    const scrolls = evals.filter((e) => e.startsWith("window.scrollTo"));
    expect(scrolls).toEqual([
      ...lazyScrollPositions(3000, 800).map(lazyScrollTo),
      lazyScrollTo(0),
    ]);
    expect(scrolls).toHaveLength(4);
    // After each scroll: a wait for frames, then that stop's page time.
    const budgets = fake.sent
      .filter((m) => m.method === "Emulation.setVirtualTimePolicy")
      .map((m) => m.params.budget as number);
    expect(budgets).toEqual([
      VIRTUAL_TIME_BUDGET_MS,
      LAZY_SCROLL_STEP_MS,
      LAZY_SCROLL_STEP_MS,
      LAZY_SCROLL_STEP_MS,
      LAZY_SCROLL_SETTLE_MS,
    ]);
    expect(budgets.slice(1).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(
      LAZY_SCROLL_MAX_MS,
    );
    expect(evals.filter((e) => e === LAZY_SCROLL_NEXT_FRAMES).length).toBe(4);
    const at = (pred: (m: Sent) => boolean) => fake.sent.findIndex(pred);
    const lastScroll = fake.sent
      .map((m, i) => ({ m, i }))
      .filter(
        ({ m }) =>
          m.method === "Runtime.evaluate" &&
          m.params.expression === lazyScrollTo(0),
      )
      .map(({ i }) => i)
      .pop()!;
    expect(
      at((m) => m.method === "Emulation.setVirtualTimePolicy"),
    ).toBeLessThan(at((m) => m.params.expression === LAZY_SCROLL_MEASURE));
    expect(lastScroll).toBeLessThan(at((m) => m.method === "Page.printToPDF"));

    const upload = fakeChromium();
    await runner(upload).renderHtml(HTML);
    expect(
      upload.sent.filter(
        (m) =>
          m.method === "Runtime.evaluate" &&
          (m.params.expression === LAZY_SCROLL_MEASURE ||
            String(m.params.expression).startsWith("window.scrollTo")),
      ),
    ).toEqual([]);
  });

  it("every other request goes through the network policy", async () => {
    const fake = fakeChromium({
      paused: [
        { url: "file:///etc/passwd" },
        { url: "http://169.254.169.254/latest/meta-data/" },
        { url: "http://[::ffff:127.0.0.1]/" },
        { url: "https://rebind.example/x.png" },
        { url: `${HTML_DOCUMENT_URL}again`, resourceType: "Document" },
        { url: "https://public.example/logo.png" },
      ],
    });
    await runner(fake).renderHtml(HTML);
    const outcome = (id: string) =>
      fake.sent.find(
        (m) =>
          (m.method === "Fetch.failRequest" ||
            m.method === "Fetch.fulfillRequest") &&
          m.params.requestId === id,
      )?.method;
    expect([1, 2, 3, 4, 5].map((i) => outcome(`r${i}`))).toEqual(
      new Array(5).fill("Fetch.failRequest"),
    );
    // Positive control: a public request IS fetched and handed to Chromium.
    expect(outcome("r6")).toBe("Fetch.fulfillRequest");
    // And Chromium itself was never told to continue anything on its own.
    expect(
      fake.sent.filter((m) => m.method === "Fetch.continueRequest"),
    ).toEqual([]);
  });

  it("renders a URL through the same interception", async () => {
    const fake = fakeChromium();
    await expect(
      runner(fake).renderUrl("https://public.example/"),
    ).resolves.toBeInstanceOf(Uint8Array);
    const nav = fake.sent.find((m) => m.method === "Page.navigate")!;
    expect(nav.params.url).toBe("https://public.example/");
    const top = fake.sent.find((m) => m.params.requestId === "r0")!;
    expect(top.method).toBe("Fetch.fulfillRequest");
  });

  /*
   * CHANGED 2026-09. This asserted only `.rejects.toThrow(/failed/i)` for a
   * webpage, and the render wrapped every error into one generic sentence, so
   * the user never learned WHAT failed. A navigation Chromium refused, with no
   * site answer to explain it, is now its own named failure.
   */
  it("fails on a navigation Chromium refused, or unusable output", async () => {
    expect(
      await failureOf(
        runner(fakeChromium({ navError: "net::ERR_ABORTED" })).renderUrl(
          "https://public.example/",
        ),
      ),
    ).toEqual({ reason: "navigation", errorText: "net::ERR_ABORTED" });
    // An upload has no site: its navigation failing stays the renderer's.
    await expect(
      runner(
        fakeChromium({ navError: "net::ERR_BLOCKED_BY_CLIENT" }),
      ).renderHtml(HTML),
    ).rejects.toThrow(/navigation failed/);
    await expect(
      runner(
        fakeChromium({ pdf: new TextEncoder().encode("not pdf") }),
      ).renderHtml(HTML),
    ).rejects.toThrow(/usable PDF/i);
  });

  it("probes candidates and wires deps only when Chromium is available", () => {
    expect(
      probeChromiumFromConfig(config, {
        resolveOnPath: (bin) => bin === "chromium",
      }),
    ).toBe("chromium");
    expect(
      nativeHtmlRenderDeps({}, { resolveOnPath: () => false }).chromium,
    ).toBeUndefined();
    expect(
      nativeHtmlRenderDeps({}, { resolveOnPath: () => true }).chromium,
    ).toBeDefined();
  });
});

/** A site on public.example: every path answers 200 unless `answers` says. */
function site(
  answers: Record<string, { status: number; headers?: string[] }>,
): RenderNetworkSeams {
  return {
    resolve: publicNet.resolve,
    fetch: async (url) => {
      const answer = answers[url.pathname] ?? { status: 200 };
      return {
        status: answer.status,
        rawHeaders: ["Content-Type", "text/html", ...(answer.headers ?? [])],
        body: new TextEncoder().encode(`<h1>${answer.status}</h1>`),
      };
    },
  };
}

/** The typed failure a render threw, null if it rendered, or the raw error. */
async function failureOf(
  render: Promise<Uint8Array>,
): Promise<WebpageFetchFailure | null | unknown> {
  try {
    await render;
    return null;
  } catch (error) {
    return error instanceof WebpageFetchError ? error.failure : error;
  }
}

/*
 * Until 2026-09 a webpage render succeeded whenever Chromium produced a PDF,
 * and a 404, a 500 or a bot-check page all produce one: the user was shown
 * "Your PDF is ready." over a PDF of the error. The main-frame document's
 * answer now decides - and ONLY the main frame's: an image or an iframe that
 * fails is part of a page, not a reason to refuse it.
 */
describe("a webpage render is the page the site answered with, or a named failure", () => {
  const renderPath = (seams: RenderNetworkSeams, fake = fakeChromium()) =>
    runner(fake, { network: seams }).renderUrl("https://public.example/page");

  it("a main-frame answer of 400 or above fails with that status; below 400 renders", async () => {
    // Both sides of the boundary, so a threshold off by one in either
    // direction goes red.
    const statuses = [200, 203, 399, 400, 401, 403, 404, 410, 429, 500, 503];
    const seen = [];
    for (const status of statuses)
      seen.push(await failureOf(renderPath(site({ "/page": { status } }))));
    expect(seen).toEqual(
      statuses.map((status) =>
        status >= 400 ? { reason: "http", status } : null,
      ),
    );
  });

  it("a failing image or child frame does not fail the page", async () => {
    const broken = site({
      "/missing.png": { status: 404 },
      "/missing-frame": { status: 500 },
    });
    const fake = fakeChromium({
      paused: [
        { url: "https://public.example/missing.png" },
        {
          url: "https://public.example/missing-frame",
          resourceType: "Document",
          frameId: "F1",
        },
      ],
    });
    expect(await failureOf(renderPath(broken, fake))).toBeNull();
    // Positive control: the same site's frame, loaded as THE page, is refused
    // - so the pass above is the frame rule, not a site that never fails.
    expect(
      await failureOf(
        runner(fakeChromium(), { network: broken }).renderUrl(
          "https://public.example/missing-frame",
        ),
      ),
    ).toEqual({ reason: "http", status: 500 });
  });

  it("names a bot-check answer as one - by the header the site sent, not by status alone", async () => {
    expect(
      await failureOf(
        renderPath(
          site({
            "/page": { status: 403, headers: ["cf-mitigated", "challenge"] },
          }),
        ),
      ),
    ).toEqual({ reason: "challenge", status: 403 });
    expect(
      await failureOf(renderPath(site({ "/page": { status: 403 } }))),
    ).toEqual({ reason: "http", status: 403 });
  });

  it("names what went wrong on the way to the page", async () => {
    const fetchThrows =
      (message: string): RenderNetworkSeams["fetch"] =>
      async () => {
        throw new Error(message);
      };
    const cases: [string, RenderNetworkSeams, WebpageFetchFailure][] = [
      ["https://nowhere.example/", publicNet, { reason: "unresolved" }],
      ["https://rebind.example/", publicNet, { reason: "blocked" }],
      [
        "https://public.example/",
        { resolve: publicNet.resolve, fetch: fetchThrows("timed out") },
        { reason: "unreachable" },
      ],
      [
        "https://public.example/",
        { resolve: publicNet.resolve, fetch: fetchThrows("ECONNREFUSED") },
        { reason: "unreachable" },
      ],
      [
        "https://public.example/",
        {
          resolve: publicNet.resolve,
          fetch: async () => ({
            status: 200,
            rawHeaders: ["Content-Encoding", "zstd-from-the-future"],
            body: new Uint8Array([1]),
          }),
        },
        { reason: "unreadable" },
      ],
    ];
    for (const [url, network, expected] of cases) {
      // Real Chromium ALSO reports these as errorText; the site's answer
      // outranks that summary of it.
      const fake = fakeChromium({ navError: "net::ERR_BLOCKED_BY_CLIENT" });
      expect(await failureOf(runner(fake, { network }).renderUrl(url))).toEqual(
        expected,
      );
    }
  });

  it("a redirect is judged by where it lands", async () => {
    const redirects = site({
      "/old": { status: 302, headers: ["Location", "/page"] },
      "/gone": { status: 301, headers: ["Location", "/missing"] },
      "/missing": { status: 404 },
    });
    const follow = (to: string) =>
      fakeChromium({
        paused: [
          { url: `https://public.example${to}`, resourceType: "Document" },
        ],
      });
    expect(
      await failureOf(
        runner(follow("/page"), { network: redirects }).renderUrl(
          "https://public.example/old",
        ),
      ),
    ).toBeNull();
    expect(
      await failureOf(
        runner(follow("/missing"), { network: redirects }).renderUrl(
          "https://public.example/gone",
        ),
      ),
    ).toEqual({ reason: "http", status: 404 });
  });

  it("a page that sends itself to an error after loading fails", async () => {
    const later = (to: string) =>
      fakeChromium({
        pausedAfterLoad: [
          { url: `https://public.example${to}`, resourceType: "Document" },
        ],
      });
    const answers = site({ "/missing": { status: 404 } });
    expect(await failureOf(renderPath(answers, later("/missing")))).toEqual({
      reason: "http",
      status: 404,
    });
    // Positive control: the same late navigation to a real page renders.
    expect(await failureOf(renderPath(answers, later("/fine")))).toBeNull();
  });

  it("an upload's own navigations are never judged as a site's answer", async () => {
    const fake = fakeChromium({
      paused: [
        { url: "https://public.example/missing", resourceType: "Document" },
      ],
    });
    await expect(
      runner(fake, {
        network: site({ "/missing": { status: 404 } }),
      }).renderHtml(HTML),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});
