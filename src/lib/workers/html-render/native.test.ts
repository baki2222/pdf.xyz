import { describe, expect, it, vi } from "vitest";
import {
  CHROMIUM_ENV_PASSTHROUGH,
  HTML_DOCUMENT_URL,
  chromiumArgs,
  chromiumEnv,
  createNativeChromiumPdfRunner,
  nativeHtmlRenderDeps,
  probeChromiumFromConfig,
  PRINT_TO_PDF_OPTIONS,
  type ChromiumLaunch,
} from "./native";
import type { NativeHtmlRenderConfig } from "./native-config";
import type { RenderNetworkSeams } from "./network";
import { WebpageFetchError, type WebpageFetchFailure } from "./engine";

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
