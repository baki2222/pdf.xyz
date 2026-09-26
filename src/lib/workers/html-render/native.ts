import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { looksLikePdf } from "../compression/engine";
import { CdpConnection, type CdpEvent, type CdpPipe } from "./cdp";
import type { ChromiumPdfRunner, HtmlRenderDeps } from "./engine";
import {
  createRenderNetwork,
  type PausedRequest,
  type RenderNetworkSeams,
} from "./network";
import {
  resolveNativeHtmlRenderConfig,
  type NativeHtmlRenderConfig,
} from "./native-config";

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

/**
 * Where an uploaded HTML document is served from. `.invalid` is reserved
 * (RFC 6761) and `./network` refuses it, so the page can never fetch it — or
 * anything relative to it — back from anywhere.
 */
export const HTML_DOCUMENT_URL = "https://document.invalid/";

export interface ChromiumProcess {
  pipe: CdpPipe;
  kill(): void;
  /** Settles when the process has exited (or failed to start). */
  exited: Promise<void>;
}

export type ChromiumLaunch = (
  command: string,
  args: readonly string[],
  options: { env: Record<string, string>; windowsHide: boolean },
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
  /** The environment Chromium's must be CUT DOWN from. Default process.env. */
  parentEnv?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

const defaultLaunch: ChromiumLaunch = (command, args, options) => {
  const child: ChildProcess = spawn(command, [...args], {
    // fd 3: we write commands; fd 4: Chromium writes replies.
    stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    env: options.env as NodeJS.ProcessEnv,
    windowsHide: options.windowsHide,
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

const INTERCEPT_ALL = { patterns: [{ urlPattern: "*" }] };

export function createNativeChromiumPdfRunner(
  config: NativeHtmlRenderConfig,
  seams: ChromiumSeams = {},
): ChromiumPdfRunner {
  const launch = seams.launch ?? defaultLaunch;
  const fs = seams.fs ?? defaultFs;
  const baseTmp = config.tmpDir ?? tmpdir();
  const binary =
    probeChromiumFromConfig(config, seams) ??
    config.candidates[0] ??
    "chromium";

  async function drive(
    cdp: CdpConnection,
    target: RenderTarget,
  ): Promise<Uint8Array> {
    const network = createRenderNetwork(seams.network);
    let documentServed = false;
    let mainFrameId = "";

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
      const decision = await network.handle(p.request);
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

    const url = target.kind === "html" ? HTML_DOCUMENT_URL : target.url;
    const nav = await cdp.send<{ errorText?: string }>(
      "Page.navigate",
      { url },
      pageSession,
    );
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

    const { stream } = await cdp.send<{ stream: string }>(
      "Page.printToPDF",
      {
        printBackground: true,
        preferCSSPageSize: true,
        transferMode: "ReturnAsStream",
      },
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

  async function render(target: RenderTarget): Promise<Uint8Array> {
    const dir = await fs.mkdtemp(path.join(baseTmp, "pdfxyz-html-"));
    const proc = launch(binary, chromiumArgs(path.join(dir, "profile")), {
      env: chromiumEnv(dir, seams.parentEnv, seams.platform),
      windowsHide: true,
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
    deadline.catch(() => {});
    died.catch(() => {});
    try {
      let bytes: Uint8Array;
      try {
        bytes = await Promise.race([drive(cdp, target), deadline, died]);
      } catch (error) {
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
    renderHtml(input) {
      if (input.byteLength > config.maxInputBytes)
        throw new Error("Input exceeds size limit.");
      return render({ kind: "html", bytes: input });
    },
    renderUrl(url) {
      return render({ kind: "url", url });
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
