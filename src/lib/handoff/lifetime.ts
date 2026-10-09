/**
 * How long a file passed from one page to a tool stays in the browser — one
 * sentence, said by /privacy (§2 and §5), the workspace and anything else
 * that explains a hand-off, and derived from the constant the store enforces.
 *
 * True because claiming a hand-off deletes it (`HandoffStore.claim`), and
 * because the root layout's `HandoffSweep` deletes expired ones on every
 * page; `browser-storage.test.ts` holds the second half to the layout.
 *
 * A leaf, so a page can say it without loading the registry it belongs to.
 * Copy: listed by name in `copyFiles()`.
 */
import { DEFAULT_HANDOFF_TTL_MS } from "./record";

const MINUTES = DEFAULT_HANDOFF_TTL_MS / 60_000;

export const HANDOFF_LIFETIME = `Files you pass to a tool are deleted when that tool opens them. An unopened hand-off expires after ${MINUTES} minutes and is deleted from this browser the next time a pdf.xyz page opens.`;
