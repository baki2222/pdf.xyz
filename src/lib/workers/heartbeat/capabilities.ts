/**
 * The single RUNTIME enumeration of what a worker publishes about itself, as a
 * LEAF module: one type-only import and nothing else, so its runtime graph is
 * empty and it is safe to reach from a client component.
 *
 * WHY THIS IS ITS OWN FILE, and it is not tidiness.
 *
 * The operations dashboard derives its capability corpus from this enumeration
 * rather than retyping it — that is the whole point of the corpus: a hand-typed
 * list asked about two of the seven fields the wire carries, and a worker
 * publishing `malwareScan: false` read green under a row claiming it had proved
 * everything. But the derivation has to be reachable from the tier that renders
 * the row, and `"use client"` puts that tier in the browser bundle.
 *
 * When this function lived in `./factory`, importing it for its key set dragged
 * the entire heartbeat runtime in behind it:
 *
 *     operations-dashboard.tsx  ("use client")
 *       → components/status/operations-ui.tsx
 *       → components/status/alert-posture.tsx
 *       → lib/workers/observability/index.ts
 *       → lib/workers/observability/snapshot.ts
 *       → lib/workers/heartbeat/factory.ts
 *       → lib/workers/heartbeat/schema.ts     (for FINGERPRINT_PATTERN)
 *       → lib/workers/build-fingerprint.ts
 *       → node:crypto, node:fs, node:path
 *
 * and webpack refused the client build outright: *"Reading from `node:fs` is not
 * handled by plugins (Unhandled scheme)"*. Seven key names cost the reader the
 * Redis transport, the parser, the serializer and three Node built-ins.
 *
 * Note the shape of the mistake, because the docblocks were no help: both
 * `./factory` and `./index` describe themselves as "Node-free", and both have
 * been wrong since `schema.ts` began importing the fingerprint pattern. A
 * comment is not a guard — `src/deploy/client-bundle-node-free.test.ts` walks
 * the real import graph out of every `"use client"` root and is what actually
 * holds this line.
 *
 * The enumeration stays HERE and `./factory` re-exports it, so there is still
 * exactly one list of capability keys in the tree and no tier can drift from
 * another.
 */

import type { HeartbeatCapabilities } from "./types";

/**
 * All-false capabilities — the safe default when a caller has nothing to report,
 * and the one place the set of publishable capabilities is written down.
 *
 * The `HeartbeatCapabilities` return annotation is load-bearing in BOTH
 * directions on an object literal: a field added to the interface fails here as
 * missing, and a field removed from it fails here as excess. That is what makes
 * `Object.keys(emptyCapabilities())` a corpus rather than a guess.
 */
export function emptyCapabilities(): HeartbeatCapabilities {
  return {
    deepCompression: false,
    ocr: false,
    ocrLanguages: [],
    malwareScan: false,
    atomicQueue: false,
    chunkedTranslate: false,
    deliveryCap: false,
    aiReadCap: false,
    pptxPresentationChain: false,
  };
}
