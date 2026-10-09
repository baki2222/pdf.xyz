/**
 * The renderer's network: every request Chromium makes while rendering a job
 * comes through here, and nothing else reaches the network.
 *
 * WHY THIS EXISTS. Chromium used to render uploaded HTML from `file://` with
 * its own network stack wide open. An uploaded page could iframe
 * `file:///etc/passwd`, `/proc/1/environ` or `http://169.254.169.254/` and the
 * worker printed the answer into the PDF it handed back (reproduced 2026-09 on
 * the exact argv; the output carried the local file's contents). The edge's
 * URL check (`isSafePublicHttpUrl`) could not help: it saw one string, once,
 * and a redirect or a sub-resource went wherever it pointed.
 *
 * THE POLICY, applied to every request, the top-level navigation included:
 *   1. Only `http:` and `https:` — anything else is refused.
 *   2. The host is resolved HERE, every address it resolves to must be public
 *      (`@/lib/net/public-address`), and the connection is made to the address
 *      that was checked. Chromium never resolves or dials anything itself, so
 *      a DNS answer that changes between check and connect (rebinding) has no
 *      second lookup to change.
 *   3. The response is fetched by this module and handed to Chromium whole
 *      (`Fetch.fulfillRequest`). A 3xx goes back to Chromium as a 3xx; the
 *      follow-up request comes back through this policy like any other.
 *
 * Chromium's own network is dead as a backstop (see `chromiumArgs` in
 * native.ts): anything that escapes interception fails rather than connects.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import {
  brotliDecompressSync,
  gunzipSync,
  inflateRawSync,
  inflateSync,
} from "node:zlib";
import {
  isInternalHostname,
  isIpLiteral,
  isPublicIpAddress,
  normalizeHost,
} from "@/lib/net/public-address";

/** The subset of a CDP `Fetch.requestPaused` request this policy reads. */
export interface PausedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  postDataEntries?: { bytes?: string }[];
}

/** CDP `Network.ErrorReason` values this module emits. */
export type BlockReason =
  | "BlockedByClient"
  | "AccessDenied"
  | "NameNotResolved"
  | "ConnectionFailed"
  | "TimedOut"
  | "Failed";

export type RequestDecision =
  | { action: "fail"; reason: BlockReason; why: string }
  | {
      action: "fulfill";
      status: number;
      headers: { name: string; value: string }[];
      body: Uint8Array;
    };

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface PinnedResponse {
  status: number;
  /** Alternating name/value pairs, as Node's `rawHeaders`. */
  rawHeaders: string[];
  body: Uint8Array;
}

export interface PinnedFetchInit {
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  maxBytes: number;
  timeoutMs: number;
}

/** Fetch `url`, connecting ONLY to `pinned`. The seam tests replace. */
export type PinnedFetch = (
  url: URL,
  pinned: ResolvedAddress,
  init: PinnedFetchInit,
) => Promise<PinnedResponse>;

export type Resolve = (hostname: string) => Promise<ResolvedAddress[]>;

export interface RenderNetworkSeams {
  resolve?: Resolve;
  fetch?: PinnedFetch;
}

export interface RenderNetworkLimits {
  /** Largest single response body, after decompression. */
  maxResponseBytes: number;
  /** All response bodies of one render together. */
  maxTotalBytes: number;
  /** Requests one render may make before every further one is refused. */
  maxRequests: number;
  /** Per-request wall clock. */
  requestTimeoutMs: number;
}

export const DEFAULT_RENDER_NETWORK_LIMITS: RenderNetworkLimits = {
  maxResponseBytes: 20 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxRequests: 500,
  requestTimeoutMs: 20_000,
};

/** Request headers never forwarded: hop-by-hop, or ours to set. */
const DROP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authorization",
  "transfer-encoding",
  "te",
  "upgrade",
  "content-length",
  "accept-encoding",
]);

/** Response headers that describe the wire, not the body Chromium receives. */
const DROP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

const defaultResolve: Resolve = async (hostname) => {
  const all = await dnsLookup(hostname, { all: true, verbatim: true });
  return all.map((a) => ({
    address: a.address,
    family: a.family === 6 ? 6 : 4,
  }));
};

export const defaultPinnedFetch: PinnedFetch = (url, pinned, init) =>
  new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: init.method,
        headers: { ...init.headers, "accept-encoding": "gzip, deflate, br" },
        agent: false,
        // The ONLY address this socket may connect to. Node calls `lookup` for
        // a hostname; an IP literal never reaches it and was checked already.
        lookup: ((
          _host: string,
          options: { all?: boolean },
          cb: (...args: unknown[]) => void,
        ) => {
          if (options?.all) cb(null, [pinned]);
          else cb(null, pinned.address, pinned.family);
        }) as unknown as LookupFunction,
        timeout: init.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > init.maxBytes) {
            req.destroy(new Error("response too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 502,
            rawHeaders: res.rawHeaders,
            body: new Uint8Array(Buffer.concat(chunks)),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    if (init.body && init.body.byteLength > 0) req.write(init.body);
    req.end();
  });

function decode(
  body: Uint8Array,
  encoding: string,
  maxBytes: number,
): Uint8Array {
  const opts = { maxOutputLength: maxBytes };
  const enc = encoding.trim().toLowerCase();
  if (enc === "" || enc === "identity") return body;
  if (enc === "gzip" || enc === "x-gzip") return gunzipSync(body, opts);
  if (enc === "br") return brotliDecompressSync(body, opts);
  if (enc === "deflate") {
    try {
      return inflateSync(body, opts);
    } catch {
      return inflateRawSync(body, opts);
    }
  }
  throw new Error(`unsupported content-encoding ${enc}`);
}

function requestBody(req: PausedRequest): Uint8Array | undefined {
  if (req.postDataEntries?.length) {
    return new Uint8Array(
      Buffer.concat(
        req.postDataEntries.map((e) => Buffer.from(e.bytes ?? "", "base64")),
      ),
    );
  }
  if (typeof req.postData === "string")
    return new Uint8Array(Buffer.from(req.postData, "utf8"));
  return undefined;
}

const block = (why: string): RequestDecision => ({
  action: "fail",
  reason: "BlockedByClient",
  why,
});

/**
 * One render's network. Stateful on purpose: the request and byte budgets are
 * per render, so a page cannot turn one job into an unbounded crawler.
 */
export function createRenderNetwork(
  seams: RenderNetworkSeams = {},
  limits: RenderNetworkLimits = DEFAULT_RENDER_NETWORK_LIMITS,
) {
  const resolve = seams.resolve ?? defaultResolve;
  const fetchPinned = seams.fetch ?? defaultPinnedFetch;
  let requests = 0;
  let totalBytes = 0;

  /** Decide where a request may go — without fetching anything. */
  async function admit(
    rawUrl: string,
  ): Promise<
    | { ok: true; url: URL; pinned: ResolvedAddress }
    | { ok: false; decision: RequestDecision }
  > {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, decision: block("unparseable URL") };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return {
        ok: false,
        decision: block(`scheme ${url.protocol} is never fetched`),
      };
    if (url.username || url.password)
      return { ok: false, decision: block("credentials in URL") };
    const host = normalizeHost(url.hostname);
    if (isIpLiteral(host)) {
      if (!isPublicIpAddress(host))
        return { ok: false, decision: block(`non-public address ${host}`) };
      return {
        ok: true,
        url,
        pinned: { address: host, family: host.includes(":") ? 6 : 4 },
      };
    }
    if (isInternalHostname(host))
      return { ok: false, decision: block(`internal hostname ${host}`) };
    let addresses: ResolvedAddress[];
    try {
      addresses = await resolve(host);
    } catch {
      return {
        ok: false,
        decision: {
          action: "fail",
          reason: "NameNotResolved",
          why: `could not resolve ${host}`,
        },
      };
    }
    if (addresses.length === 0)
      return {
        ok: false,
        decision: {
          action: "fail",
          reason: "NameNotResolved",
          why: `${host} resolved to nothing`,
        },
      };
    // EVERY answer must be public: a name that resolves to one public and one
    // private address is a name that can be made to connect to the private one.
    const bad = addresses.find((a) => !isPublicIpAddress(a.address));
    if (bad)
      return {
        ok: false,
        decision: block(`${host} resolves to non-public ${bad.address}`),
      };
    return { ok: true, url, pinned: addresses[0]! };
  }

  async function handle(req: PausedRequest): Promise<RequestDecision> {
    requests += 1;
    if (requests > limits.maxRequests)
      return block("request budget for this render is spent");
    const admitted = await admit(req.url);
    if (!admitted.ok) return admitted.decision;

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers ?? {})) {
      if (!DROP_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
    }
    const remaining = limits.maxTotalBytes - totalBytes;
    if (remaining <= 0) return block("byte budget for this render is spent");
    const maxBytes = Math.min(limits.maxResponseBytes, remaining);

    let res: PinnedResponse;
    try {
      res = await fetchPinned(admitted.url, admitted.pinned, {
        method: req.method,
        headers,
        body: requestBody(req),
        maxBytes,
        timeoutMs: limits.requestTimeoutMs,
      });
    } catch (error) {
      const timedOut = /timed out/i.test(String(error));
      return {
        action: "fail",
        reason: timedOut ? "TimedOut" : "ConnectionFailed",
        why: String(error),
      };
    }

    const out: { name: string; value: string }[] = [];
    let encoding = "";
    for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
      const name = res.rawHeaders[i]!;
      const value = res.rawHeaders[i + 1]!;
      const lower = name.toLowerCase();
      if (lower === "content-encoding") encoding = value;
      if (!DROP_RESPONSE_HEADERS.has(lower)) out.push({ name, value });
    }
    let body: Uint8Array;
    try {
      body = decode(res.body, encoding, maxBytes);
    } catch (error) {
      return { action: "fail", reason: "Failed", why: String(error) };
    }
    totalBytes += body.byteLength;
    return { action: "fulfill", status: res.status, headers: out, body };
  }

  return { admit, handle };
}

export type RenderNetwork = ReturnType<typeof createRenderNetwork>;
