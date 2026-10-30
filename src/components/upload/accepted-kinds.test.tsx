// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  formatForToken,
  formatOf,
  toolAcceptsFormat,
  type FileFormat,
} from "@/lib/intent/formats";
import { tools } from "@/lib/tools";
import { ACCEPTED_KINDS, acceptAttribute, acceptHint } from "./accepted-kinds";
import { Hero, UPLOAD_ANCHOR } from "@/components/sections/hero";

/**
 * The defect this file exists for did not live in either string. It lived in
 * the RELATIONSHIP between them: `UploadZone` (the home drop zone, since
 * replaced by the desk) shipped
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
        .split(/\s·\s/)
        .find((part) => part.includes(kind.label));
      expect(clause, `no clause names ${kind.label}`).toBeDefined();
      expect(clause).toContain(`${mb} MB`);
    }
  });
});

describe("the desk a visitor actually receives", () => {
  /**
   * Rendered, not imported. `acceptAttribute()` being correct proves nothing
   * about the component: the original bug WAS a correct helper's worth of
   * information sitting next to a literal default that ignored it.
   *
   * RETARGETED 2026-10-10 (WP-05), the property kept: this rendered
   * `UploadZone`, the home page's drop zone, which the desk replaced (the
   * zone had no other consumer and was deleted). The desk is rendered
   * through the hero that feeds it — the server computes the picker's
   * `accept` and its caption from ACCEPTED_KINDS and passes both — so the
   * chain under test is the one the home page ships. The caption is found
   * the way assistive technology finds it: as the picker's description.
   */
  function desk() {
    const { container } = render(<Hero />);
    const input = container.querySelector<HTMLInputElement>(
      `#${UPLOAD_ANCHOR} input[type="file"]:not([hidden])`,
    );
    expect(input, "the desk renders no picker").not.toBeNull();
    const described = input!.getAttribute("aria-describedby") ?? "";
    const caption = described ? document.getElementById(described) : null;
    expect(caption, "the picker has no caption describing it").not.toBeNull();
    return {
      accept: input!.getAttribute("accept") ?? "",
      caption: caption!.textContent ?? "",
    };
  }

  it("renders a file input that admits a Word document", () => {
    const { accept } = desk();
    expect(accept).toContain(".docx");
    expect(accept).toContain(".png");
    expect(accept).toContain("application/pdf");
  });

  it("is captioned by the generated hint, naming only kinds that same input admits", () => {
    const { accept, caption } = desk();
    expect(caption).toBe(acceptHint());
    const tokens = new Set(accept.split(","));
    const named = ACCEPTED_KINDS.filter((kind) => caption.includes(kind.label));
    // Health: the caption names kinds at all.
    expect(named.length).toBeGreaterThanOrEqual(3);
    for (const kind of named)
      expect(
        kind.accept.some((token) => tokens.has(token)),
        `caption names "${kind.label}" but the input admits none of ${kind.accept.join(",")}`,
      ).toBe(true);
  });
});

/**
 * The picker admits only what some tool opens.
 *
 * WHAT SHIPPED: the home picker's image kind listed `image/webp`, `image/gif`,
 * `.webp` and `.gif`. No tool takes either — both image tools embed PNG and
 * JPEG only, and say so ("Choose PNG or JPG images.") — so the picker invited
 * a file every tool on the site turns away. The caption read "images", which
 * hid it; the pair-checks above are about the caption and the picker agreeing
 * with each other, and they did.
 *
 * Read through the one recogniser (`formatOf` / `formatForToken`), each token
 * must name a format that some tool's `accept` row takes.
 */
function formatOfToken(token: string): FileFormat | null {
  return token.startsWith(".")
    ? formatForToken(token.slice(1))
    : formatOf({ name: "", type: token }).format;
}

function nobodyOpens(kinds: typeof ACCEPTED_KINDS): string[] {
  return kinds.flatMap((kind) =>
    kind.accept.filter((token) => {
      const format = formatOfToken(token);
      return !tools.some((t) => toolAcceptsFormat(t.accept, format));
    }),
  );
}

describe("the picker admits only what some tool opens", () => {
  it("reads every token as a format (health)", () => {
    const tokens = ACCEPTED_KINDS.flatMap((kind) => kind.accept);
    expect(tokens.length).toBeGreaterThanOrEqual(10);
    expect(tokens.filter((token) => formatOfToken(token) === null)).toEqual([]);
  });

  it("every token names a format some tool's accept row takes", () => {
    expect(nobodyOpens(ACCEPTED_KINDS)).toEqual([]);
  });

  it("positive control: an image kind listing formats nobody opens is caught on exactly those tokens", () => {
    // HISTORY: this was the kind that shipped until 2026-10-09 — PNG, JPEG,
    // WebP and GIF — caught on its four WebP and GIF tokens. On 2026-10-30
    // the image tools began decoding WebP and GIF, so that listing became
    // TRUE and could no longer be the control; HEIC and TIFF, which no tool
    // opens, are the same shape now.
    const shipped = [
      {
        label: "images",
        accept: [
          "image/png",
          "image/jpeg",
          "image/heic",
          "image/tiff",
          ".png",
          ".jpg",
          ".jpeg",
          ".heic",
          ".tiff",
        ],
        maxBytes: 1,
      },
    ];
    expect(nobodyOpens(shipped)).toEqual([
      "image/heic",
      "image/tiff",
      ".heic",
      ".tiff",
    ]);
  });
});
