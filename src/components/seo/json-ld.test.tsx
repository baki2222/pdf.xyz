// @vitest-environment node
/**
 * `<JsonLd>` must not let a value end its own `<script>` element.
 *
 * This file used to carry a comment instead of a test: "</script> can't
 * appear in serialized JSON." It can — `JSON.stringify` escapes quotes and
 * backslashes, never `<` — and the HTML tokenizer closes a script element at
 * the first `</script` whatever JSON thinks is inside a string. A comment is
 * not a guard.
 *
 * Both halves are checked THROUGH the rendered component, not the helper:
 * the markup contains no early `</script` or `<!--`, and the data a JSON
 * parser reads back out of it is byte-for-byte the node that went in.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JsonLd, serializeJsonLd } from "./json-ld";

const HOSTILE = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  name: "</script><script>alert(1)</script>",
  nested: {
    text: "a <!-- comment opener and </SCRIPT > in caps",
    list: ["<b>", "x</script", "fine"],
  },
};

/** The bodies of every `application/ld+json` script, as the tokenizer splits them. */
function scriptBodies(html: string): string[] {
  return [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi,
    ),
  ].map((m) => m[1] ?? "");
}

describe("<JsonLd> escaping", () => {
  it("positive control: the payload really is hostile to a bare JSON.stringify", () => {
    // If this ever fails the fixture stopped exercising anything, and the
    // assertions below would pass vacuously.
    expect(JSON.stringify(HOSTILE)).toContain("</script>");
    expect(JSON.stringify(HOSTILE)).toContain("<!--");
  });

  it("renders one intact script per node, with no early close", () => {
    const html = renderToStaticMarkup(
      <JsonLd data={[HOSTILE, { "@type": "Thing", name: "plain" }]} />,
    );
    // Exactly as many closing tags as nodes: an early `</script>` would add
    // one and split the first body in two.
    expect(html.match(/<\/script/gi) ?? []).toHaveLength(2);
    expect(html).not.toContain("<!--");
    const bodies = scriptBodies(html);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) expect(body).not.toContain("<");
  });

  it("a JSON parser reads back exactly the node that went in", () => {
    const html = renderToStaticMarkup(<JsonLd data={HOSTILE} />);
    const [body] = scriptBodies(html);
    expect(JSON.parse(body!)).toEqual(HOSTILE);
    // The helper and the component agree — one serialisation.
    expect(body).toBe(serializeJsonLd(HOSTILE));
    expect(body).toContain("\\u003c/script>");
  });
});
