import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { looksLikePdf } from "../compression/engine";
import { CdpConnection, type CdpEvent, type CdpPipe } from "./cdp";
import { HTML_DOCUMENT_URL } from "./document-url";
import { htmlDocumentContentType } from "./charset";
import {
  WebpageFetchError,
  type ChromiumPackageRunner,
  type ChromiumPdfRunner,
  type DocumentPackage,
  type PackageDocument,
  type HtmlRenderDeps,
  type HtmlSite,
  type WebpageFetchFailure,
} from "./engine";
import {
  createRenderNetwork,
  type PausedRequest,
  type RenderNetworkSeams,
  type RequestDecision,
} from "./network";
import {
  resolveNativeHtmlRenderConfig,
  type NativeHtmlRenderConfig,
} from "./native-config";
import {
  planPrint,
  PRINT_TO_PDF_OPTIONS,
  type PrintPlan,
} from "./print-params";
import {
  DEFAULT_HTML_RENDER_OPTIONS,
  type HtmlRenderOptions,
} from "@/lib/jobs/html-render-options";
import {
  DEFAULT_WEBPAGE_CAPTURE_OPTIONS,
  type WebpageCaptureOptions,
} from "@/lib/jobs/webpage-capture-options";
import { HIDE_OVERLAYS_SCRIPT } from "./overlays";
import { stampFooterTemplate } from "./stamp";
import {
  LAZY_SCROLL_FRAME_WAIT_MS,
  LAZY_SCROLL_MEASURE,
  LAZY_SCROLL_NEXT_FRAMES,
  LAZY_SCROLL_SETTLE_MS,
  LAZY_SCROLL_STEP_MS,
  lazyScrollPositions,
  lazyScrollTo,
} from "./lazy-scroll";
import {
  AttemptAbortedError,
  signalOption,
  throwIfAttemptAborted,
  type RunControl,
} from "../attempt-abort";

/**
 * Chromium, driven over a CDP pipe, with every request it makes decided by
 * `./network`.
 *
 * History, kept because the previous shape was the defect: until 2026-09 this
 * module ran `chromium --print-to-pdf <file:///tmp/…/input.html>` with the
 * worker's full environment and Chromium's network wide open. An uploaded page
 * could `<iframe src="file:///…">` any file the worker could read, or any
 * internal address, and the answer came back printed in the PDF. Now:
 *   - the upload is served to Chromium as an https document it never reads
 *     from disk, so its origin is not `file:` and cannot load `file:` URLs;
 *   - every request, the top-level one included, is fulfilled by `./network`
 *     (public addresses only, connection pinned to the checked address);
 *   - Chromium's own network is dead (`--host-resolver-rules`, a dead proxy),
 *     so anything that escapes interception fails instead of connecting;
 *   - Chromium is spawned with a minimal environment, never the worker's.
 */

/** Virtual time a page gets for timers and late fetches — as the CLI's budget. */
export const VIRTUAL_TIME_BUDGET_MS = 10_000;

export { HTML_DOCUMENT_URL };
// Moved to `./charset` (2026-11-14) so the engine can decide a ZIP page's
// charset without importing the renderer; re-exported for its callers.
export { htmlDocumentContentType };

export interface ChromiumProcess {
  pipe: CdpPipe;
  kill(): void;
  /** Settles when the process has exited (or failed to start). */
  exited: Promise<void>;
}

export type ChromiumLaunch = (
  command: string,
  args: readonly string[],
  options: {
    env: Record<string, string>;
    windowsHide: boolean;
    /** The attempt's abort signal: Node kills the browser on abort. */
    signal?: AbortSignal;
  },
) => ChromiumProcess;

export interface ChromiumFs {
  mkdtemp: (prefix: string) => Promise<string>;
  rm: (
    dir: string,
    options: { recursive: boolean; force: boolean },
  ) => Promise<void>;
}

export interface ChromiumSeams {
  resolveOnPath?: (binary: string) => boolean;
  fileExists?: (filePath: string) => boolean;
  launch?: ChromiumLaunch;
  fs?: ChromiumFs;
  network?: RenderNetworkSeams;
  /**
   * Told of every request Chromium makes while rendering, BEFORE the policy
   * decides it — refused ones included — except the served upload itself.
   * Read-only: it cannot change a decision. `unbundled-assets.chromium.test.ts`
   * uses it to see what the renderer asks for at the upload's own address,
   * which the policy refuses before any fetch seam could see it.
   */
  onRequest?: (request: { url: string; resourceType?: string }) => void;
  /** The clock the address-and-date stamp reads. Default `new Date()`. */
  now?: () => Date;
  /** The environment Chromium's must be CUT DOWN from. Default process.env. */
  parentEnv?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

/** The real launcher; exported so an abort test drives THIS function. */
export const defaultChromiumLaunch: ChromiumLaunch = (
  command,
  args,
  options,
) => {
  const child: ChildProcess = spawn(command, [...args], {
    // fd 3: we write commands; fd 4: Chromium writes replies.
    stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    env: options.env as NodeJS.ProcessEnv,
    windowsHide: options.windowsHide,
    ...signalOption(options.signal),
  });
  const input = child.stdio[3] as Writable;
  const output = child.stdio[4] as Readable;
  input.on("error", () => {});
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  return {
    pipe: {
      write: (message) => {
        input.write(message);
      },
      onData: (listener) => {
        output.on("data", listener);
      },
      onClose: (listener) => {
        output.on("close", () => listener("pipe closed"));
        child.once("error", (error) => listener(String(error)));
      },
    },
    kill: () => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    },
    exited,
  };
};

const defaultFs: ChromiumFs = {
  mkdtemp: (prefix) => mkdtemp(prefix),
  rm: (dir, options) => rm(dir, options),
};

function isRegularFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function resolveOnPath(binary: string): boolean {
  const pathVar = process.env.PATH ?? "";
  if (!pathVar) return false;
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts)
      if (isRegularFile(path.join(dir, binary + ext))) return true;
  }
  return false;
}

/**
 * Chromium's argv. Nothing here names the document: it arrives over the pipe.
 *
 * The network flags are a BACKSTOP, not the policy. Every request is fulfilled
 * by `./network` through CDP interception; these make sure that a request
 * which somehow escapes interception (a CORS preflight, a worker, a socket)
 * fails instead of connecting. Measured 2026-09 on chrome-headless-shell 151:
 * with either flag alone, `fetch()` to a hostname AND to a bare public IP both
 * fail; without them both succeed.
 */
export function chromiumArgs(profileDir: string): string[] {
  return [
    "--headless=new",
    "--disable-gpu",
    // Still required in the worker container, which has no seccomp profile or
    // user namespaces for Chromium's sandbox. Removing it is a separate change
    // that must be proven on the worker image first.
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--run-all-compositor-stages-before-draw",
    "--remote-debugging-pipe",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--mute-audio",
    // Backstop 1: no name resolves, and IP literals are mapped too.
    "--host-resolver-rules=MAP * ~NOTFOUND",
    // Backstop 2: every connection goes to a proxy that is not there —
    // loopback included, which Chromium would otherwise bypass implicitly.
    "--proxy-server=http://127.0.0.1:1",
    "--proxy-bypass-list=<-loopback>",
    // WebRTC must not open UDP around the proxy.
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "about:blank",
  ];
}

/** Environment variables Chromium may inherit. Everything else is dropped. */
export const CHROMIUM_ENV_PASSTHROUGH = ["PATH", "LANG", "LC_ALL", "TZ"];
const WINDOWS_ENV_PASSTHROUGH = ["SystemRoot", "windir"];

/**
 * The environment Chromium runs with: a PATH, locale, and a per-job home.
 * NEVER the worker's own — that holds storage, queue and AI credentials, and a
 * renderer has no use for any of them.
 */
export function chromiumEnv(
  jobDir: string,
  parent: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const env: Record<string, string> = {
    HOME: jobDir,
    TMPDIR: jobDir,
    XDG_CONFIG_HOME: jobDir,
    XDG_CACHE_HOME: jobDir,
  };
  const names =
    platform === "win32"
      ? [...CHROMIUM_ENV_PASSTHROUGH, ...WINDOWS_ENV_PASSTHROUGH]
      : CHROMIUM_ENV_PASSTHROUGH;
  for (const name of names) {
    const value =
      parent[name] ?? (platform === "win32" ? winGet(parent, name) : undefined);
    if (value) env[name] = value;
  }
  if (platform === "win32") {
    // Dev machines only (the worker is Linux). Not USERPROFILE/LOCALAPPDATA:
    // pointed at the job dir, branded Chrome 154 never answers the pipe.
    env.TEMP = jobDir;
    env.TMP = jobDir;
  }
  return env;
}

/** Windows env names are case-insensitive; a plain object is not. */
function winGet(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const key = Object.keys(env).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  return key ? env[key] : undefined;
}

export function probeChromiumFromConfig(
  config: NativeHtmlRenderConfig,
  seams: ChromiumSeams = {},
): string | null {
  if (!config.enabled) return null;
  const onPath = seams.resolveOnPath ?? resolveOnPath;
  const fileExists = seams.fileExists ?? isRegularFile;
  for (const candidate of config.candidates) {
    if (config.overridden ? fileExists(candidate) : onPath(candidate))
      return candidate;
  }
  return null;
}

type RenderTarget =
  | { kind: "html"; bytes: Uint8Array }
  /** A ZIP page (`./zip-site`): its entry, and its files at the origin. */
  | { kind: "site"; site: HtmlSite }
  | { kind: "url"; url: string; capture: WebpageCaptureOptions };

/**
 * What a main-frame document's answer says about the page a user asked for:
 * null when it IS a page (2xx, or a 3xx whose follow-up comes back through
 * here and replaces this verdict), otherwise why it is not.
 *
 * History: until 2026-09 the only success criteria were "Chromium exited 0"
 * and "the output starts %PDF-". A 404, a 500, a login wall or a Cloudflare
 * "Just a moment..." page is a successful navigation, so its page was printed
 * and handed back as "Your PDF is ready." The status is read here, from the
 * response this module itself fulfilled — never from a sub-resource, which
 * fails without failing the page.
 *
 * `cf-mitigated: challenge` is the one bot-check marker read, and only as a
 * header the site sent: it names the failure, while the 403 it arrives with
 * would fail the render anyway. A page title such as "Just a moment..." is
 * deliberately NOT read — a real page may carry those words — so a bot check
 * served with a 200 is still printed. That is a known gap, not a guarantee.
 */
export function mainDocumentVerdict(
  decision: RequestDecision,
): WebpageFetchFailure | null {
  if (decision.action === "fail") {
    switch (decision.reason) {
      case "BlockedByClient":
      case "AccessDenied":
        return { reason: "blocked" };
      case "NameNotResolved":
        return { reason: "unresolved" };
      case "ConnectionFailed":
      case "TimedOut":
        return { reason: "unreachable" };
      case "Failed":
        return { reason: "unreadable" };
    }
  }
  const challenged = decision.headers.some(
    (h) =>
      h.name.toLowerCase() === "cf-mitigated" &&
      h.value.trim().toLowerCase() === "challenge",
  );
  if (challenged) return { reason: "challenge", status: decision.status };
  if (decision.status >= 400)
    return { reason: "http", status: decision.status };
  return null;
}

/** HTML's void elements: the only ones whose `<x/>` the HTML parser closes. */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** A self-closing start tag: its name, then its attributes as written. */
const SELF_CLOSING_TAG =
  /<([a-zA-Z][\w:.-]*)((?:\s+[^\s>"'/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/>/g;

/**
 * An XHTML document made ready for the HTML parser: every empty element
 * written `<x/>` that is not void becomes `<x></x>`. The HTML parser ignores
 * the slash, so `<title/>` OPENS a title and the rest of the chapter becomes
 * its text — lost silently, with no `<parsererror>` to see (review of
 * a5d422c3). Read as latin1, so every other byte is returned unchanged.
 */
export function xhtmlEmptyElementsForHtml(bytes: Uint8Array): Uint8Array {
  const text = Buffer.from(bytes).toString("latin1");
  const out = text.replace(
    SELF_CLOSING_TAG,
    (tag, name: string, attrs: string) =>
      VOID_ELEMENTS.has(name.toLowerCase())
        ? tag
        : `<${name}${attrs}></${name}>`,
  );
  return out === text ? bytes : new Uint8Array(Buffer.from(out, "latin1"));
}

/**
 * Run in the uploaded page before it prints: removes the `href` of every
 * `<a>`/`<area>` that resolves to {@link HTML_DOCUMENT_URL}'s origin, unless
 * it is a jump within the document itself (`#id`), which Chromium prints as
 * an in-PDF destination. A link the author pointed anywhere else is kept.
 */
export const UNLINK_SYNTHETIC_ORIGIN = `(() => {
  const origin = ${JSON.stringify(new URL(HTML_DOCUMENT_URL).origin)};
  const self = document.URL.split("#")[0];
  for (const a of document.querySelectorAll("a[href], area[href]")) {
    let u;
    try { u = new URL(a.href); } catch { continue; }
    if (u.origin !== origin) continue;
    if (u.hash && u.href.slice(0, -u.hash.length) === self) continue;
    a.removeAttribute("href");
  }
})()`;

// The print arguments, and the layout options that change them, live in
// `./print-params`; re-exported here, where the tests and tool pages read it.
export { PRINT_TO_PDF_OPTIONS };

const INTERCEPT_ALL = { patterns: [{ urlPattern: "*" }] };

/** Intercept on a session and on every frame/worker target under it. */
async function instrument(
  cdp: CdpConnection,
  sessionId: string,
  resume: boolean,
): Promise<void> {
  await cdp.send("Fetch.enable", INTERCEPT_ALL, sessionId).catch(() => {});
  await cdp
    .send(
      "Target.setAutoAttach",
      { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
      sessionId,
    )
    .catch(() => {});
  if (resume)
    await cdp
      .send("Runtime.runIfWaitingForDebugger", {}, sessionId)
      .catch(() => {});
}

/**
 * Page scripts off for a session. Awaited for a page, so a failure fails the
 * render (a package must never print with scripts running); best effort for
 * a target under it, such as a worker, which has no Emulation domain.
 */
async function noScripts(cdp: CdpConnection, sessionId: string): Promise<void> {
  await cdp.send(
    "Emulation.setScriptExecutionDisabled",
    { value: true },
    sessionId,
  );
}

/** `Page.printToPDF` as a stream, read in full within `maxBytes`. */
async function printToPdf(
  cdp: CdpConnection,
  sessionId: string,
  params: Record<string, unknown>,
  maxBytes: number,
): Promise<Uint8Array> {
  const { stream } = await cdp.send<{ stream: string }>(
    "Page.printToPDF",
    { ...params, transferMode: "ReturnAsStream" },
    sessionId,
  );
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const chunk = await cdp.send<{
      data: string;
      base64Encoded?: boolean;
      eof: boolean;
    }>("IO.read", { handle: stream, size: 1 << 20 }, sessionId);
    const bytes = Buffer.from(
      chunk.data,
      chunk.base64Encoded ? "base64" : "utf8",
    );
    size += bytes.byteLength;
    if (size > maxBytes)
      throw new Error("Chromium output exceeds the size limit.");
    chunks.push(bytes);
    if (chunk.eof) break;
  }
  await cdp.send("IO.close", { handle: stream }, sessionId).catch(() => {});
  return new Uint8Array(Buffer.concat(chunks));
}

export function createNativeChromiumPdfRunner(
  config: NativeHtmlRenderConfig,
  seams: ChromiumSeams = {},
): ChromiumPdfRunner & ChromiumPackageRunner {
  const launch = seams.launch ?? defaultChromiumLaunch;
  const fs = seams.fs ?? defaultFs;
  const baseTmp = config.tmpDir ?? tmpdir();
  const binary =
    probeChromiumFromConfig(config, seams) ??
    config.candidates[0] ??
    "chromium";

  async function drive(
    cdp: CdpConnection,
    target: RenderTarget,
    plan: PrintPlan,
  ): Promise<Uint8Array> {
    const network = createRenderNetwork(seams.network);
    let documentServed = false;
    let mainFrameId = "";
    /** The latest main-frame document's verdict (url renders only). */
    let pageVerdict: WebpageFetchFailure | null = null;

    const answer = async (event: CdpEvent): Promise<void> => {
      const p = event.params as {
        requestId: string;
        request: PausedRequest;
        frameId?: string;
        resourceType?: string;
      };
      const sessionId = event.sessionId;
      if (
        target.kind === "html" &&
        !documentServed &&
        p.request.url === HTML_DOCUMENT_URL &&
        p.resourceType === "Document" &&
        p.frameId === mainFrameId
      ) {
        documentServed = true;
        await cdp.send(
          "Fetch.fulfillRequest",
          {
            requestId: p.requestId,
            responseCode: 200,
            responseHeaders: [
              {
                name: "Content-Type",
                value: htmlDocumentContentType(target.bytes),
              },
            ],
            body: Buffer.from(target.bytes).toString("base64"),
          },
          sessionId,
        );
        return;
      }
      seams.onRequest?.({ url: p.request.url, resourceType: p.resourceType });
      // A ZIP page: every request at the document origin is answered from
      // the archive (404 when it names no servable entry, and for anything
      // but GET) and never reaches the network. Everything else is decided
      // by `./network` below, exactly as for an uploaded HTML file.
      if (
        target.kind === "site" &&
        p.request.url.startsWith(HTML_DOCUMENT_URL)
      ) {
        const hit =
          p.request.method === "GET" ? target.site.serve(p.request.url) : null;
        if (
          hit &&
          p.request.url === target.site.entryUrl &&
          p.resourceType === "Document" &&
          p.frameId === mainFrameId
        )
          documentServed = true;
        await cdp.send(
          "Fetch.fulfillRequest",
          {
            requestId: p.requestId,
            responseCode: hit ? 200 : 404,
            responseHeaders: [
              {
                name: "Content-Type",
                value: hit ? hit.contentType : "text/plain",
              },
              { name: "X-Content-Type-Options", value: "nosniff" },
            ],
            body: hit ? Buffer.from(hit.body).toString("base64") : "",
          },
          sessionId,
        );
        return;
      }
      const decision = await network.handle(p.request);
      // Recorded BEFORE Chromium is answered: Page.navigate settles on that
      // answer, and the verdict must already be here when it does.
      if (
        target.kind === "url" &&
        p.resourceType === "Document" &&
        p.frameId === mainFrameId
      )
        pageVerdict = mainDocumentVerdict(decision);
      if (decision.action === "fail") {
        await cdp.send(
          "Fetch.failRequest",
          { requestId: p.requestId, errorReason: decision.reason },
          sessionId,
        );
        return;
      }
      await cdp.send(
        "Fetch.fulfillRequest",
        {
          requestId: p.requestId,
          responseCode: decision.status,
          responseHeaders: decision.headers,
          body: Buffer.from(decision.body).toString("base64"),
        },
        sessionId,
      );
    };

    let budgetExpired: () => void = () => {};
    let pageSession = "";
    /**
     * Give the page `ms` of virtual time — paused while its fetches are
     * pending — and wait until Chromium says it is spent.
     */
    const spendVirtualTime = async (ms: number) => {
      const expired = new Promise<void>((resolve) => (budgetExpired = resolve));
      await cdp.send(
        "Emulation.setVirtualTimePolicy",
        { policy: "pauseIfNetworkFetchesPending", budget: ms },
        pageSession,
      );
      await expired;
    };

    cdp.on((event) => {
      if (event.method === "Fetch.requestPaused") {
        answer(event).catch(() => {
          const requestId = (event.params as { requestId?: string }).requestId;
          cdp
            .send(
              "Fetch.failRequest",
              { requestId, errorReason: "Failed" },
              event.sessionId,
            )
            .catch(() => {});
        });
      } else if (event.method === "Target.attachedToTarget") {
        const child = (event.params as { sessionId?: string }).sessionId;
        if (child) instrument(cdp, child, true).catch(() => {});
      } else if (
        event.method === "Emulation.virtualTimeBudgetExpired" &&
        event.sessionId === pageSession
      ) {
        budgetExpired();
      }
    });

    const { targetId } = await cdp.send<{ targetId: string }>(
      "Target.createTarget",
      { url: "about:blank" },
    );
    ({ sessionId: pageSession } = await cdp.send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId, flatten: true },
    ));
    // Interception is on BEFORE the first request exists.
    await instrument(cdp, pageSession, false);
    await cdp.send("Page.enable", {}, pageSession);
    const tree = await cdp.send<{ frameTree: { frame: { id: string } } }>(
      "Page.getFrameTree",
      {},
      pageSession,
    );
    mainFrameId = tree.frameTree.frame.id;
    // The screen the page loads into, when one was chosen: before the first
    // request, so scripts and media queries see it from the start.
    if (plan.viewport)
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { ...plan.viewport, deviceScaleFactor: 1, mobile: false },
        pageSession,
      );

    const url =
      target.kind === "html"
        ? HTML_DOCUMENT_URL
        : target.kind === "site"
          ? target.site.entryUrl
          : target.url;
    const nav = await cdp.send<{ errorText?: string }>(
      "Page.navigate",
      { url },
      pageSession,
    );
    if (target.kind === "url") {
      // The site's answer outranks Chromium's summary of it: a blocked
      // redirect and a refused download both arrive as `errorText`.
      if (pageVerdict) throw new WebpageFetchError(pageVerdict);
      if (nav.errorText)
        throw new WebpageFetchError({
          reason: "navigation",
          errorText: nav.errorText,
        });
    }
    if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText}`);
    if (target.kind !== "url" && !documentServed)
      throw new Error("the uploaded document was never served");

    await spendVirtualTime(VIRTUAL_TIME_BUDGET_MS);
    // Again after the page has run: a script or a meta refresh may have taken
    // the main frame somewhere that answered with an error.
    if (target.kind === "url" && pageVerdict)
      throw new WebpageFetchError(pageVerdict);

    /** A fresh isolated world: page script cannot redefine what runs in it. */
    const world = async (worldName: string) =>
      (
        await cdp.send<{ executionContextId: number }>(
          "Page.createIsolatedWorld",
          { frameId: mainFrameId, worldName },
          pageSession,
        )
      ).executionContextId;
    const evaluate = async (contextId: number, expression: string) =>
      (
        await cdp.send<{ result?: { value?: unknown } }>(
          "Runtime.evaluate",
          { expression, contextId, returnByValue: true },
          pageSession,
        )
      ).result?.value;
    const isolated = async (worldName: string, expression: string) =>
      evaluate(await world(worldName), expression);
    /**
     * Wait for two rendered frames, at most LAZY_SCROLL_FRAME_WAIT_MS of
     * real time: a scroll event and an IntersectionObserver callback are
     * delivered while a frame is rendered, not by virtual time — without
     * this wait neither fired (capture.chromium.test.ts).
     */
    const nextFrames = async (contextId: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        cdp
          .send(
            "Runtime.evaluate",
            {
              expression: LAZY_SCROLL_NEXT_FRAMES,
              contextId,
              awaitPromise: true,
            },
            pageSession,
          )
          .catch(() => {}),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, LAZY_SCROLL_FRAME_WAIT_MS);
        }),
      ]);
      clearTimeout(timer);
    };

    // The scroll pass (audit webpage-to-pdf#4): images a site loads only
    // when scrolled to are requested, and fetched within each step's time.
    // `./lazy-scroll` holds the bounds. Webpages only: an upload's page is
    // the user's own file.
    if (target.kind === "url") {
      const scroller = await world("pdfxyz-scroll");
      const size = (await evaluate(scroller, LAZY_SCROLL_MEASURE)) as {
        height?: unknown;
        viewport?: unknown;
      } | null;
      const steps = lazyScrollPositions(size?.height, size?.viewport);
      if (steps.length > 0) {
        for (const y of steps) {
          await evaluate(scroller, lazyScrollTo(y));
          await nextFrames(scroller);
          await spendVirtualTime(LAZY_SCROLL_STEP_MS);
        }
        await evaluate(scroller, lazyScrollTo(0));
        await nextFrames(scroller);
        await spendVirtualTime(LAZY_SCROLL_SETTLE_MS);
        // Scrolling runs page script too: judged again, as after the budget.
        if (pageVerdict) throw new WebpageFetchError(pageVerdict);
      }
    }

    // An upload's relative links resolve against the synthetic origin, and
    // Chromium would print them as clickable links to it (audit #48). They
    // are unlinked — their text stays — in an isolated world, so a page
    // script that redefined the DOM cannot skip it. In-page jumps stay.
    if (target.kind !== "url")
      await isolated("pdfxyz-unlink", UNLINK_SYNTHETIC_ORIGIN);

    // "Hide cookie notices and pop-ups" (audit webpage-to-pdf#1): after the
    // page has run, before anything is measured or printed. `./overlays`
    // says exactly what it hides.
    if (target.kind === "url" && target.capture.hideOverlays)
      await isolated("pdfxyz-overlays", HIDE_OVERLAYS_SCRIPT);

    // "Use the site's print styles" unticked (audit webpage-to-pdf#3): the
    // page is measured and printed with its SCREEN styles. Sent before the
    // measure and again before the print, so neither can see print media.
    const screenMedia = target.kind === "url" && !target.capture.printStyles;
    if (screenMedia)
      await cdp.send(
        "Emulation.setEmulatedMedia",
        { media: "screen" },
        pageSession,
      );

    // One long page: lay the chosen styles (print, unless screen was asked
    // for) out at the printed width, and read the content's height from the
    // layout — not from page script, which could report anything.
    let contentHeight: number | undefined;
    if (plan.measure) {
      await cdp.send(
        "Emulation.setEmulatedMedia",
        { media: screenMedia ? "screen" : "print" },
        pageSession,
      );
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        {
          width: plan.measure.widthPx,
          height: plan.viewport?.height ?? 800,
          deviceScaleFactor: 1,
          mobile: false,
        },
        pageSession,
      );
      const metrics = await cdp.send<{
        cssContentSize?: { height?: number };
        contentSize?: { height?: number };
      }>("Page.getLayoutMetrics", {}, pageSession);
      contentHeight =
        metrics.cssContentSize?.height ?? metrics.contentSize?.height;
      if (typeof contentHeight !== "number" || !Number.isFinite(contentHeight))
        throw new Error("the page's content height could not be measured");
    }

    return printToPdf(
      cdp,
      pageSession,
      plan.printParams(contentHeight),
      config.maxOutputBytes,
    );
  }

  /**
   * A {@link DocumentPackage} (an EPUB's chapters), one tab per document in
   * the same browser, in order. Unlike `drive`:
   *   - page scripts are DISABLED (`Emulation.setScriptExecutionDisabled`)
   *     before the first request, in the page and in every target under it;
   *   - `./network` is never consulted: a request at the synthetic document
   *     origin is answered from the package (404 when `serve` has nothing),
   *     and every other request is FAILED before any fetch — a package is
   *     self-contained, so nothing is fetched from the web;
   *   - the output cap holds for the documents together;
   *   - a document Chromium's XML parser rejects (its `<parsererror>` is in
   *     the DOM) is loaded again as `text/html`, with its non-void empty
   *     elements (`<title/>`, `<a id="p5"/>`) written as open-close pairs so
   *     the HTML parser does not read them as open tags. What that parser
   *     was proven to recover is in the tests (an undefined `&nbsp;`, an
   *     unclosed `<br>`, an empty `<title/>`), not every malformed book; one
   *     that still shows the error fails the render — Chromium's error
   *     banner is never printed (audit #6). `native.test.ts` pins both
   *     branches against a fake Chromium.
   */
  async function drivePackage(
    cdp: CdpConnection,
    pkg: DocumentPackage,
  ): Promise<Uint8Array[]> {
    const budgets = new Map<string, () => void>();
    /** Documents to serve as HTML: their XML parse failed. By `URL.href`. */
    const servedAsHtml = new Set<string>();
    const hrefOf = (url: string) => {
      try {
        return new URL(url).href;
      } catch {
        return url;
      }
    };
    const answer = async (event: CdpEvent): Promise<void> => {
      const p = event.params as {
        requestId: string;
        request: PausedRequest;
        resourceType?: string;
      };
      seams.onRequest?.({ url: p.request.url, resourceType: p.resourceType });
      if (p.request.url.startsWith(HTML_DOCUMENT_URL)) {
        const hit =
          p.request.method === "GET" ? pkg.serve(p.request.url) : null;
        const asHtml = hit !== null && servedAsHtml.has(hrefOf(p.request.url));
        const contentType = !hit
          ? "text/plain"
          : asHtml
            ? htmlDocumentContentType(hit.body)
            : hit.contentType;
        const body = !hit
          ? ""
          : Buffer.from(
              asHtml ? xhtmlEmptyElementsForHtml(hit.body) : hit.body,
            ).toString("base64");
        await cdp.send(
          "Fetch.fulfillRequest",
          {
            requestId: p.requestId,
            responseCode: hit ? 200 : 404,
            responseHeaders: [{ name: "Content-Type", value: contentType }],
            body,
          },
          event.sessionId,
        );
        return;
      }
      await cdp.send(
        "Fetch.failRequest",
        { requestId: p.requestId, errorReason: "BlockedByClient" },
        event.sessionId,
      );
    };
    cdp.on((event) => {
      if (event.method === "Fetch.requestPaused") {
        answer(event).catch(() => {
          const requestId = (event.params as { requestId?: string }).requestId;
          cdp
            .send(
              "Fetch.failRequest",
              { requestId, errorReason: "Failed" },
              event.sessionId,
            )
            .catch(() => {});
        });
      } else if (event.method === "Target.attachedToTarget") {
        const child = (event.params as { sessionId?: string }).sessionId;
        if (child)
          noScripts(cdp, child)
            .catch(() => {})
            .then(() => instrument(cdp, child, true))
            .catch(() => {});
      } else if (event.method === "Emulation.virtualTimeBudgetExpired") {
        if (event.sessionId) budgets.get(event.sessionId)?.();
      }
    });

    /** A tab with `doc` loaded and its virtual time spent. */
    const load = async (doc: PackageDocument) => {
      const { targetId } = await cdp.send<{ targetId: string }>(
        "Target.createTarget",
        { url: "about:blank" },
      );
      const { sessionId } = await cdp.send<{ sessionId: string }>(
        "Target.attachToTarget",
        { targetId, flatten: true },
      );
      // Scripts off and interception on BEFORE the first request exists.
      await noScripts(cdp, sessionId);
      await instrument(cdp, sessionId, false);
      await cdp.send("Page.enable", {}, sessionId);
      if (doc.viewport)
        await cdp.send(
          "Emulation.setDeviceMetricsOverride",
          { ...doc.viewport, deviceScaleFactor: 1, mobile: false },
          sessionId,
        );
      const nav = await cdp.send<{ errorText?: string }>(
        "Page.navigate",
        { url: doc.url },
        sessionId,
      );
      if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText}`);
      const budget = new Promise<void>((resolve) =>
        budgets.set(sessionId, resolve),
      );
      await cdp.send(
        "Emulation.setVirtualTimePolicy",
        {
          policy: "pauseIfNetworkFetchesPending",
          budget: VIRTUAL_TIME_BUDGET_MS,
        },
        sessionId,
      );
      await budget;
      budgets.delete(sessionId);
      return { targetId, sessionId };
    };
    /** True when Chromium's XML parser rejected the loaded document. */
    const xmlParseFailed = async (sessionId: string) => {
      const { root } = await cdp.send<{ root: { nodeId: number } }>(
        "DOM.getDocument",
        { depth: 0 },
        sessionId,
      );
      const { nodeId } = await cdp.send<{ nodeId: number }>(
        "DOM.querySelector",
        { nodeId: root.nodeId, selector: "parsererror" },
        sessionId,
      );
      return nodeId > 0;
    };

    const out: Uint8Array[] = [];
    let total = 0;
    for (const doc of pkg.documents) {
      // A document the package cannot serve would print as an empty 404.
      if (!pkg.serve(doc.url))
        throw new Error("a document of the package could not be served");
      let { targetId, sessionId } = await load(doc);
      if (await xmlParseFailed(sessionId)) {
        await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
        servedAsHtml.add(hrefOf(doc.url));
        ({ targetId, sessionId } = await load(doc));
        if (await xmlParseFailed(sessionId))
          throw new Error(
            "a document of the package could not be parsed as XML or HTML",
          );
      }
      const bytes = await printToPdf(
        cdp,
        sessionId,
        doc.printParams,
        config.maxOutputBytes - total,
      );
      if (bytes.byteLength === 0 || !looksLikePdf(bytes))
        throw new Error("Chromium produced no usable PDF output.");
      total += bytes.byteLength;
      out.push(bytes);
      await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
    }
    return out;
  }

  async function render(
    target: RenderTarget,
    options: HtmlRenderOptions,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    // Webpages get bookmarks from their headings, and the address-and-date
    // line when it was asked for (audit webpage-to-pdf#7, `./stamp`).
    const plan = planPrint(
      options,
      target.kind === "url"
        ? {
            outline: true,
            ...(target.capture.stamp
              ? {
                  footerTemplate: stampFooterTemplate(
                    target.url,
                    (seams.now ?? (() => new Date()))(),
                  ),
                }
              : {}),
          }
        : {},
    );
    const bytes = await withBrowser(signal, (cdp) => drive(cdp, target, plan));
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > config.maxOutputBytes ||
      !looksLikePdf(bytes)
    ) {
      throw new Error("Chromium produced no usable PDF output.");
    }
    return bytes;
  }

  /**
   * One browser for `work`: launched with a minimal environment and a
   * per-job profile, raced against the timeout, its own exit and the
   * attempt's abort, and always killed and its profile removed afterwards.
   */
  async function withBrowser<T>(
    signal: AbortSignal | undefined,
    work: (cdp: CdpConnection) => Promise<T>,
  ): Promise<T> {
    throwIfAttemptAborted(signal);
    const dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-html-"));
    const proc = launch(binary, chromiumArgs(path.join(dir, "profile")), {
      env: chromiumEnv(dir, seams.parentEnv, seams.platform),
      windowsHide: true,
      ...signalOption(signal),
    });
    const cdp = new CdpConnection(proc.pipe);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Chromium HTML rendering timed out.")),
        config.timeoutMs,
      );
    });
    const died = proc.exited.then(() => {
      throw new Error("Chromium exited before the render finished.");
    });
    // The attempt lost its lease: stop waiting on Chromium at once. The
    // finally below kills it (SIGKILL) and removes the profile, as on a timeout.
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new AttemptAbortedError());
      // Aborted during mkdtemp: a listener added now would never fire.
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
    deadline.catch(() => {});
    died.catch(() => {});
    aborted.catch(() => {});
    try {
      try {
        return await Promise.race([aborted, work(cdp), deadline, died]);
      } catch (error) {
        // Before any other reading: a browser killed by the abort reports
        // "exited before the render finished", which is not what happened.
        if (signal?.aborted) throw new AttemptAbortedError();
        // What the site did travels to the user intact.
        if (error instanceof WebpageFetchError) throw error;
        throw new Error(
          `Chromium HTML rendering failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      cdp.close("render finished");
      proc.kill();
      await Promise.race([
        proc.exited,
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    renderPackage(pkg, run: RunControl = {}) {
      return withBrowser(run.signal, (cdp) => drivePackage(cdp, pkg));
    },
    renderHtml(input, options = DEFAULT_HTML_RENDER_OPTIONS, run = {}) {
      if (input.byteLength > config.maxInputBytes)
        throw new Error("Input exceeds size limit.");
      return render({ kind: "html", bytes: input }, options, run.signal);
    },
    renderUrl(
      url,
      options = DEFAULT_HTML_RENDER_OPTIONS,
      run: RunControl = {},
      capture = DEFAULT_WEBPAGE_CAPTURE_OPTIONS,
    ) {
      return render({ kind: "url", url, capture }, options, run.signal);
    },
    renderSite(site, options = DEFAULT_HTML_RENDER_OPTIONS, run = {}) {
      return render({ kind: "site", site }, options, run.signal);
    },
  };
}

export function nativeHtmlRenderDeps(
  env: Record<string, string | undefined> = process.env,
  seams: ChromiumSeams = {},
): HtmlRenderDeps {
  const config = resolveNativeHtmlRenderConfig(env);
  const available = probeChromiumFromConfig(config, seams);
  return {
    ...(available
      ? { chromium: createNativeChromiumPdfRunner(config, seams) }
      : {}),
    limits: {
      maxInputBytes: config.maxInputBytes,
      maxOutputBytes: config.maxOutputBytes,
    },
  };
}
