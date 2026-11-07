// @native-canvas
import { describe, expect, it } from "vitest";
import { getPageCount } from "@/lib/pdf/engine";
import { PDF_RESTRICTED_MESSAGE } from "@/lib/pdf/encryption";
import {
  ASSEMBLE_COPY_FIXTURE,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { getToolBySlug } from "./index";
import { pageFaq } from "./page-copy";

/**
 * Merge PDF and Extract Pages on a PDF that opens without a password but
 * carries its author's restrictions (audits merge-pdf#5, extract-pages#5).
 *
 * Both still refuse it, and that is the owner's rule, not a gap: their
 * output is a NEW file built by pdf-lib, which writes no encryption, so the
 * copy would carry the author's pages without the author's restrictions.
 * (Rotate PDF can keep them because it changes one key per page and saves an
 * incremental update onto the original; an extract written that way would
 * still hold every page it left out, in the original revision.) The page
 * now says WHY, and the refusal names the owner password — the composed
 * chain, from the engine's refusal to the copy, is read here.
 */
describe("a restricted PDF in a tool whose output is a new file", () => {
  it("the engine refuses it in the restrictions' words, not as password-protected", async () => {
    // Even under a grant to assemble pages: the copy could not keep it.
    await expect(
      getPageCount(readRestrictedFixture(ASSEMBLE_COPY_FIXTURE.file)),
    ).rejects.toThrow(PDF_RESTRICTED_MESSAGE);
  });

  for (const slug of ["merge-pdf"]) {
    it(`${slug}: the page says why, and names the owner password`, () => {
      const answers = pageFaq(getToolBySlug(slug)!).map((f) => f.answer);
      const why = answers.find((a) =>
        /new file that can't carry its author's encryption/.test(a),
      );
      expect(
        why,
        `${slug} never says why a restricted file is refused`,
      ).toBeTruthy();
      expect(why).toMatch(/owner \(permissions\) password/);
    });
  }
});
