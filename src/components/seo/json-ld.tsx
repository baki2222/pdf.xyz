/**
 * Renders schema.org structured data as a JSON-LD script tag. Accepts a single
 * node or an array of nodes (emitted as one script each). Content is
 * build-time/server-derived from our own catalog, never user input.
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
          // JSON.stringify escapes nothing dangerous here; the payload is our
          // own static catalog data. </script> can't appear in serialized JSON.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(node) }}
        />
      ))}
    </>
  );
}
