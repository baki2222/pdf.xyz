/**
 * Which font-loading failures are the NETWORK's, decided where they happen.
 *
 * `embedDrawingFont` fetches three things mid-run — the coverage tables and the
 * font engine (dynamic imports) and the face (a `fetch`). A reader who lost
 * their connection must be told so in words. But each of those loads is also
 * followed by an integrity check that throws on a BROKEN BUILD — coverage that
 * "claims only N code points", a fontkit that "exposed no create()" — and
 * telling a reader to check their connection for those is false twice: it
 * blames them, and retrying cannot help.
 *
 * So the classification is made at the step, not guessed afterwards from the
 * error's shape. A `TypeError` thrown by our own code after a module ARRIVED
 * has the same shape as a failed fetch, and only its position says which it
 * is. Everything not marked here is reported as ours, with the original kept as
 * `cause`.
 */

/** A font-loading failure that the network caused. Carries the original. */
export class FontNetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "FontNetworkError";
  }
}

/**
 * Did this dynamic-import rejection come from LOADING the chunk, rather than
 * from evaluating it?
 *
 * The spellings, by source: webpack's `ChunkLoadError` ("Loading chunk N
 * failed" — `next build --webpack`, i.e. production); Turbopack's "Failed to
 * load chunk" (`next dev`); the browsers' own module loaders — Chromium "Failed
 * to fetch dynamically imported module", Safari "Importing a module script
 * failed", Firefox "error loading dynamically imported module".
 *
 * Matched by NAME and MESSAGE, never by `instanceof TypeError` alone: a module
 * that loaded and then threw while evaluating rejects the import with its own
 * error, and a top-level `TypeError` in fontkit is a bundler-interop defect —
 * the kind of build fault this file exists to stop calling "your connection".
 */
export function isModuleLoadFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ChunkLoadError") return true;
  return /loading (css )?chunk|failed to load chunk|dynamically imported module|importing a module script failed/i.test(
    error.message,
  );
}

/**
 * Await a dynamic import, marking a LOAD failure as the network's. Anything
 * else — an evaluation error — passes through unmarked.
 */
export async function importedOverNetwork<T>(
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isModuleLoadFailure(error)) throw new FontNetworkError(error);
    throw error;
  }
}

/**
 * Await a `fetch` or a body read. Either one rejects only when the transfer
 * failed (offline, reset, aborted), so every rejection is the network's.
 */
export async function fetchedOverNetwork<T>(
  step: () => Promise<T>,
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    throw new FontNetworkError(error);
  }
}
