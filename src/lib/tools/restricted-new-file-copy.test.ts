// @native-canvas
import { describe, expect, it } from "vitest";
import { getPageCount } from "@/lib/pdf/engine";
import { PDF_RESTRICTED_MESSAGE } from "@/lib/pdf/encryption";
import {
  ASSEMBLE_COPY_FIXTURE,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { OWNER_PASSWORD_LABEL } from "@/lib/pdf/owner-password-copy";
import { openForCopy } from "@/lib/pdf/security/open-with-password";
import { getToolBySlug } from "./index";
import { pageFaq } from "./page-copy";

/**
 * Merge PDF and Extract Pages on a PDF that opens without a password but
 * carries its author's restrictions (audits merge-pdf#5, extract-pages#5).
 *
 * REWORKED 2026-11-17 (competitor-audit backlog #11), history kept. Until
 * then this said "Both still refuse it, and that is the owner's rule, not
 * a gap", and pinned the refusal as the end of the road: the page sent the
 * file to Unlock PDF, an upload. The owner's rule is unchanged and is what
 * this now pins — their output is a NEW file built by pdf-lib, which writes
 * no encryption, so the copy would carry the author's pages without the
 * author's restrictions, and so ONLY THE OWNER PASSWORD may make it. That
 * password is now typed under the refusal and checked in the browser
 * (`openForCopy`); the open password, or none, is still refused, for the
 * same reason the whole file used to be. (Rotate PDF can keep the
 * restrictions because it changes one key per page and saves an
 * incremental update onto the original; an extract written that way would
 * still hold every page it left out, in the original revision.)
 *
 * The composed chain is read here: the engine's refusal, the rule, and the
 * copy. Every tool × password kind × cipher is
 * `src/lib/pdf/security/owner-password-matrix.test.ts`.
 */
describe("a restricted PDF in a tool whose output is a new file", () => {
  it("the engine refuses it in the restrictions' words, not as password-protected", async () => {
    // Even under a grant to assemble pages: the copy could not keep it.
    await expect(
      getPageCount(readRestrictedFixture(ASSEMBLE_COPY_FIXTURE.file)),
    ).rejects.toThrow(PDF_RESTRICTED_MESSAGE);
  });

  it("the owner's rule: no password does not open it for a new file; the owner password does", async () => {
    const bytes = readRestrictedFixture(ASSEMBLE_COPY_FIXTURE.file);
    // Opens without a password, and its author grants assembly and copying
    // — still not enough for a copy that drops the rest.
    const none = await openForCopy(bytes, "");
    expect(none.kind).toBe("withheld");
    const owner = await openForCopy(bytes, ASSEMBLE_COPY_FIXTURE.owner);
    expect(owner.kind).toBe("opened");
    if (owner.kind === "opened") {
      expect(owner.as).toBe("owner");
      // The decrypted copy is what the new file is built from.
      expect(await getPageCount(owner.plain)).toBe(
        ASSEMBLE_COPY_FIXTURE.pageCount,
      );
    }
  });

  for (const slug of ["merge-pdf", "extract-pages"]) {
    it(`${slug}: the page says why, names the owner password, and says where to type it`, () => {
      const answers = pageFaq(getToolBySlug(slug)!).map((f) => f.answer);
      const why = answers.find((a) =>
        /new file that can't carry its author's encryption/.test(a),
      );
      expect(
        why,
        `${slug} never says why a restricted file is refused`,
      ).toBeTruthy();
      expect(why).toMatch(/owner \(permissions\) password/);
      // INVERTED 2026-11-17: this sentence ended "…can lift them, in Unlock
      // PDF." (merge) and sent the file to Unlock PDF for a decrypted copy
      // (extract). It now names the field the refusal carries.
      expect(why).toContain(`${OWNER_PASSWORD_LABEL} field`);
      expect(why).toMatch(/checked in your browser and never uploaded/);
      expect(why).not.toMatch(/can lift them, in Unlock PDF/);
    });
  }
});
