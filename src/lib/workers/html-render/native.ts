import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { looksLikePdf } from "../compression/engine";
import { CdpConnection, type CdpEvent, type CdpPipe } from "./cdp";
import { HTML_DOCUMENT_URL } from "./document-url";
import {
  WebpageFetchError,
  type ChromiumPdfRunner,
  type HtmlRenderDeps,
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
  { kind: "html"; bytes: Uint8Array } | { kind: "url"; url: string };

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

// The print arguments, and the layout options that change them, live in
// `./print-params`; re-exported here, where the tests and tool pages read it.
export { PRINT_TO_PDF_OPTIONS };

const INTERCEPT_ALL = { patterns: [{ urlPattern: "*" }] };

export function createNativeChromiumPdfRunner(
  config: NativeHtmlRenderConfig,
  seams: ChromiumSeams = {},
): ChromiumPdfRunner {
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
            // No charset: Chromium sniffs a BOM or <meta charset> exactly as
            // it did when it read the file from disk.
            responseHeaders: [{ name: "Content-Type", value: "text/html" }],
            body: Buffer.from(target.bytes).toString("base64"),
          },
          sessionId,
        );
        return;
      }
      seams.onRequest?.({ url: p.request.url, resourceType: p.resourceType });
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

    /** Intercept on a session and on every frame/worker target under it. */
    const instrument = async (sessionId: string, resume: boolean) => {
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
    };

    let budgetExpired: () => void = () => {};
    const budget = new Promise<void>((resolve) => (budgetExpired = resolve));
    let pageSession = "";

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
        if (child) instrument(child, true).catch(() => {});
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
    await instrument(pageSession, false);
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

    const url = target.kind === "html" ? HTML_DOCUMENT_URL : target.url;
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
    if (target.kind === "html" && !documentServed)
      throw new Error("the uploaded document was never served");

    await cdp.send(
      "Emulation.setVirtualTimePolicy",
      {
        policy: "pauseIfNetworkFetchesPending",
        budget: VIRTUAL_TIME_BUDGET_MS,
      },
      pageSession,
    );
    await budget;
    // Again after the page has run: a script or a meta refresh may have taken
    // the main frame somewhere that answered with an error.
    if (target.kind === "url" && pageVerdict)
      throw new WebpageFetchError(pageVerdict);

    // One long page: lay the PRINT styles out at the printed width, and read
    // the content's height from the layout — not from page script, which
    // could report anything.
    let contentHeight: number | undefined;
    if (plan.measure) {
      await cdp.send(
        "Emulation.setEmulatedMedia",
        { media: "print" },
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

    const { stream } = await cdp.send<{ stream: string }>(
      "Page.printToPDF",
      { ...plan.printParams(contentHeight), transferMode: "ReturnAsStream" },
      pageSession,
    );
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const chunk = await cdp.send<{
        data: string;
        base64Encoded?: boolean;
        eof: boolean;
      }>("IO.read", { handle: stream, size: 1 << 20 }, pageSession);
      const bytes = Buffer.from(
        chunk.data,
        chunk.base64Encoded ? "base64" : "utf8",
      );
      size += bytes.byteLength;
      if (size > config.maxOutputBytes)
        throw new Error("Chromium output exceeds the size limit.");
      chunks.push(bytes);
      if (chunk.eof) break;
    }
    await cdp.send("IO.close", { handle: stream }, pageSession).catch(() => {});
    return new Uint8Array(Buffer.concat(chunks));
  }

  async function render(
    target: RenderTarget,
    options: HtmlRenderOptions,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    const plan = planPrint(options);
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
      let bytes: Uint8Array;
      try {
        bytes = await Promise.race([
          aborted,
          drive(cdp, target, plan),
          deadline,
          died,
        ]);
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
      if (
        bytes.byteLength === 0 ||
        bytes.byteLength > config.maxOutputBytes ||
        !looksLikePdf(bytes)
      ) {
        throw new Error("Chromium produced no usable PDF output.");
      }
      return bytes;
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
    renderHtml(input, options = DEFAULT_HTML_RENDER_OPTIONS, run = {}) {
      if (input.byteLength > config.maxInputBytes)
        throw new Error("Input exceeds size limit.");
      return render({ kind: "html", bytes: input }, options, run.signal);
    },
    renderUrl(
      url,
      options = DEFAULT_HTML_RENDER_OPTIONS,
      run: RunControl = {},
    ) {
      return render({ kind: "url", url }, options, run.signal);
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
