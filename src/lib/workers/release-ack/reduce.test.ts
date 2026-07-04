import { describe, expect, it } from "vitest";
import { buildAcknowledgement, packState, reduceAckSource } from "./reduce";
import { ingestAckFrom, notAPack, publishablePack, tamperedPack } from "./fixtures";

describe("packState", () => {
  it("maps supplied/recognized/usable flags to the coverage state", () => {
    expect(packState(false, false, false)).toBe("absent");
    expect(packState(true, false, false)).toBe("unreadable");
    expect(packState(true, true, false)).toBe("tampered");
    expect(packState(true, true, true)).toBe("usable");
  });
});

describe("reduceAckSource", () => {
  it("a usable pack surfaces its trusted verdict / disclosure / counts", () => {
    const s = reduceAckSource(ingestAckFrom(publishablePack()));
    expect(s).toMatchObject({
      state: "usable",
      recognized: true,
      usable: true,
      packVerdict: "publishable",
      disclosure: "share-safe",
      sourcesSupplied: 5,
      sourcesUsable: 5,
    });
  });

  it("a tampered pack is `tampered` and surfaces only the untrusted claim", () => {
    const s = reduceAckSource(ingestAckFrom(tamperedPack()));
    expect(s.state).toBe("tampered");
    expect(s.usable).toBe(false);
    expect(s.packVerdict).toBe("blocked"); // the claim
  });

  it("an unreadable pack surfaces nothing (null verdict, zero counts)", () => {
    const s = reduceAckSource(ingestAckFrom(notAPack()));
    expect(s.state).toBe("unreadable");
    expect(s.packVerdict).toBeNull();
    expect(s.disclosure).toBeNull();
    expect(s.sourcesSupplied).toBe(0);
  });

  it("a not-supplied pack is `absent`", () => {
    const s = reduceAckSource(ingestAckFrom(undefined, false));
    expect(s.state).toBe("absent");
    expect(s.packVerdict).toBeNull();
  });
});

describe("buildAcknowledgement", () => {
  it("records the decision / reviewer / note / strict and derives hasFollowup", () => {
    expect(buildAcknowledgement("accepted", "internal-approver", "none", false)).toEqual({
      decision: "accepted",
      reviewer: "internal-approver",
      note: "none",
      strict: false,
      hasFollowup: false,
    });
    expect(buildAcknowledgement("accepted", "unknown", "legal-review", false).hasFollowup).toBe(true);
    expect(buildAcknowledgement("accepted-with-notes", "unknown", "none", false).hasFollowup).toBe(true);
  });
});
