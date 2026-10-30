// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS_ALLOWED,
  permissionsFromP,
} from "@/lib/jobs/pdf-permissions";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { openProtectedPdf } from "@/lib/pdf/security/protected-pdf";
import {
  RESTRICTED_FIXTURES,
  VIEW_ONLY_FIXTURE,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import {
  COMMENTS_NOT_ALLOWED,
  ProtectionBanner,
  allowedSentence,
} from "./protection-banner";

/**
 * The banner says only what THIS file's author grants — read from /P, the
 * same bits the handler enforces — and never promises a change the editor
 * cannot save under the author's encryption.
 */
describe("what the banner says the author allows", () => {
  it("fill + comment + print (the owner's sample, P = -1052)", () => {
    const p = permissionsFromP(-1052);
    expect(allowedSentence(p, true)).toBe(
      "Its author allows filling in the form, adding comments and printing, but not changes to the page content.",
    );
  });

  it("view and print only: no fill is offered", () => {
    // qpdf-r6-view-only.pdf: print, accessibility, high-quality print.
    const p = permissionsFromP(4 | 512 | 2048 | ~0xfff);
    expect(p.fillForms || p.annotate).toBe(false);
    expect(allowedSentence(p, false)).toBe(
      "Its author allows printing, but not changes to the page content.",
    );
  });

  it("nothing at all", () => {
    const p = permissionsFromP(~0xfff);
    expect(allowedSentence(p, false)).toBe(
      "Its author allows viewing it, but not changes of any kind.",
    );
  });

  it("a grant that includes changes is not called a ban on them", () => {
    const sentence = allowedSentence(ALL_PERMISSIONS_ALLOWED, true);
    expect(sentence).not.toMatch(/not changes/);
    expect(sentence).toMatch(/only fill in the form/);
    // Comments are granted too, and the editor saves them: said.
    expect(sentence).toMatch(/and add comments to it/);
  });

  it("changes granted WITHOUT comments: no comment is promised", () => {
    // P with modify (bit 4) and fill (bit 9) but not annotate (bit 6).
    const p = permissionsFromP(4 | 8 | 256 | ~0xfff);
    expect(p.modify && !p.annotate).toBe(true);
    expect(allowedSentence(p, true)).not.toMatch(/comment/);
  });
});

/**
 * The banner as the editor renders it, over the real fixtures' handlers. A
 * mark-up tool (Annotate PDF opens on Highlight) on a file whose author
 * withholds comments must say THAT is why its tools are locked, and still
 * offer the owner password.
 */
describe("the editor's banner says whether comments are allowed", () => {
  const render = async (file: string, surface: "editor" | "forms") => {
    const opened = await openProtectedPdf(readRestrictedFixture(file));
    if (opened.kind !== "opened") throw new Error(`${file}: ${opened.kind}`);
    return renderToStaticMarkup(
      createElement(ProtectionBanner, {
        protection: opened.pdf,
        unlocked: false,
        onUnlocked: () => {},
        surface,
      }),
    ).replace(/&#x27;/g, "'");
  };

  it("view only: comments refused by the author, the owner password offered", async () => {
    const html = await render(VIEW_ONLY_FIXTURE.file, "editor");
    expect(html).toContain('data-banner-comments="locked"');
    expect(html).toContain(COMMENTS_NOT_ALLOWED);
    expect(html).toContain("Owner password");
    expect(html).toContain("Unlock all tools");
  });

  it("positive control: comments granted (bit 6) are not called refused", async () => {
    const granted = RESTRICTED_FIXTURES[0]!;
    expect(granted.permissions).toContain(32);
    const html = await render(granted.file, "editor");
    expect(html).toContain("saved as comments");
    expect(html).not.toContain(COMMENTS_NOT_ALLOWED);
  });

  it("Fill Forms places no comments, so it says nothing about them", async () => {
    const html = await render(VIEW_ONLY_FIXTURE.file, "forms");
    expect(html).not.toContain(COMMENTS_NOT_ALLOWED);
  });
});
