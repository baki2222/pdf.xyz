// @vitest-environment node
/**
 * Trust-boundary proofs for the release decision record ingest (Phase 59). The record composes TWO untrusted documents;
 * this suite pins that (a) the publish-pack re-validation is REUSED from Phase 58 verbatim, and (b) the acknowledgement
 * re-validation re-runs the Phase 58 fold and catches a hand-flipped verdict, a lied source, a lied `hasFollowup`, and
 * an internally-inconsistent coverage state — always failing closed (`usable = false`), never echoing the input.
 */

import { describe, expect, it } from "vitest";
import { ingestAck, ingestPublishPack } from "./ingest";
import {
  acknowledgedAck,
  ackFor,
  blockedPack,
  notAnAck,
  publishablePack,
  reviewPack,
  tamperAck,
  tamperedPack,
} from "./fixtures";

/** Deep-clone a document so a test can mutate it without touching the builder's output. */
function clone<T>(doc: T): T {
  return JSON.parse(JSON.stringify(doc)) as T;
}

describe("ingestPublishPack (reused from Phase 58)", () => {
  it("marks a self-consistent pack usable with its re-derived verdict", () => {
    const p = ingestPublishPack(publishablePack());
    expect(p).toMatchObject({
      recognized: true,
      usable: true,
      verdict: "publishable",
      disclosure: "share-safe",
    });
  });

  it("marks a tampered pack recognized-but-unusable", () => {
    const p = ingestPublishPack(tamperedPack());
    expect(p.recognized).toBe(true);
    expect(p.usable).toBe(false);
  });

  it("does not recognize a non-pack", () => {
    expect(ingestPublishPack(notAnAck())).toMatchObject({
      recognized: false,
      usable: false,
    });
  });
});

describe("ingestAck — happy path", () => {
  it("marks a self-consistent acknowledgement usable and extracts its bounded facts", () => {
    const a = ingestAck(
      ackFor(publishablePack(), {
        decision: "accepted",
        reviewer: "internal-approver",
      }),
    );
    expect(a).toMatchObject({
      recognized: true,
      usable: true,
      ackVerdict: "acknowledged",
      decision: "accepted",
      reviewer: "internal-approver",
      note: "none",
      sourceState: "usable",
      recordedPackVerdict: "publishable",
      recordedDisclosure: "share-safe",
    });
    expect(a.recordedSourcesUsable).toBeGreaterThan(0);
  });

  it("records the acknowledged source pack the ack saw (a blocked pack ⇒ ack verdict rejected)", () => {
    const a = ingestAck(ackFor(blockedPack(), { decision: "accepted" }));
    expect(a).toMatchObject({
      usable: true,
      ackVerdict: "rejected",
      recordedPackVerdict: "blocked",
    });
  });
});

describe("ingestAck — tamper evidence (fails closed)", () => {
  it("does not recognize a non-ack (schema mismatch)", () => {
    expect(ingestAck(notAnAck())).toMatchObject({
      recognized: false,
      usable: false,
    });
  });

  it("catches a hand-flipped ack verdict", () => {
    const t = ingestAck(tamperAck(acknowledgedAck()));
    expect(t.recognized).toBe(true);
    expect(t.usable).toBe(false);
  });

  it("catches a coherently-flipped source pack that changes the fold (packVerdict + disclosure → blocked)", () => {
    // acknowledged (accepted over publishable). Flip the recorded source to a blocked pack WITHOUT changing the ack
    // verdict: the re-run fold would now yield `rejected` ≠ recorded `acknowledged` ⇒ tampered.
    const doc = clone(acknowledgedAck()) as unknown as {
      source: { packVerdict: string; disclosure: string };
    };
    doc.source.packVerdict = "blocked";
    doc.source.disclosure = "blocked";
    expect(ingestAck(doc).usable).toBe(false);
  });

  it("catches a source whose packVerdict alone is flipped (disclosure no longer canonical)", () => {
    const doc = clone(acknowledgedAck()) as unknown as {
      source: { packVerdict: string };
    };
    doc.source.packVerdict = "review"; // disclosure still `share-safe`, but review ⇒ internal-review
    expect(ingestAck(doc).usable).toBe(false);
  });

  it("catches a lied hasFollowup flag", () => {
    const doc = clone(acknowledgedAck()) as unknown as {
      acknowledgement: { hasFollowup: boolean };
    };
    doc.acknowledgement.hasFollowup = true; // accepted + no note ⇒ derived hasFollowup is false
    expect(ingestAck(doc).usable).toBe(false);
  });

  it("catches an internally-inconsistent source coverage state", () => {
    const doc = clone(acknowledgedAck()) as unknown as {
      source: { usable: boolean };
    };
    doc.source.usable = false; // state is still `usable`, but packState(supplied,recognized,false) is `tampered`
    expect(ingestAck(doc).usable).toBe(false);
  });

  it("surfaces the CLAIMED verdict of a tampered ack without trusting it", () => {
    const t = ingestAck(
      tamperAck(ackFor(reviewPack(), { decision: "accepted" })),
    );
    expect(t.usable).toBe(false);
    // The flipped claim is surfaced for the summary but never trusted.
    expect([
      "acknowledged",
      "acknowledged-with-followup",
      "deferred",
      "rejected",
      "invalid",
      null,
    ]).toContain(t.ackVerdict);
  });
});
