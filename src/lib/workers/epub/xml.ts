/**
 * A small, tolerant XML reader for the four EPUB files the engine reads
 * itself: `META-INF/container.xml`, the package (OPF), the EPUB 3 navigation
 * document and the EPUB 2 NCX. Chapters are never parsed here — Chromium
 * reads those.
 *
 * Tolerant on purpose: a stray unclosed tag closes at its parent's end tag,
 * and an unknown entity is kept as written. Names keep their prefix; callers
 * match on the LOCAL name, since books disagree on prefixes but not on what
 * an `itemref` is. No DTD is read and no external entity is ever resolved.
 */

export interface XmlElement {
  /** Local name, lower-cased (`opf:itemref` → `itemref`). */
  name: string;
  /** Attributes by local name, lower-cased, plus each full `prefix:name`. */
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body) => {
    const b = String(body);
    if (b[0] === "#") {
      const code =
        b[1] === "x" || b[1] === "X"
          ? parseInt(b.slice(2), 16)
          : parseInt(b.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[b.toLowerCase()] ?? whole;
  });
}

const localName = (qname: string) =>
  (qname.includes(":")
    ? qname.slice(qname.indexOf(":") + 1)
    : qname
  ).toLowerCase();

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** Parse `text` into a root holding its top-level nodes. */
export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: "#root", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const top = () => stack[stack.length - 1]!;
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) {
      top().children.push(decodeEntities(text.slice(i)));
      break;
    }
    if (lt > i) top().children.push(decodeEntities(text.slice(i, lt)));
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      top().children.push(text.slice(lt + 9, end < 0 ? text.length : end));
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith("<!", lt) || text.startsWith("<?", lt)) {
      // A DOCTYPE may carry an internal subset in [...]: skip past it whole.
      let j = lt + 2;
      let depth = 0;
      while (j < text.length) {
        const c = text[j];
        if (c === "[") depth += 1;
        else if (c === "]") depth -= 1;
        else if (c === ">" && depth <= 0) break;
        j += 1;
      }
      i = j + 1;
      continue;
    }
    // A tag: find its end outside quotes.
    let j = lt + 1;
    let quote = "";
    while (j < text.length) {
      const c = text[j]!;
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j += 1;
    }
    const raw = text.slice(lt + 1, j);
    i = j + 1;
    if (raw.startsWith("/")) {
      const name = localName(raw.slice(1).trim());
      // Close back to the matching open element; ignore a stray end tag.
      for (let k = stack.length - 1; k > 0; k -= 1)
        if (stack[k]!.name === name) {
          stack.length = k;
          break;
        }
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameEnd = body.search(/[\s]/);
    const qname = nameEnd < 0 ? body : body.slice(0, nameEnd);
    const attrs: Record<string, string> = {};
    for (const m of body.slice(qname.length).matchAll(ATTR)) {
      const value = decodeEntities(m[3] ?? m[4] ?? "");
      attrs[m[1]!.toLowerCase()] = value;
      attrs[localName(m[1]!)] ??= value;
    }
    const el: XmlElement = { name: localName(qname), attrs, children: [] };
    top().children.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
}

export const isElement = (node: XmlNode): node is XmlElement =>
  typeof node !== "string";

/** Every descendant element named `name`, in document order. */
export function findAll(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement) => {
    for (const child of node.children)
      if (isElement(child)) {
        if (child.name === name) out.push(child);
        walk(child);
      }
  };
  walk(el);
  return out;
}

export const findFirst = (el: XmlElement, name: string) => findAll(el, name)[0];

export const childElements = (el: XmlElement, name?: string) =>
  el.children.filter(
    (c): c is XmlElement => isElement(c) && (!name || c.name === name),
  );

/** The element's text, whitespace collapsed. */
export function textOf(el: XmlElement): string {
  const parts: string[] = [];
  const walk = (node: XmlElement) => {
    for (const child of node.children)
      if (typeof child === "string") parts.push(child);
      else walk(child);
  };
  walk(el);
  return parts.join("").replace(/\s+/g, " ").trim();
}
