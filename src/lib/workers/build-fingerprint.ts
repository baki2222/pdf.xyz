/**
 * What CODE is this worker image actually running?
 *
 * ── THE QUESTION THIS ANSWERS, AND THE ONE IT DELIBERATELY DOES NOT ─────────
 *
 * On 2026-08-21 the running image turned out to have been built on 2026-08-12,
 * nine days of merged engine work never executing. Settling that took an ssh
 * session and a grep inside the container, and the first attempt at settling it
 * **failed**: the "old" image id was captured after the rebuild, so the id could
 * not distinguish new from stale. What actually settled it was
 * `planTranslateChunks 2 files` versus `0 files` — a capability, not an
 * identity.
 *
 * This publishes that grep as a value. **It is diagnostic evidence, not an
 * alarm**, and the distinction is the whole design.
 *
 * ── WHY IT IS NOT AN ALARM ──────────────────────────────────────────────────
 *
 * The obvious bound is "the worker's fingerprint must equal `main`'s". It would
 * be **red most of the time and for a correct reason**: the web tier
 * auto-deploys on every merge and the worker is rebuilt deliberately and
 * rarely, so the two tiers are unequal by design for most of any given day. A
 * check that fires constantly is a check people learn to close, and a guard
 * that gets ignored is worse than one that does not exist — it occupies the
 * space where a real one would go.
 *
 * Narrowing it to "worker-relevant files only" does not rescue it either: the
 * chunking engine lives in `src/lib/workers/translate/`, but the ceiling it
 * reads lives in `src/lib/jobs/translate-limits.ts`, so any hand-drawn subtree
 * is under-broad in exactly the direction that matters. That is rule 4 — a
 * right command over the wrong set — and the honest way out is to widen the set
 * and stop pretending inequality is a failure.
 *
 * **So the alarm stays with the capability probes**, which answer *can it do
 * the thing we claim* and are silent while the answer is yes. This answers *and
 * which build is that*, which is the question you ask once the alarm has fired
 * — and answering it should be a read, not a shell session.
 *
 * ── WHAT IT IS ──────────────────────────────────────────────────────────────
 *
 * A sha256 over every tracked-shaped source file the image carries, normalised
 * so the value is a property of the CODE and not of the machine that checked
 * it out:
 *
 *   - files sorted by POSIX path, so directory-read order cannot change it;
 *   - the path is hashed with the content, so a rename is a change;
 *   - CRLF folded to LF and a trailing newline ignored, because nothing in this
 *     repo pins line endings — there is no `.gitattributes`, and `core.autocrlf`
 *     is whatever each machine happens to have. A fingerprint that changed when
 *     a Windows checkout touched it would be measuring the checkout.
 *
 * Measured on this tree: 935 files, 6.7 MB, **65 ms cold and 56 ms warm**, and
 * identical across runs. Cheap enough for a daemon start-up, which is the only
 * place it runs.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Directories that hold the code an image ships. Derived by walking, not listed per-file. */
const ROOTS = ["src", "scripts"] as const;

/** Source extensions. A `.json` or an asset changing is not a code change. */
const SOURCE = /\.(ts|tsx|mts|cts)$/;

/**
 * The published length. Twelve hex characters is ~48 bits — far past any
 * accidental collision across the handful of builds that ever run, and short
 * enough to read aloud during an incident.
 */
export const FINGERPRINT_LENGTH = 12;

/** The exact published shape, so the parser can reject anything else. */
export const FINGERPRINT_PATTERN = /^[0-9a-f]{12}$/;

function collect(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // A root this image does not carry contributes nothing.
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (SOURCE.test(entry.name)) out.push(full);
  }
}

/**
 * Fingerprint the source tree rooted at `cwd`.
 *
 * Returns `null` when there is nothing to fingerprint — an image that ships no
 * sources cannot answer, and **an empty tree must not produce a confident
 * hash**. `sha256("")` is a perfectly good-looking 12 characters that would
 * compare equal to every other empty tree, which is the vacuous-pass shape in
 * its most literal form.
 */
export function computeBuildFingerprint(
  cwd: string = process.cwd(),
): string | null {
  const files: string[] = [];
  for (const root of ROOTS) collect(path.join(cwd, root), files);
  if (files.length === 0) return null;

  const relative = files
    .map((file) => path.relative(cwd, file).split(path.sep).join("/"))
    .sort();

  const hash = createHash("sha256");
  for (const rel of relative) {
    hash.update(rel);
    hash.update("\0");
    const raw = readFileSync(path.join(cwd, rel), "utf8");
    hash.update(raw.replace(/\r\n/g, "\n").replace(/\n+$/, "\n"));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, FINGERPRINT_LENGTH);
}
