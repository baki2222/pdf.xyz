/**
 * Client-facing result metadata for `repair-pdf`: **what qpdf had to fix**.
 *
 * qpdf reports a recovered document with exit status 3 — "warnings issued,
 * output was created" — and those warnings are the only record of what was wrong
 * and what was reconstructed. The worker threw them away, and threw away the
 * recovery with them: exit 3 was treated as a failure, so the one status a
 * successful repair of a damaged file actually returns was the one status that
 * could not succeed.
 *
 * A user who hands a repair tool a broken document is entitled to know it WAS
 * broken, and roughly how. This is the seam that tells them. Bounded lines only;
 * the worker sanitizes temp paths out before they get here, and this boundary
 * re-checks rather than trusting that.
 */

/** Max warning lines persisted onto a job record. */
export const MAX_REPAIR_WARNINGS = 10;
/** Max characters kept per warning line. */
export const MAX_REPAIR_WARNING_CHARS = 200;

export interface RepairResultMeta {
  /**
   * True when qpdf produced output but reported problems (its exit 3). A
   * separate field from `warnings.length` so a UI can distinguish "clean" from
   * "recovered, and here is what was wrong" without inspecting the list — and
   * so a run whose warnings were all dropped by sanitizing still reads as
   * recovered rather than as clean.
   */
  recoveredWithWarnings: boolean;
  /** Sanitized qpdf warning lines. Empty on a clean run — never `null`. */
  warnings: string[];
}

/** True when a value plausibly came from the real repair contract. */
export function isRepairResultMeta(value: unknown): value is RepairResultMeta {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as RepairResultMeta).recoveredWithWarnings === "boolean"
  );
}

/**
 * Re-bound an untrusted repair block for persistence.
 *
 * The path check is deliberately duplicated from the worker's sanitizer. That
 * one runs where the temp paths are known and can remove them precisely; this
 * one is the boundary that never trusts its caller, and it fails CLOSED — a line
 * still carrying a path separator is dropped whole rather than partially
 * redacted, because a half-scrubbed path is still a leak.
 *
 * Dropped lines are replaced by a count, never silently removed: a warning list
 * that quietly shrinks reads as "the document was fine", which is the opposite
 * of what it means.
 */
export function buildRepairResultMeta(raw: RepairResultMeta): RepairResultMeta {
  const lines = Array.isArray(raw.warnings) ? raw.warnings : [];
  const kept: string[] = [];
  let withheld = 0;

  for (const line of lines) {
    if (typeof line !== "string") {
      withheld += 1;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (/[/\\]/.test(trimmed) || kept.length >= MAX_REPAIR_WARNINGS) {
      withheld += 1;
      continue;
    }
    kept.push(trimmed.slice(0, MAX_REPAIR_WARNING_CHARS));
  }

  if (withheld > 0) {
    kept.push(`${withheld} further message(s) not shown.`);
  }

  return {
    recoveredWithWarnings: raw.recoveredWithWarnings === true,
    warnings: kept,
  };
}
