import { looksLikePdf } from "../compression/engine";
import { isSafePublicHttpUrl } from "@/lib/jobs/validation";

import { HTML_RENDER_TOOLS } from "./native-config";

export {
  HTML_TO_PDF_TOOL,
  WEBPAGE_TO_PDF_TOOL,
  HTML_RENDER_TOOLS,
} from "./native-config";
export type HtmlRenderTool = (typeof HTML_RENDER_TOOLS)[number];

export const HTML_RENDER_ENGINE = "chromium" as const;

export interface ChromiumPdfRunner {
  renderHtml(input: Uint8Array): Promise<Uint8Array>;
  renderUrl(url: string): Promise<Uint8Array>;
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
  | { ok: false; kind: "failed"; message: string };

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

/** Whole megabytes, rounded DOWN so the figure never overstates the cap. */
function wholeMb(bytes: number): number {
  return Math.floor(bytes / (1024 * 1024));
}

export async function runHtmlToPdf(
  input: Uint8Array,
  deps: HtmlRenderDeps,
): Promise<HtmlRenderRun> {
  if (!deps.chromium) return unsupported();
  const limit = deps.limits?.maxInputBytes;
  if (limit !== undefined && input.byteLength > limit) {
    return {
      ok: false,
      kind: "too_large",
      limitBytes: limit,
      message: `This HTML file is larger than ${wholeMb(limit)} MB, the most the HTML renderer accepts.`,
    };
  }
  let output: Uint8Array;
  try {
    output = await deps.chromium.renderHtml(input);
  } catch {
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
    output = await deps.chromium.renderUrl(url);
  } catch {
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
