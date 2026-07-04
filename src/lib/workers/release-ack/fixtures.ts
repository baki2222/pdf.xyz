/**
 * Test-support builders for the release evidence handoff acknowledgement tests (Phase 58).
 *
 * The receipt acknowledges a `pdfxyz.release-publish-pack/1`, so these helpers build REAL, self-consistent publish
 * packs of each posture by composing the shipped Phase 57 pack builder (`makePublishPack`, which itself composes the
 * shipped Phase 52–56 tools over genuinely coherent inputs). A clean pack re-derives its own rollup, so the ack's
 * trust boundary marks it `usable`; the `tamper*` helpers flip a recorded verdict so it no longer re-derives (a
 * recognized-but-inconsistent pack the ack catches as `invalid`).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is
 * never imported by any runtime module.
 */

import {
  archivablePack,
  blockedGovernance,
  healthyGovernance,
  incompleteGovernance,
  makePublishPack,
  promoteReadyReport,
  stableTrend,
  verifiedDrill,
  watchGovernance,
} from "../release-publish-pack/fixtures";
import type { ReleasePublishPackResult } from "../release-publish-pack/types";
import { buildAckResult } from "./build";
import { ingestPublishPack, type IngestedAckSource } from "./ingest";
import type { ReleaseAckArgs } from "./args";
import type { ReleaseAckProvider } from "./run";
import type {
  ReleaseAckDecision,
  ReleaseAckNote,
  ReleaseAckResult,
  ReleaseAckReviewer,
} from "./types";

/** A fixed clock the ack tests stamp with (deterministic). */
export const NOW = "2026-07-04T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real publish-pack builders (each self-consistent → usable by the ack)
 * ------------------------------------------------------------------ */

/** A PUBLISHABLE (share-safe) publish pack: a healthy governance + clean archive / drill / report / trend. */
export function publishablePack(): ReleasePublishPackResult {
  return makePublishPack({
    governance: healthyGovernance(),
    archive: archivablePack(),
    restoreDrill: verifiedDrill(),
    report: promoteReadyReport(),
    trend: stableTrend(),
  });
}

/** A REVIEW (internal-review) publish pack: a watch governance (advisory). */
export function reviewPack(): ReleasePublishPackResult {
  return makePublishPack({ governance: watchGovernance() });
}

/** An INCOMPLETE (insufficient) publish pack: an incomplete governance. */
export function incompletePack(): ReleasePublishPackResult {
  return makePublishPack({ governance: incompleteGovernance() });
}

/** A BLOCKED (do-not-share) publish pack: a blocked governance. */
export function blockedPack(): ReleasePublishPackResult {
  return makePublishPack({ governance: blockedGovernance() });
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/** Flip a publish pack's recorded verdict + disclosure so it no longer re-derives (a tamper ⇒ `invalid`). */
export function tamperPack(pack: ReleasePublishPackResult): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(pack)) as Record<string, unknown> & {
    pack: { verdict: string; disclosure: string };
    disclosure: { classification: string };
  };
  const flip = pack.pack.verdict === "publishable" ? "blocked" : "publishable";
  clone.pack.verdict = flip;
  clone.pack.disclosure = flip === "blocked" ? "blocked" : "share-safe";
  clone.disclosure.classification = clone.pack.disclosure;
  return clone;
}

/** A tampered publish pack (a hand-flipped recorded verdict ⇒ a `tampered` pack, `invalid`). */
export function tamperedPack(): Record<string, unknown> {
  return tamperPack(publishablePack());
}

/** An input that is NOT a recognized publish pack (⇒ an `unreadable` pack, `invalid`). */
export function notAPack(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release publish pack" };
}

/* ------------------------------------------------------------------ *
 *  Ack input assembly (what build/reduce/rollup fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** Reduce a pack document (or `undefined` for a not-supplied pack) to the {@link IngestedAckSource} the fold consumes. */
export function ingestAckFrom(pack: unknown, supplied = true): IngestedAckSource {
  return { supplied, ingested: ingestPublishPack(pack) };
}

/** The bounded acknowledgement inputs a test supplies (decision required; the rest default). */
export interface AckInputs {
  decision?: ReleaseAckDecision;
  reviewer?: ReleaseAckReviewer;
  note?: ReleaseAckNote;
  strict?: boolean;
}

/** Build a real {@link ReleaseAckResult} from a pack document + the acknowledgement inputs. */
export function makeAck(pack: unknown, inputs: AckInputs = {}): ReleaseAckResult {
  return buildAckResult(
    NOW,
    ingestAckFrom(pack),
    inputs.decision ?? "accepted",
    inputs.reviewer ?? "unknown",
    inputs.note ?? "none",
    inputs.strict ?? false,
  );
}

/** A provider that serves the pack document by any path (used by the run tests). */
export function makeProvider(pack: unknown, stdin = ""): ReleaseAckProvider {
  return {
    now: () => NOW,
    readFile: async () => (typeof pack === "string" ? pack : JSON.stringify(pack)),
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseAckArgs} that reference the pack by a placeholder path. */
export function makeArgs(over: Partial<ReleaseAckArgs> = {}): ReleaseAckArgs {
  return {
    format: "json",
    pretty: true,
    decision: "accepted",
    reviewer: "unknown",
    note: "none",
    strict: false,
    publishPackPath: "pack",
    ...over,
  };
}

/** Re-export the real publish-pack result type as a convenience alias. */
export type { ReleasePublishPackResult };
