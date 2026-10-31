import { looksLikePdf } from "../compression/engine";
import { isSafePublicHttpUrl } from "@/lib/jobs/validation";
import { describeByteCeiling } from "../engine-file-ceilings";
import {
  rethrowIfAttemptAbort,
  signalOption,
  type RunControl,
} from "../attempt-abort";
import {
  DEFAULT_HTML_RENDER_OPTIONS,
  type HtmlRenderOptions,
} from "@/lib/jobs/html-render-options";

export {
  HTML_RENDER_TOOLS,
  HTML_TO_PDF_TOOL,
  WEBPAGE_TO_PDF_TOOL,
  type HtmlRenderTool,
} from "./tools";

export const HTML_RENDER_ENGINE = "chromium" as const;

/**
 * Why a webpage could not be captured: what the SITE (or the way to it) did,
 * as opposed to what Chromium did. Every arm is a fact the renderer observed
 * about the main-frame document — never a sub-resource, which fails on its own
 * without failing the page.
 */
export type WebpageFetchFailure =
  /** The final main-frame response was an HTTP error (>= 400). */
  | { reason: "http"; status: number }
  /** The site answered with a bot-check interstitial (`cf-mitigated: challenge`). */
  | { reason: "challenge"; status: number }
  /** The address, or a redirect from it, is one the renderer never fetches. */
  | { reason: "blocked" }
  /** The host name did not resolve. */
  | { reason: "unresolved" }
  /** The connection failed or timed out. */
  | { reason: "unreachable" }
  /** The site answered, but its response could not be decoded. */
  | { reason: "unreadable" }
  /** Chromium refused the navigation itself (e.g. a download, not a page). */
  | { reason: "navigation"; errorText: string };

/**
 * Thrown by a {@link ChromiumPdfRunner} when the page it was asked for is not
 * the page it got. Typed so {@link runWebpageToPdf} can tell the user what the
 * site did, instead of the generic "could not render" every other error gets.
 */
export class WebpageFetchError extends Error {
  constructor(readonly failure: WebpageFetchFailure) {
    super(webpageFetchMessage(failure));
    this.name = "WebpageFetchError";
  }
}

/** The sentence the user reads for each failure. The one place it is written. */
export function webpageFetchMessage(failure: WebpageFetchFailure): string {
  switch (failure.reason) {
    case "http": {
      const s = failure.status;
      if (s === 401 || s === 403 || s === 407)
        return `The site answered HTTP ${s} (access refused) instead of the page, so nothing was converted. Pages behind a sign-in or a bot check cannot be captured.`;
      if (s === 404 || s === 410)
        return `The site answered HTTP ${s} (not found): there is no page at this address, so nothing was converted. Check the URL and try again.`;
      if (s === 429)
        return `The site answered HTTP 429 (too many requests) instead of the page, so nothing was converted. Try again later.`;
      if (s >= 500)
        return `The site answered HTTP ${s} (server error) instead of the page, so nothing was converted. It may be down; try again later.`;
      return `The site answered HTTP ${s} instead of the page, so nothing was converted.`;
    }
    case "challenge":
      return `The site answered with a bot check (HTTP ${failure.status}) instead of the page, so nothing was converted. Sites that challenge automated visitors cannot be captured.`;
    case "blocked":
      return "This address, or a redirect from it, leads somewhere that is never fetched (a private or internal network, or a link that is not http or https), so nothing was converted.";
    case "unresolved":
      return "This site's name could not be found, so nothing was converted. Check the address for typos.";
    case "unreachable":
      return "The site could not be reached (the connection failed or timed out), so nothing was converted. It may be down; try again later.";
    case "unreadable":
      return "The site answered, but its response could not be read (an encoding the renderer does not support), so nothing was converted.";
    case "navigation":
      return `The page could not be opened (${failure.errorText}), so nothing was converted. An address that downloads a file rather than showing a page cannot be captured.`;
  }
}

/**
 * Whether the same request could plausibly succeed on a retry: a server error,
 * a rate limit, or a connection that failed. A 404, a bot check, a blocked
 * address or a name that does not exist answer the same way every time.
 */
export function isRetryableWebpageFetch(failure: WebpageFetchFailure): boolean {
  if (failure.reason === "unreachable") return true;
  if (failure.reason === "http")
    return failure.status === 429 || failure.status >= 500;
  return false;
}

export interface ChromiumPdfRunner {
  /** `options` absent = every default: the render as it always ran. */
  renderHtml(
    input: Uint8Array,
    options?: HtmlRenderOptions,
    run?: RunControl,
  ): Promise<Uint8Array>;
  renderUrl(
    url: string,
    options?: HtmlRenderOptions,
    run?: RunControl,
  ): Promise<Uint8Array>;
}

export interface HtmlRenderDeps {
  chromium?: ChromiumPdfRunner;
  validate?: (bytes: Uint8Array) => boolean | Promise<boolean>;
  limits?: { maxInputBytes?: number; maxOutputBytes?: number };
}

export interface HtmlRenderResultMeta {
  engine: typeof HTML_RENDER_ENGINE;
  source: "html" | "url";
  inputBytes?: number;
  outputBytes: number;
}

export type HtmlRenderRun =
  | { ok: true; output: Uint8Array; meta: HtmlRenderResultMeta }
  | { ok: false; kind: "unsupported"; message: string }
  | { ok: false; kind: "invalid_url"; message: string }
  | { ok: false; kind: "too_large"; limitBytes: number; message: string }
  | { ok: false; kind: "failed"; message: string }
  | {
      ok: false;
      kind: "page_unavailable";
      failure: WebpageFetchFailure;
      retryable: boolean;
      message: string;
    };

const unsupported = (): HtmlRenderRun => ({
  ok: false,
  kind: "unsupported",
  message:
    "HTML/Webpage conversion requires the native Chromium renderer, which is not installed in this environment.",
});

function validateOutput(
  output: Uint8Array,
  deps: HtmlRenderDeps,
): HtmlRenderRun | undefined {
  const maxOutput = deps.limits?.maxOutputBytes;
  if (maxOutput !== undefined && output.byteLength > maxOutput) {
    return {
      ok: false,
      kind: "failed",
      message: "The renderer output exceeds the worker size limit.",
    };
  }
  return undefined;
}

export async function runHtmlToPdf(
  input: Uint8Array,
  deps: HtmlRenderDeps,
  options: HtmlRenderOptions = DEFAULT_HTML_RENDER_OPTIONS,
  /** The attempt's abort signal, passed to Chromium. */
  signal?: AbortSignal,
): Promise<HtmlRenderRun> {
  if (!deps.chromium) return unsupported();
  const limit = deps.limits?.maxInputBytes;
  if (limit !== undefined && input.byteLength > limit) {
    return {
      ok: false,
      kind: "too_large",
      limitBytes: limit,
      message: `This HTML file is larger than ${describeByteCeiling(limit)}, the most HTML to PDF renders per file.`,
    };
  }
  let output: Uint8Array;
  try {
    output = await deps.chromium.renderHtml(
      input,
      options,
      signalOption(signal),
    );
  } catch (error) {
    rethrowIfAttemptAbort(error);
    return {
      ok: false,
      kind: "failed",
      message: "Chromium could not render this HTML file.",
    };
  }
  const outputError = validateOutput(output, deps);
  if (outputError) return outputError;
  const validate = deps.validate ?? looksLikePdf;
  if (!(await validate(output))) {
    return {
      ok: false,
      kind: "failed",
      message: "Chromium produced no usable PDF output.",
    };
  }
  return {
    ok: true,
    output,
    meta: {
      engine: HTML_RENDER_ENGINE,
      source: "html",
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
    },
  };
}

export async function runWebpageToPdf(
  url: string,
  deps: HtmlRenderDeps,
  options: HtmlRenderOptions = DEFAULT_HTML_RENDER_OPTIONS,
  /** The attempt's abort signal, passed to Chromium. */
  signal?: AbortSignal,
): Promise<HtmlRenderRun> {
  if (!isSafePublicHttpUrl(url)) {
    return {
      ok: false,
      kind: "invalid_url",
      message:
        "The URL must be a public http(s) URL (no localhost, private, or link-local hosts).",
    };
  }
  if (!deps.chromium) return unsupported();
  let output: Uint8Array;
  try {
    output = await deps.chromium.renderUrl(url, options, signalOption(signal));
  } catch (error) {
    rethrowIfAttemptAbort(error);
    // What the SITE did reaches the user; until 2026-09 every error here,
    // a 404 included, became the generic sentence below — and a 404 was not
    // even an error, so its page came back as "Your PDF is ready."
    if (error instanceof WebpageFetchError)
      return {
        ok: false,
        kind: "page_unavailable",
        failure: error.failure,
        retryable: isRetryableWebpageFetch(error.failure),
        message: webpageFetchMessage(error.failure),
      };
    return {
      ok: false,
      kind: "failed",
      message: "Chromium could not render this webpage.",
    };
  }
  const outputError = validateOutput(output, deps);
  if (outputError) return outputError;
  const validate = deps.validate ?? looksLikePdf;
  if (!(await validate(output))) {
    return {
      ok: false,
      kind: "failed",
      message: "Chromium produced no usable PDF output.",
    };
  }
  return {
    ok: true,
    output,
    meta: {
      engine: HTML_RENDER_ENGINE,
      source: "url",
      outputBytes: output.byteLength,
    },
  };
}
