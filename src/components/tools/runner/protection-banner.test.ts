// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS_ALLOWED,
  permissionsFromP,
} from "@/lib/jobs/pdf-permissions";
import { allowedSentence } from "./protection-banner";

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
  });
});
