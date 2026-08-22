// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ACCEPTED_KINDS, acceptAttribute, acceptHint } from "./accepted-kinds";
import { UploadZone } from "./upload-zone";

/**
 * The defect this file exists for did not live in either string. It lived in
 * the RELATIONSHIP between them: `UploadZone` shipped
 * `accept = "application/pdf"` four lines above a hint reading "PDF, images,
 * Word, and more", and the homepage rendered both. Each was defensible alone,
 * so no assertion about either could fail.
 *
 * Therefore every check below is a check on the pair, and the corpus is
 * DERIVED from `ACCEPTED_KINDS` rather than typed — a list of expected labels
 * written here by hand would go stale in exactly the way the caption did.
 */
describe("the picker and the caption cannot disagree", () => {
  it("is a plausible list at all — the health check that makes the rest mean something", () => {
    // Every assertion below is a `for` over ACCEPTED_KINDS. An empty or
    // truncated list satisfies all of them vacuously and reports the strongest
    // possible pass, so bound the corpus before trusting any member of it.
    expect(ACCEPTED_KINDS.length).toBeGreaterThanOrEqual(5);
    expect(ACCEPTED_KINDS.length).toBeLessThanOrEqual(12);
    for (const kind of ACCEPTED_KINDS) {
      expect(kind.accept.length).toBeGreaterThan(0);
      expect(kind.maxBytes).toBeGreaterThan(0);
      expect(kind.label.trim()).not.toBe("");
    }
  });

  it("names every kind it admits — the picker cannot silently exceed the caption", () => {
    const hint = acceptHint();
    const unnamed = ACCEPTED_KINDS.filter(
      (kind) => !hint.includes(kind.label),
    ).map((kind) => kind.label);
    expect(unnamed).toEqual([]);
  });

  it("admits every kind it names — the caption cannot promise what the picker filters out", () => {
    const attribute = acceptAttribute();
    const tokens = new Set(attribute.split(","));
    const promised = ACCEPTED_KINDS.filter((kind) =>
      acceptHint().includes(kind.label),
    );
    const unadmitted = promised
      .filter((kind) => !kind.accept.some((token) => tokens.has(token)))
      .map((kind) => kind.label);
    expect(unadmitted).toEqual([]);
  });

  it("states each kind's OWN ceiling, not the largest one nearby", () => {
    const hint = acceptHint();
    for (const kind of ACCEPTED_KINDS) {
      const mb = Math.round(kind.maxBytes / (1024 * 1024));
      // The label and its figure must appear in the same clause, so a kind
      // cannot borrow a neighbour's larger number the way "Max 100 MB per
      // file" once covered a 2 MB text ceiling.
      const clause = hint
        .split(" · ")
        .find((part) => part.includes(kind.label));
      expect(clause, `no clause names ${kind.label}`).toBeDefined();
      expect(clause).toContain(`${mb} MB`);
    }
  });
});

describe("the zone a visitor actually receives", () => {
  /**
   * Rendered, not imported. `acceptAttribute()` being correct proves nothing
   * about the component: the original bug WAS a correct helper's worth of
   * information sitting next to a literal default that ignored it.
   */
  it("renders a file input that admits a Word document", () => {
    const { container } = render(<UploadZone />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const accept = input?.getAttribute("accept") ?? "";
    expect(accept).toContain(".docx");
    expect(accept).toContain(".png");
    expect(accept).toContain("application/pdf");
  });

  it("shows a caption naming only kinds that same input admits", () => {
    const { container } = render(<UploadZone />);
    const accept = new Set(
      (
        container.querySelector('input[type="file"]')?.getAttribute("accept") ??
        ""
      ).split(","),
    );
    for (const kind of ACCEPTED_KINDS) {
      const named = screen.queryAllByText(
        (_, node) => node?.textContent?.includes(kind.label) ?? false,
      );
      if (named.length === 0) continue;
      expect(
        kind.accept.some((token) => accept.has(token)),
        `caption names "${kind.label}" but the input admits none of ${kind.accept.join(",")}`,
      ).toBe(true);
    }
  });
});
