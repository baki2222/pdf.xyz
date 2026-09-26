import { HTML_DOCUMENT_URL } from "./document-url";

/**
 * Which of an uploaded HTML file's references will NOT be in the PDF, told to
 * the user before they upload it.
 *
 * WHY. html-to-pdf takes exactly one file. The worker serves it to Chromium at
 * `HTML_DOCUMENT_URL` and fetches nothing from that address, so every
 * reference that resolves against it — `<img src="logo.png">`, a sibling
 * `style.css`, a browser "Save page as" export's `page_files/` — renders as a
 * broken image or an unstyled page. The job still completes, so the user got
 * a loud success and a wrong PDF with nothing saying why.
 *
 * WHAT COUNTS. A reference is missing when it resolves (against the document
 * address, through any `<base href>`) to that address's own host, or to a
 * scheme the renderer never loads (`file:` and the like). It is fine when it
 * resolves to another http(s) host — the renderer fetches public addresses —
 * or is inline (`data:`, `blob:`) or not a fetch at all (`#frag`, `mailto:`).
 *
 * THE TABLE IS THE CORPUS. Each source carries a `sample` element, and
 * `native.chromium.test.ts` renders every sample through a real Chromium and
 * the real render network: each must make Chromium fetch the reference (so no
 * entry is decoration), and every sub-resource Chromium fetches must be one
 * this scan reports (so no element kind is a hole).
 */
export interface AssetSource {
  /** Elements that carry the reference. */
  selector: string;
  /** Attributes read on each; `null` reads the element's text (a `<style>`). */
  attributes: readonly string[] | null;
  /** How the value holds URLs. */
  syntax: "url" | "srcset" | "css";
  /** A minimal element carrying `url` this way. */
  sample: (url: string) => string;
}

export const ASSET_SOURCES: readonly AssetSource[] = [
  {
    selector: "img",
    attributes: ["src"],
    syntax: "url",
    sample: (u) => `<img src="${u}" alt="">`,
  },
  {
    selector: "img",
    attributes: ["srcset"],
    syntax: "srcset",
    sample: (u) => `<img srcset="${u} 1x" alt="">`,
  },
  {
    selector: "picture source",
    attributes: ["srcset"],
    syntax: "srcset",
    sample: (u) => `<picture><source srcset="${u} 1x"><img alt=""></picture>`,
  },
  {
    selector: 'link[rel~="stylesheet" i]',
    attributes: ["href"],
    syntax: "url",
    sample: (u) => `<link rel="stylesheet" href="${u}">`,
  },
  {
    selector: "script",
    attributes: ["src"],
    syntax: "url",
    sample: (u) => `<script src="${u}"></script>`,
  },
  {
    selector: "iframe",
    attributes: ["src"],
    syntax: "url",
    sample: (u) => `<iframe src="${u}"></iframe>`,
  },
  {
    selector: "embed",
    attributes: ["src"],
    syntax: "url",
    sample: (u) => `<embed src="${u}" type="image/png">`,
  },
  {
    selector: "object",
    attributes: ["data"],
    syntax: "url",
    sample: (u) => `<object data="${u}" type="image/png"></object>`,
  },
  {
    selector: "video",
    attributes: ["poster"],
    syntax: "url",
    sample: (u) => `<video poster="${u}"></video>`,
  },
  {
    selector: 'input[type="image" i]',
    attributes: ["src"],
    syntax: "url",
    sample: (u) => `<input type="image" src="${u}" alt="">`,
  },
  {
    // The HTML-3 attribute email templates still use on body/table/td.
    selector: "[background]",
    attributes: ["background"],
    syntax: "url",
    sample: (u) => `<table background="${u}"><tr><td>x</td></tr></table>`,
  },
  {
    selector: "svg image",
    attributes: ["href", "xlink:href"],
    syntax: "url",
    sample: (u) =>
      `<svg width="10" height="10"><image href="${u}" width="10" height="10"/></svg>`,
  },
  {
    selector: "style",
    attributes: null,
    syntax: "css",
    sample: (u) => `<style>@import "${u}";</style>`,
  },
  {
    selector: "[style]",
    attributes: ["style"],
    syntax: "css",
    sample: (u) =>
      `<div style="width:10px;height:10px;background-image:url('${u}')"></div>`,
  },
];

export interface UnbundledAssets {
  /** Distinct missing references, in document order, as written in the file. */
  references: string[];
}

/** URLs in a `srcset`, per the HTML spec's candidate parser (data: URLs keep their commas). */
function srcsetUrls(value: string): string[] {
  const urls: string[] = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i]!)) i++;
    if (i >= value.length) break;
    let j = i;
    while (j < value.length && !/\s/.test(value[j]!)) j++;
    let url = value.slice(i, j);
    i = j;
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      let depth = 0;
      for (; i < value.length; i++) {
        const c = value[i];
        if (c === "(") depth++;
        else if (c === ")") depth = Math.max(0, depth - 1);
        else if (c === "," && depth === 0) {
          i++;
          break;
        }
      }
    }
    if (url) urls.push(url);
  }
  return urls;
}

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi;
const CSS_IMPORT = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;

function cssUrls(value: string): string[] {
  const urls: string[] = [];
  for (const m of value.matchAll(CSS_URL))
    urls.push(m[1] ?? m[2] ?? m[3] ?? "");
  for (const m of value.matchAll(CSS_IMPORT)) urls.push(m[1] ?? m[2] ?? "");
  return urls;
}

function urlsIn(value: string, syntax: AssetSource["syntax"]): string[] {
  if (syntax === "srcset") return srcsetUrls(value);
  if (syntax === "css") return cssUrls(value);
  return [value];
}

/** Inline, or not a fetch: never "missing". */
const NOT_A_FILE = new Set([
  "data:",
  "blob:",
  "about:",
  "javascript:",
  "mailto:",
  "tel:",
]);

/** The address references resolve against: the served URL, through `<base>`. */
function documentBase(doc: Document): URL {
  const served = new URL(HTML_DOCUMENT_URL);
  const href = doc.querySelector("base[href]")?.getAttribute("href");
  if (!href) return served;
  try {
    return new URL(href.trim(), served);
  } catch {
    return served;
  }
}

function isMissing(raw: string, base: URL, servedHost: string): boolean {
  const value = raw.trim();
  if (!value || value.startsWith("#")) return false;
  let resolved: URL;
  try {
    resolved = new URL(value, base);
  } catch {
    return false;
  }
  if (NOT_A_FILE.has(resolved.protocol)) return false;
  if (resolved.protocol === "http:" || resolved.protocol === "https:")
    return resolved.host === servedHost;
  return true;
}

export function findUnbundledAssets(doc: Document): UnbundledAssets {
  const base = documentBase(doc);
  const servedHost = new URL(HTML_DOCUMENT_URL).host;
  const seen = new Set<string>();
  const references: string[] = [];
  // Document order, whichever source a reference came from.
  const all = doc.querySelectorAll(
    ASSET_SOURCES.map((s) => s.selector).join(", "),
  );
  for (const element of Array.from(all)) {
    for (const source of ASSET_SOURCES) {
      if (!element.matches(source.selector)) continue;
      const values =
        source.attributes === null
          ? [element.textContent ?? ""]
          : source.attributes
              .map((name) => element.getAttribute(name))
              .filter((v): v is string => v !== null);
      for (const value of values)
        for (const raw of urlsIn(value, source.syntax)) {
          const ref = raw.trim();
          if (seen.has(ref) || !isMissing(ref, base, servedHost)) continue;
          seen.add(ref);
          references.push(ref);
        }
    }
  }
  return { references };
}

/** Parse an uploaded file's text and scan it. Browser-only (DOMParser). */
export function findUnbundledAssetsInHtml(html: string): UnbundledAssets {
  return findUnbundledAssets(
    new DOMParser().parseFromString(html, "text/html"),
  );
}

/** The note shown under the chosen file; `null` when nothing is missing. */
export function unbundledAssetsNote(found: UnbundledAssets): string | null {
  const n = found.references.length;
  if (n === 0) return null;
  const first = found.references[0]!;
  const example = first.length > 60 ? `${first.slice(0, 57)}…` : first;
  return n === 1
    ? `1 linked file (${example}) is not part of this upload and will be missing from the PDF. Embed it in the HTML, or link it with a full https:// address.`
    : `${n} linked files (e.g. ${example}) are not part of this upload and will be missing from the PDF. Embed them in the HTML, or link them with full https:// addresses.`;
}
