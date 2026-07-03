/**
 * Pure, node-free **ops-bundle summary ingest** for the release evidence artifact (Phase 47) — an
 * optional trust boundary.
 *
 * The artifact can attach an operator's own `pnpm worker:ops-bundle --json` summary as incident-
 * handoff CONTEXT. This module reduces that untrusted JSON to the bounded
 * {@link ReleaseArtifactOpsBundle}: it validates the schema and reads ONLY the composite
 * `rollup.severity` (a bounded enum); it copies no section, alert, or free-text field. It never
 * throws and never echoes the offending content.
 *
 * Crucially, the attached bundle is CONTEXT, not a gate: an ops-bundle reflects a runtime's live
 * operations posture (possibly a different environment during an incident handoff), not the
 * promotion-readiness of THIS build. So an unreadable or `critical` bundle is surfaced honestly but
 * does NOT drive the artifact rollup (see `./build`). Absence is `not-configured` (never a fault).
 */

import {
  OPS_BUNDLE_SCHEMA,
  OPS_BUNDLE_SEVERITIES,
  type OpsBundleSeverity,
} from "../ops-bundle/types";
import { type ReleaseArtifactOpsBundle } from "./types";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return `value` if it is one of `allowed`, else `undefined`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** The authored detail per resolved severity of a supplied bundle. */
function suppliedDetail(severity: OpsBundleSeverity): string {
  return `An ops-bundle summary was attached as incident-handoff context; its composite severity is ${severity}. It does not change the release verdict, which is driven by the offline release-gate evidence and this build's provenance.`;
}

/** The bounded ops-bundle section for an absent optional input (the honest default, not a fault). */
export const NOT_CONFIGURED_OPS_BUNDLE: ReleaseArtifactOpsBundle = {
  source: "not-configured",
  present: false,
  severity: null,
  detail:
    "No ops-bundle summary was attached. Point --ops-bundle at a content-free `pnpm worker:ops-bundle --json` summary to include runtime operations context in the archive.",
};

/** The bounded ops-bundle section for a supplied-but-unreadable optional input (never echoed). */
export function unreadableOpsBundle(): ReleaseArtifactOpsBundle {
  return {
    source: "unreadable",
    present: false,
    severity: null,
    detail:
      "The attached ops-bundle input is not a recognized content-free `pdfxyz.ops-bundle/1` summary (unreadable, malformed, or the wrong shape), so its posture could not be archived. The offending content is never echoed.",
  };
}

/** The bounded ops-bundle section for a supplied bundle that itself reported a usage error. */
function usageErrorOpsBundle(): ReleaseArtifactOpsBundle {
  return {
    source: "supplied",
    present: true,
    severity: null,
    detail:
      "The attached ops-bundle summary reported a usage error (its required ops-check input was unusable), so it carries no composite severity. It is archived for context only and does not change the release verdict.",
  };
}

/**
 * Parse + validate an OPTIONAL ops-bundle summary. `null` text ⇒ not-configured; anything
 * unreadable/unrecognized ⇒ `unreadable` (never echoed); a valid full bundle ⇒ `supplied` with its
 * bounded composite severity; a valid bundle that reported a usage error ⇒ `supplied` with a `null`
 * severity.
 */
export function ingestOpsBundleSummary(text: string | null): ReleaseArtifactOpsBundle {
  if (text === null) return NOT_CONFIGURED_OPS_BUNDLE;

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return unreadableOpsBundle();
  }
  if (!isObject(root) || root.schema !== OPS_BUNDLE_SCHEMA) return unreadableOpsBundle();

  // A valid ops-bundle usage-error outcome carries no rollup; surface it as context, not unreadable.
  if (root.ok === false || root.error === "usage") return usageErrorOpsBundle();

  const rollup = isObject(root.rollup) ? root.rollup : undefined;
  const severity = rollup ? oneOf(rollup.severity, OPS_BUNDLE_SEVERITIES) : undefined;
  if (!severity) return unreadableOpsBundle();

  return { source: "supplied", present: true, severity, detail: suppliedDetail(severity) };
}
