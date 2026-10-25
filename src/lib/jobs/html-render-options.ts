/**
 * HTML to PDF and Webpage to PDF options — page size, orientation, margins,
 * "one long page", and the screen width the page is laid out at.
 *
 * Pure data plus one strict parser, like `./ocr`: no Chromium, no Node
 * built-in, so the panel validates with the same function the worker runs.
 * The worker turns a validated value into `Page.printToPDF` arguments in
 * `@/lib/workers/html-render/print-params`; this module only says what may
 * be asked for.
 *
 * `{}` is the job as it ran before these options existed, exactly: the
 * page's own `@page` size (Letter when it names none), portrait, Chromium's
 * default 0.4-inch margins, laid out at the paper's width, as many pages as
 * the content needs. Every default below is that behaviour, so a client that
 * sends nothing gets nothing new.
 */
import { apiError, type ParseResult } from "./responses";

/** A paper size. `auto` = the page's own `@page` size, else Letter. */
export type HtmlPageSize = "auto" | "A4" | "Letter" | "Legal" | "A3" | "A5";

export interface HtmlPageSizeInfo {
  id: HtmlPageSize;
  label: string;
  /** Portrait width × height in inches; null for `auto`. */
  inches: readonly [number, number] | null;
}

const mm = (v: number) => v / 25.4;

export const HTML_PAGE_SIZES: readonly HtmlPageSizeInfo[] = [
  { id: "auto", label: "As the page sets it", inches: null },
  { id: "A4", label: "A4", inches: [mm(210), mm(297)] },
  { id: "Letter", label: "Letter", inches: [8.5, 11] },
  { id: "Legal", label: "Legal", inches: [8.5, 14] },
  { id: "A3", label: "A3", inches: [mm(297), mm(420)] },
  { id: "A5", label: "A5", inches: [mm(148), mm(210)] },
];

/** Chromium's own paper when nothing names one (and when `auto` meets no `@page`). */
export const CHROMIUM_DEFAULT_PAPER_INCHES: readonly [number, number] = [
  8.5, 11,
];

export type HtmlOrientation = "portrait" | "landscape";
export const HTML_ORIENTATIONS: readonly {
  id: HtmlOrientation;
  label: string;
}[] = [
  { id: "portrait", label: "Portrait" },
  { id: "landscape", label: "Landscape" },
];

export type HtmlMargin = "none" | "small" | "normal";
export const HTML_MARGINS: readonly {
  id: HtmlMargin;
  label: string;
  /** Each edge, in inches. `normal` is Chromium's default (about 1 cm). */
  inches: number;
}[] = [
  { id: "none", label: "None", inches: 0 },
  { id: "small", label: "Small", inches: 0.2 },
  { id: "normal", label: "Normal", inches: 0.4 },
];

/** The screen the page is laid out for. `auto` = the paper's own width. */
export type HtmlViewport = "auto" | "desktop" | "tablet" | "phone";
export const HTML_VIEWPORTS: readonly {
  id: HtmlViewport;
  label: string;
  /** CSS pixels wide; null for `auto`. */
  width: number | null;
  /** CSS pixels tall, for the window scripts see while the page loads. */
  height: number | null;
}[] = [
  { id: "auto", label: "Paper width", width: null, height: null },
  { id: "desktop", label: "Desktop (1280 px)", width: 1280, height: 800 },
  { id: "tablet", label: "Tablet (768 px)", width: 768, height: 1024 },
  { id: "phone", label: "Phone (390 px)", width: 390, height: 844 },
];

/**
 * The tallest single page "one long page" makes, in inches (200 in, about
 * 5 m: the largest page size PDF readers commonly accept). Content taller
 * than this continues on further pages of the same size.
 */
export const HTML_ONE_PAGE_MAX_INCHES = 200;

export interface HtmlRenderOptions {
  pageSize: HtmlPageSize;
  orientation: HtmlOrientation;
  margin: HtmlMargin;
  viewport: HtmlViewport;
  /** One page as tall as the content, instead of paper-sized pages. */
  onePage: boolean;
}

export const DEFAULT_HTML_RENDER_OPTIONS: HtmlRenderOptions = {
  pageSize: "auto",
  orientation: "portrait",
  margin: "normal",
  viewport: "auto",
  onePage: false,
};

/** True when `options` asks for nothing beyond the job as it always ran. */
export function isDefaultHtmlRenderOptions(
  options: HtmlRenderOptions,
): boolean {
  return (
    options.pageSize === "auto" &&
    options.orientation === "portrait" &&
    options.margin === "normal" &&
    options.viewport === "auto" &&
    !options.onePage
  );
}

function invalid(message: string, field: string): ParseResult<never> {
  return {
    ok: false,
    error: apiError("invalid_request", message, [{ field, message }]),
  };
}

function oneOf<T extends string>(
  options: Record<string, unknown>,
  key: string,
  allowed: readonly { id: T }[],
  fallback: T,
): ParseResult<T> {
  const raw = options[key];
  if (raw === undefined) return { ok: true, value: fallback };
  const hit = allowed.find((a) => a.id === raw);
  if (hit) return { ok: true, value: hit.id };
  return invalid(
    `\`options.${key}\` must be one of ${allowed.map((a) => `"${a.id}"`).join(", ")}.`,
    `options.${key}`,
  );
}

/**
 * Parse the layout options of an `html-to-pdf` or `webpage-to-pdf` job.
 * Strict: an unknown value of a known key is refused with a field error,
 * never coerced. Keys it does not own (`url`) are left to their own parser.
 */
export function parseHtmlRenderOptions(
  options: Record<string, unknown>,
): ParseResult<HtmlRenderOptions> {
  const pageSize = oneOf(
    options,
    "pageSize",
    HTML_PAGE_SIZES,
    DEFAULT_HTML_RENDER_OPTIONS.pageSize,
  );
  if (!pageSize.ok) return pageSize;
  const orientation = oneOf(
    options,
    "orientation",
    HTML_ORIENTATIONS,
    DEFAULT_HTML_RENDER_OPTIONS.orientation,
  );
  if (!orientation.ok) return orientation;
  const margin = oneOf(
    options,
    "margin",
    HTML_MARGINS,
    DEFAULT_HTML_RENDER_OPTIONS.margin,
  );
  if (!margin.ok) return margin;
  const viewport = oneOf(
    options,
    "viewport",
    HTML_VIEWPORTS,
    DEFAULT_HTML_RENDER_OPTIONS.viewport,
  );
  if (!viewport.ok) return viewport;
  const rawOnePage = options.onePage;
  if (rawOnePage !== undefined && typeof rawOnePage !== "boolean")
    return invalid("`options.onePage` must be a boolean.", "options.onePage");
  return {
    ok: true,
    value: {
      pageSize: pageSize.value,
      orientation: orientation.value,
      margin: margin.value,
      viewport: viewport.value,
      onePage: rawOnePage === true,
    },
  };
}

/** CSS pixels per inch: the unit Chromium lays out in. */
export const CSS_PX_PER_INCH = 96;

/** The range `Page.printToPDF` accepts for `scale`. */
export const PRINT_SCALE_RANGE: readonly [number, number] = [0.1, 2];

/** Where a validated request puts the page, before any content is measured. */
export interface HtmlPrintGeometry {
  /** Paper width × height in inches, orientation applied. */
  paperInches: readonly [number, number];
  /** Each edge, in inches. */
  marginInches: number;
  /** `Page.printToPDF` scale: printable width ÷ the viewport width. */
  scale: number;
  /** The CSS-pixel width the page is laid out at when printed. */
  layoutWidthPx: number;
  /**
   * True when the chosen screen width cannot be met on this paper inside
   * {@link PRINT_SCALE_RANGE}: the page is then laid out at
   * {@link layoutWidthPx}, not at the screen width asked for.
   */
  scaleClamped: boolean;
  /** Whether the page's own `@page` size still decides the paper. */
  preferCSSPageSize: boolean;
}

/**
 * The paper, margins and scale a request prints at. Pure, and shared: the
 * worker builds `Page.printToPDF` from it, the panel states from it when a
 * screen width cannot be met on the chosen paper.
 *
 * With `pageSize: "auto"` the paper is Chromium's default Letter, and the
 * page's own `@page` size still wins — but only while nothing else asks for
 * a width: a screen width or one long page needs a known paper, so either
 * one sets it.
 */
export function htmlPrintGeometry(
  options: HtmlRenderOptions,
): HtmlPrintGeometry {
  const size =
    HTML_PAGE_SIZES.find((s) => s.id === options.pageSize)?.inches ??
    CHROMIUM_DEFAULT_PAPER_INCHES;
  const [short, long] = size;
  const paperInches: readonly [number, number] =
    options.orientation === "landscape" ? [long, short] : [short, long];
  const marginInches =
    HTML_MARGINS.find((m) => m.id === options.margin)?.inches ?? 0.4;
  const printablePx = (paperInches[0] - 2 * marginInches) * CSS_PX_PER_INCH;
  const viewport = HTML_VIEWPORTS.find((v) => v.id === options.viewport);
  const wanted = viewport?.width ? printablePx / viewport.width : 1;
  const [lo, hi] = PRINT_SCALE_RANGE;
  const scale = Math.min(hi, Math.max(lo, wanted));
  return {
    paperInches,
    marginInches,
    scale,
    layoutWidthPx: printablePx / scale,
    scaleClamped: scale !== wanted,
    preferCSSPageSize:
      options.pageSize === "auto" &&
      options.viewport === "auto" &&
      !options.onePage,
  };
}

/**
 * The height of the one page "one long page" prints, in inches: the
 * content's measured CSS height, scaled as printed, plus a 16 px allowance
 * for the difference between a measured and a printed layout (white space at
 * the foot, never a second page), plus the margins; at most
 * {@link HTML_ONE_PAGE_MAX_INCHES}.
 */
export function onePageHeightInches(
  geometry: HtmlPrintGeometry,
  contentHeightPx: number,
): number {
  const content =
    ((Math.ceil(Math.max(0, contentHeightPx)) + 16) * geometry.scale) /
    CSS_PX_PER_INCH;
  return Math.min(
    HTML_ONE_PAGE_MAX_INCHES,
    content + 2 * geometry.marginInches,
  );
}

/**
 * The options bag a client sends: only what differs from the defaults, so a
 * job that changes nothing is byte-for-byte the request it always was.
 */
export function htmlRenderOptionsBag(
  options: HtmlRenderOptions,
): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  const d = DEFAULT_HTML_RENDER_OPTIONS;
  if (options.pageSize !== d.pageSize) bag.pageSize = options.pageSize;
  if (options.orientation !== d.orientation)
    bag.orientation = options.orientation;
  if (options.margin !== d.margin) bag.margin = options.margin;
  if (options.viewport !== d.viewport) bag.viewport = options.viewport;
  if (options.onePage) bag.onePage = true;
  return bag;
}
