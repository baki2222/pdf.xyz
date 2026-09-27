/**
 * A real XML parser's verdict on a string, for tests.
 *
 * jsdom's `DOMParser` is a strict XML 1.0 parser: it refuses an unbalanced tag,
 * an undeclared prefix, and a character the spec forbids (U+0001, U+FFFF, a lone
 * surrogate). That last class is the one a regex never sees, and the one text
 * lifted out of a PDF can carry. `pptx-package.test.ts` holds this helper's
 * positive controls, so a parser that stopped reporting errors would go red
 * there rather than pass everything silently.
 */
import { createRequire } from "node:module";

// jsdom ships no type declarations; this is the one shape used here.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string) => {
    window: { DOMParser: typeof globalThis.DOMParser };
  };
};
const { DOMParser } = new JSDOM("").window;

/** Why `xml` is not well-formed, or `null` when it is. */
export function xmlWellFormedness(xml: string): string | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (!error) return null;
  return (error.textContent ?? "parser error")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

/** Parse `xml` that must be well-formed, for tests that then read it. */
export function parseXml(xml: string): Document {
  const why = xmlWellFormedness(xml);
  if (why !== null) throw new Error(`not well-formed XML: ${why}`);
  return new DOMParser().parseFromString(xml, "application/xml");
}
