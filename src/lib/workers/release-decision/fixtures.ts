/**
 * Test-support builders for the release decision record tests (Phase 59).
 *
 * The record composes a `pdfxyz.release-publish-pack/1` + a `pdfxyz.release-ack/1`, so these helpers build REAL,
 * self-consistent publish packs of each posture (by REUSING the shipped Phase 57 pack builders, re-exported through
 * the Phase 58 ack fixtures) and REAL acknowledgements of them (by composing the shipped Phase 58 ack builder). A clean
 * document re-derives its own rollup, so this phase's trust boundaries mark it `usable`; the `tamper*` helpers flip a
 * recorded verdict so it no longer re-derives (a recognized-but-inconsistent document caught as `invalid`).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is
 * never imported by any runtime module.
 */

import {
  blockedPack,
  incompletePack,
  makeAck,
  notAPack,
  publishablePack,
  reviewPack,
  tamperedPack,
  type AckInputs,
} from "../release-ack/fixtures";
import type { ReleaseAckResult } from "../release-ack/types";
import type { ReleasePublishPackResult } from "../release-publish-pack/types";
import { buildDecisionResult } from "./build";
import {
  ingestAck,
  ingestPublishPack,
  type IngestedDecisionInputs,
} from "./ingest";
import type { ReleaseDecisionArgs } from "./args";
import type { ReleaseDecisionProvider } from "./run";
import type { ReleaseDecisionResult } from "./types";

/** A fixed clock the decision tests stamp with (deterministic). */
export const NOW = "2026-07-04T00:00:00.000Z";

// Re-export the real publish-pack posture builders so decision tests can pair a pack with an acknowledgement of it.
export {
  publishablePack,
  reviewPack,
  incompletePack,
  blockedPack,
  tamperedPack,
  notAPack,
};
export type { AckInputs, ReleasePublishPackResult, ReleaseAckResult };

/* ------------------------------------------------------------------ *
 *  Real acknowledgement builders (each self-consistent → usable)
 * ------------------------------------------------------------------ */

/** Build a REAL `pdfxyz.release-ack/1` acknowledging `pack` with the given decision inputs. */
export function ackFor(
  pack: unknown,
  inputs: AckInputs = {},
): ReleaseAckResult {
  return makeAck(pack, inputs);
}

/** A clean `acknowledged` ack: `accepted` over a publishable pack (no follow-up). */
export function acknowledgedAck(): ReleaseAckResult {
  return ackFor(publishablePack(), { decision: "accepted" });
}

/** An input that is NOT a recognized acknowledgement (⇒ an `unreadable` ack, `invalid`). */
export function notAnAck(): Record<string, unknown> {
  return {
    schema: "pdfxyz.something-else/1",
    note: "not a release acknowledgement",
  };
}

/* ------------------------------------------------------------------ *
 *  Tamper helper
 * ------------------------------------------------------------------ */

/** Flip an acknowledgement's recorded verdict so it no longer re-derives (a tamper ⇒ a `tampered` ack, `invalid`). */
export function tamperAck(ack: ReleaseAckResult): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(ack)) as Record<string, unknown> & {
    ack: { verdict: string };
  };
  clone.ack.verdict =
    ack.ack.verdict === "acknowledged" ? "rejected" : "acknowledged";
  return clone;
}

/* ------------------------------------------------------------------ *
 *  Decision input assembly (what build/reduce/rollup fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** Options for pairing a pack document with an acknowledgement document. */
export interface PairOptions {
  packSupplied?: boolean;
  ackSupplied?: boolean;
}

/** Reduce a pack document + an ack document to the {@link IngestedDecisionInputs} the fold consumes. */
export function ingestPair(
  packDoc: unknown,
  ackDoc: unknown,
  opts: PairOptions = {},
): IngestedDecisionInputs {
  return {
    pack: {
      supplied: opts.packSupplied ?? true,
      ingested: ingestPublishPack(packDoc),
    },
    ack: { supplied: opts.ackSupplied ?? true, ingested: ingestAck(ackDoc) },
  };
}

/** Build a real {@link ReleaseDecisionResult} from a pack document + an ack document. */
export function makeDecision(
  packDoc: unknown,
  ackDoc: unknown,
  opts: PairOptions & { strict?: boolean } = {},
): ReleaseDecisionResult {
  return buildDecisionResult(
    NOW,
    ingestPair(packDoc, ackDoc, opts),
    opts.strict ?? false,
  );
}

/** A provider that serves the pack by `packPath`, the ack by `ackPath`, and an optional stdin payload. */
export function makeProvider(opts: {
  pack?: unknown;
  ack?: unknown;
  stdin?: string;
  packPath?: string;
  ackPath?: string;
}): ReleaseDecisionProvider {
  const packPath = opts.packPath ?? "pack";
  const ackPath = opts.ackPath ?? "ack";
  const serialize = (v: unknown): string =>
    typeof v === "string" ? v : JSON.stringify(v ?? {});
  return {
    now: () => NOW,
    readFile: async (p: string) => {
      if (p === packPath) return serialize(opts.pack);
      if (p === ackPath) return serialize(opts.ack);
      throw new Error("no such file");
    },
    readStdin: async () => opts.stdin ?? "",
  };
}

/** Build {@link ReleaseDecisionArgs} that reference the pack + ack by placeholder paths. */
export function makeArgs(
  over: Partial<ReleaseDecisionArgs> = {},
): ReleaseDecisionArgs {
  return {
    format: "json",
    pretty: true,
    strict: false,
    publishPackPath: "pack",
    ackPath: "ack",
    ...over,
  };
}
