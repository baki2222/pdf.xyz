// @vitest-environment node
/**
 * Reducer + coherence cross-check proofs for the release decision record ledger (Phase 59). Pins the bounded source
 * summaries and the `match` / `mismatch` / `unknown` cross-check between the acknowledgement's recorded source-pack
 * summary and the SUPPLIED pack — the Phase 59 value-add over each document's own self-consistency.
 */

import { describe, expect, it } from "vitest";
import { ingestAck, ingestPublishPack } from "./ingest";
import {
  computeCrossCheck,
  reduceAckSummary,
  reducePackSummary,
  sourceState,
} from "./reduce";
import {
  ackFor,
  acknowledgedAck,
  notAPack,
  publishablePack,
  reviewPack,
  tamperedPack,
} from "./fixtures";

const packSummary = (doc: unknown, supplied = true) =>
  reducePackSummary(supplied, ingestPublishPack(doc));
const ackSummary = (doc: unknown, supplied = true) =>
  reduceAckSummary(supplied, ingestAck(doc));

describe("sourceState", () => {
  it("maps supplied/recognized/usable flags to the coverage state", () => {
    expect(sourceState(false, false, false)).toBe("absent");
    expect(sourceState(true, false, false)).toBe("unreadable");
    expect(sourceState(true, true, false)).toBe("tampered");
    expect(sourceState(true, true, true)).toBe("usable");
  });
});

describe("reduce summaries", () => {
  it("reduces a usable publish pack to its bounded posture", () => {
    const s = packSummary(publishablePack());
    expect(s).toMatchObject({
      state: "usable",
      verdict: "publishable",
      disclosure: "share-safe",
    });
    expect(s.sourcesUsable).toBeGreaterThan(0);
  });

  it("reduces a usable acknowledgement to its bounded posture + recorded pack summary", () => {
    const s = ackSummary(
      ackFor(publishablePack(), {
        decision: "accepted",
        note: "operational-follow-up",
      }),
    );
    expect(s).toMatchObject({
      state: "usable",
      ackVerdict: "acknowledged-with-followup",
      decision: "accepted",
      note: "operational-follow-up",
      recordedPackVerdict: "publishable",
      recordedPackState: "usable",
    });
  });

  it("a not-supplied document is absent with null posture", () => {
    expect(packSummary(undefined, false)).toMatchObject({
      state: "absent",
      verdict: null,
      sourcesSupplied: 0,
    });
    expect(ackSummary(undefined, false)).toMatchObject({
      state: "absent",
      ackVerdict: null,
      decision: null,
    });
  });
});

describe("computeCrossCheck", () => {
  it("match: the ack acknowledged the same publishable pack that is supplied", () => {
    const cc = computeCrossCheck(
      packSummary(publishablePack()),
      ackSummary(acknowledgedAck()),
    );
    expect(cc.status).toBe("match");
  });

  it("mismatch: the ack acknowledged a different (review) pack than the supplied (publishable) one", () => {
    const cc = computeCrossCheck(
      packSummary(publishablePack()),
      ackSummary(ackFor(reviewPack(), { decision: "accepted" })),
    );
    expect(cc.status).toBe("mismatch");
  });

  it("mismatch: the ack acknowledged an unreadable pack, so its recorded source is not usable", () => {
    const cc = computeCrossCheck(
      packSummary(publishablePack()),
      ackSummary(ackFor(notAPack(), { decision: "accepted" })),
    );
    expect(cc.status).toBe("mismatch");
  });

  it("unknown: a tampered pack can't be compared", () => {
    const cc = computeCrossCheck(
      packSummary(tamperedPack()),
      ackSummary(acknowledgedAck()),
    );
    expect(cc.status).toBe("unknown");
  });

  it("unknown: an unreadable acknowledgement can't be compared", () => {
    const cc = computeCrossCheck(
      packSummary(publishablePack()),
      ackSummary(notAPack()),
    );
    expect(cc.status).toBe("unknown");
  });
});
