/**
 * Serialise one schema.org node for a `<script type="application/ld+json">`
 * body.
 *
 * `JSON.stringify` alone is NOT safe here, and this file used to say it was:
 * the old comment read "</script> can't appear in serialized JSON" — but JSON
 * escapes quotes and backslashes, not `<`, so a string value containing
 * `</script>` came through intact and closed the tag early. The HTML tokenizer
 * ends a script element at the first `</script` it sees, whatever JSON thinks
 * is a string. Today every value is our own catalogue and guide copy, so
 * nothing was exploitable — but the first FAQ answer mentioning `</` would
 * have broken the page, and the first dynamic field would have been stored
 * XSS.
 *
 * Every `<` becomes `\u003c`: the same string to a JSON parser (so crawlers
 * read identical data), and no `</script` or `<!--` the tokenizer can match.
 * `json-ld.test.tsx` renders a hostile node through the component and proves
 * both halves.
 */
export function serializeJsonLd(node: Record<string, unknown>): string {
  return JSON.stringify(node).replace(/</g, "\\u003c");
}

/**
 * Renders schema.org structured data as a JSON-LD script tag. Accepts a single
 * node or an array of nodes (emitted as one script each).
 */
export function JsonLd({
  data,
}: {
  data: Record<string, unknown> | Record<string, unknown>[];
}) {
  const nodes = Array.isArray(data) ? data : [data];
  return (
    <>
      {nodes.map((node, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(node) }}
        />
      ))}
    </>
  );
}
