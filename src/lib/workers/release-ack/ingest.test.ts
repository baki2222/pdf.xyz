import { describe, expect, it } from "vitest";
import { ingestPublishPack, UNRECOGNIZED_PUBLISH_PACK } from "./ingest";
import { blockedPack, incompletePack, publishablePack, reviewPack } from "./fixtures";
import type { ReleasePublishPackResult } from "../release-publish-pack/types";

/** Deep-clone a real pack so a test can tamper one recorded field. */
function clone(pack: ReleasePublishPackResult): Record<string, unknown> {
  return JSON.parse(JSON.stringify(pack)) as Record<string, unknown>;
}

describe("ingestPublishPack — recognizes + trusts a self-consistent pack", () => {
  it("a clean publishable pack is recognized, usable, and surfaces its verdict / disclosure / counts", () => {
    const ing = ingestPublishPack(publishablePack());
    expect(ing).toEqual({
      recognized: true,
      usable: true,
      verdict: "publishable",
      disclosure: "share-safe",
      sourcesSupplied: 5,
      sourcesUsable: 5,
    });
  });

  it("re-derives each posture's own verdict (review / incomplete / blocked)", () => {
    expect(ingestPublishPack(reviewPack())).toMatchObject({ usable: true, verdict: "review", disclosure: "internal-review" });
    expect(ingestPublishPack(incompletePack())).toMatchObject({ usable: true, verdict: "incomplete" });
    expect(ingestPublishPack(blockedPack())).toMatchObject({ usable: true, verdict: "blocked", disclosure: "blocked" });
  });
});

describe("ingestPublishPack — an unrecognized input", () => {
  it("a non-object is unrecognized", () => {
    for (const bad of [null, undefined, 42, "x", [], true]) {
      expect(ingestPublishPack(bad)).toEqual(UNRECOGNIZED_PUBLISH_PACK);
    }
  });

  it("a wrong-schema object is unrecognized", () => {
    expect(ingestPublishPack({ schema: "pdfxyz.release-governance/1" })).toEqual(UNRECOGNIZED_PUBLISH_PACK);
  });
});

describe("ingestPublishPack — catches tampers (recognized but not self-consistent)", () => {
  it("a hand-flipped pack.verdict does NOT re-derive → recognized, not usable, surfaces the CLAIM", () => {
    const doc = clone(publishablePack());
    (doc.pack as { verdict: string }).verdict = "blocked";
    const ing = ingestPublishPack(doc);
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(false);
    expect(ing.verdict).toBe("blocked"); // the untrusted claim is surfaced
  });

  it("a flipped disclosure does NOT re-derive", () => {
    const doc = clone(publishablePack());
    (doc.pack as { disclosure: string }).disclosure = "blocked";
    expect(ingestPublishPack(doc).usable).toBe(false);
  });

  it("a lied coverage count does NOT re-derive", () => {
    const doc = clone(publishablePack());
    (doc.coverage as { sourcesUsable: number }).sourcesUsable = 4;
    expect(ingestPublishPack(doc).usable).toBe(false);
  });

  it("a smuggled off-enum source verdict is rejected as a tamper (never surfaced)", () => {
    const doc = clone(publishablePack());
    (doc.sources as Array<{ verdict: string }>)[0]!.verdict = "s3://leak/verdict";
    const ing = ingestPublishPack(doc);
    expect(ing.usable).toBe(false);
    // The pack-level claim is still the (untrusted) recorded pack verdict, not the smuggled source string.
    expect(ing.verdict).toBe("publishable");
  });

  it("a shuffled / off-position source id is a tamper", () => {
    const doc = clone(publishablePack());
    const sources = doc.sources as Array<{ id: string }>;
    [sources[0]!.id, sources[1]!.id] = [sources[1]!.id, sources[0]!.id];
    expect(ingestPublishPack(doc).usable).toBe(false);
  });

  it("a source whose state contradicts its own flags is a tamper", () => {
    const doc = clone(publishablePack());
    (doc.sources as Array<{ state: string }>)[0]!.state = "absent"; // but supplied/recognized/usable say usable
    expect(ingestPublishPack(doc).usable).toBe(false);
  });

  it("a corrupt rollup (off-enum reason id) is a tamper", () => {
    const doc = clone(reviewPack());
    (doc.pack as { reasons: string[] }).reasons = ["not-a-real-reason"];
    expect(ingestPublishPack(doc).usable).toBe(false);
  });

  it("a missing sources array is a tamper (but recognized, surfacing the claim)", () => {
    const doc = clone(publishablePack());
    delete doc.sources;
    const ing = ingestPublishPack(doc);
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(false);
    expect(ing.verdict).toBe("publishable");
  });

  it("a wrong source count (fewer than five) is a tamper", () => {
    const doc = clone(publishablePack());
    (doc.sources as unknown[]).pop();
    expect(ingestPublishPack(doc).usable).toBe(false);
  });
});
