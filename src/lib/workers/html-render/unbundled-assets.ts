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
 * Except for the few kinds Chromium loads from the document's OWN origin only
 * (`sameOriginOnly` below): the document's origin is the unreachable served
 * address, so every http(s) reference of theirs is missing, public or not.
 *
 * CHECKED AGAINST THE RENDERER, both ways, in
 * `unbundled-assets.chromium.test.ts` (a real Chromium, the real render
 * network, and a tap on every request it makes):
 *   - each source's `sample` must make Chromium ask for its reference, so no
 *     entry is decoration;
 *   - over corpora written from the HTML/SVG/CSS specs and from a browser's
 *     "Save page as" output — NOT from this table, which could only ever
 *     prove itself — every sub-resource Chromium asks for must be one this
 *     scan reports, or be on that test's `NON_PRINTING` list with a reason.
 * That second corpus is the only thing that can say an element kind is
 * missing here. It is hand-written, so a kind nobody thought to put in it is
 * still unseen: grow it when you learn of one.
 */
export interface AssetSource {
  /** Elements that carry the reference. */
  selector: string;
  /** Attributes read on each; `null` reads the element's text (a `<style>`). */
  attributes: readonly string[] | null;
  /** How the value holds URLs. */
  syntax: "url" | "srcset" | "css";
  /**
   * Chromium loads this kind from the document's own origin only, and that
   * origin is the served address it never fetches — so a public URL is
   * missing too. Measured, not assumed: the renderer test puts every source
   * behind a public `<base>` and checks the scan names exactly what fails.
   */
  sameOriginOnly?: boolean;
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
    selector: "video",
    attributes: ["src"],
    syntax: "url",
    sample: (u) => `<video src="${u}"></video>`,
  },
  {
    selector: "audio",
    attributes: ["src"],
    syntax: "url",
    sample: (u) => `<audio src="${u}"></audio>`,
  },
  {
    // A media element's <source>; a <picture> one uses srcset (above).
    selector: "source",
    attributes: ["src"],
    syntax: "url",
    sample: (u) => `<video><source src="${u}" type="video/mp4"></video>`,
  },
  {
    // Same origin only even with `crossorigin`: measured, a public caption
    // file behind `crossorigin="anonymous"` is never requested.
    selector: "track",
    attributes: ["src"],
    syntax: "url",
    sameOriginOnly: true,
    sample: (u) => `<video><track default kind="captions" src="${u}"></video>`,
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
    // An external sprite: `<use href="icons.svg#share">`.
    selector: "svg use",
    attributes: ["href", "xlink:href"],
    syntax: "url",
    sameOriginOnly: true,
    sample: (u) => `<svg width="10" height="10"><use href="${u}#i"/></svg>`,
  },
  {
    // SVG names are case-sensitive in a selector: `feimage` matches nothing.
    selector: "svg feImage",
    attributes: ["href", "xlink:href"],
    syntax: "url",
    sample: (u) =>
      `<svg width="10" height="10"><filter id="f"><feImage href="${u}"/></filter><rect width="10" height="10" filter="url(#f)"/></svg>`,
  },
  {
    selector: "svg script",
    attributes: ["href", "xlink:href"],
    syntax: "url",
    sample: (u) => `<svg><script href="${u}"></script></svg>`,
  },
  {
    // SVG presentation attributes that take a url() Chromium fetches.
    // (`fill` and `stroke` take one too, but Chromium does not fetch an
    // external paint server, so naming it would be a note for nothing.)
    selector:
      "svg [mask], svg [clip-path], svg [marker-start], svg [marker-mid], svg [marker-end]",
    attributes: [
      "mask",
      "clip-path",
      "marker-start",
      "marker-mid",
      "marker-end",
    ],
    syntax: "css",
    sample: (u) =>
      `<svg width="10" height="10"><rect width="10" height="10" mask="url(${u}#m)"/></svg>`,
  },
  {
    selector: "svg [filter]",
    attributes: ["filter"],
    syntax: "css",
    sameOriginOnly: true,
    sample: (u) =>
      `<svg width="10" height="10"><rect width="10" height="10" filter="url(${u}#f)"/></svg>`,
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

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([^\n\r\f0-9a-fA-F]))/g;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi;
const CSS_IMPORT = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;
/** `image-set(` and `-webkit-image-set(`. */
const CSS_IMAGE_SET = /image-set\(/gi;
/** A `filter:` declaration's value: its url() loads from the document's origin only. */
const CSS_FILTER = /(?:^|[\s;{])filter\s*:([^;{}]*)/gi;

/** CSS escapes decoded, so `u\72l(x)` reads as the `url(x)` Chromium sees. */
function cssUnescape(value: string): string {
  return value.replace(
    CSS_ESCAPE,
    (_, hex: string | undefined, ch: string | undefined) => {
      if (hex === undefined) return ch ?? "";
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff)
        ? String.fromCodePoint(cp)
        : "�";
    },
  );
}

/** Split `value` at top-level commas: not inside parentheses or quotes. */
function topLevelItems(value: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      items.push(value.slice(start, i));
      start = i + 1;
    }
  }
  items.push(value.slice(start));
  return items;
}

/**
 * `image-set("a.png" 1x, url(b.png) 2x)`: a candidate may be a bare string,
 * which Chromium fetches like a url(). (url() candidates are read by CSS_URL;
 * a `type("image/png")` string is not a candidate's first token, so it is not
 * mistaken for one.)
 */
function imageSetStrings(css: string): string[] {
  const urls: string[] = [];
  for (const m of css.matchAll(CSS_IMAGE_SET)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let quote = "";
    let end = start;
    for (; end < css.length && depth > 0; end++) {
      const c = css[end]!;
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    const inner = css.slice(start, depth === 0 ? end - 1 : end);
    for (const item of topLevelItems(inner)) {
      const candidate = item.trim();
      const q = candidate[0];
      if (q !== '"' && q !== "'") continue;
      const close = candidate.indexOf(q, 1);
      if (close > 0) urls.push(candidate.slice(1, close));
    }
  }
  return urls;
}

interface FoundUrl {
  url: string;
  sameOriginOnly: boolean;
}

function cssUrls(value: string): FoundUrl[] {
  const css = cssUnescape(value.replace(CSS_COMMENT, ""));
  const sameOrigin = new Set<string>();
  for (const decl of css.matchAll(CSS_FILTER))
    for (const m of decl[1]!.matchAll(CSS_URL))
      sameOrigin.add(m[1] ?? m[2] ?? m[3] ?? "");
  const urls: string[] = [];
  for (const m of css.matchAll(CSS_URL)) urls.push(m[1] ?? m[2] ?? m[3] ?? "");
  for (const m of css.matchAll(CSS_IMPORT)) urls.push(m[1] ?? m[2] ?? "");
  urls.push(...imageSetStrings(css));
  return urls.map((url) => ({ url, sameOriginOnly: sameOrigin.has(url) }));
}

function urlsIn(value: string, source: AssetSource): FoundUrl[] {
  const sameOriginOnly = source.sameOriginOnly === true;
  if (source.syntax === "css")
    return cssUrls(value).map((u) => ({
      url: u.url,
      sameOriginOnly: sameOriginOnly || u.sameOriginOnly,
    }));
  const urls = source.syntax === "srcset" ? srcsetUrls(value) : [value];
  return urls.map((url) => ({ url, sameOriginOnly }));
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

/**
 * The address references resolve against: `fallback` (the served URL, or for
 * an `<iframe srcdoc>` its parent's base), through the root's own `<base>`.
 */
function documentBase(root: ParentNode, fallback: URL): URL {
  const href = root.querySelector("base[href]")?.getAttribute("href");
  if (!href) return fallback;
  try {
    return new URL(href.trim(), fallback);
  } catch {
    return fallback;
  }
}

/** How deep `<iframe srcdoc>` documents are followed. */
const MAX_SRCDOC_DEPTH = 4;

function isMissing(
  raw: string,
  base: URL,
  servedHost: string,
  sameOriginOnly: boolean,
): boolean {
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
    return sameOriginOnly || resolved.host === servedHost;
  return true;
}

const ALL_SELECTORS = [
  ...ASSET_SOURCES.map((s) => s.selector),
  "iframe[srcdoc]",
].join(", ");

export function findUnbundledAssets(doc: Document): UnbundledAssets {
  const servedHost = new URL(HTML_DOCUMENT_URL).host;
  const seen = new Set<string>();
  const references: string[] = [];

  const scan = (root: ParentNode, fallback: URL, depth: number) => {
    const base = documentBase(root, fallback);
    // Membership by querySelectorAll, not `element.matches`: jsdom's
    // `matches("svg feImage")` is false for the very element its
    // `querySelectorAll("svg feImage")` returns (SVG names are camelCase).
    const members = ASSET_SOURCES.map(
      (s) => new Set<Element>(Array.from(root.querySelectorAll(s.selector))),
    );
    // Document order, whichever source a reference came from.
    for (const element of Array.from(root.querySelectorAll(ALL_SELECTORS))) {
      ASSET_SOURCES.forEach((source, i) => {
        if (!members[i]!.has(element)) return;
        const values =
          source.attributes === null
            ? [element.textContent ?? ""]
            : source.attributes
                .map((name) => element.getAttribute(name))
                .filter((v): v is string => v !== null);
        for (const value of values)
          for (const found of urlsIn(value, source)) {
            const ref = found.url.trim();
            if (
              seen.has(ref) ||
              !isMissing(ref, base, servedHost, found.sameOriginOnly)
            )
              continue;
            seen.add(ref);
            references.push(ref);
          }
      });
      // An `<iframe srcdoc>` is a document inside an attribute. Its
      // references resolve against this document's base, and load or not
      // exactly as this document's do.
      const srcdoc = element.getAttribute("srcdoc");
      if (
        srcdoc !== null &&
        element.localName === "iframe" &&
        depth < MAX_SRCDOC_DEPTH
      ) {
        const template = doc.createElement("template");
        template.innerHTML = srcdoc;
        scan(template.content, base, depth + 1);
      }
    }
  };

  scan(doc, new URL(HTML_DOCUMENT_URL), 0);
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
