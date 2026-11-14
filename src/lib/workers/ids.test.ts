// @vitest-environment node
/**
 * An upload's id says whether it was declared a ZIP (`newFileId(true)`), so
 * the job route's `htmlZip` gate reads what the upload WAS (hostile review
 * round 3, 2026-11-14). The two shapes must never meet, and both must pass
 * every `f_…` id check the rest of the system applies.
 */
import { describe, expect, it } from "vitest";
import { isZipFileId, newFileId } from "./ids";
import { isValidFileId } from "@/lib/jobs/validation";

describe("an upload id that says it is a ZIP", () => {
  it("a ZIP's id is one, every other id is not, over many mints", () => {
    for (let i = 0; i < 2000; i += 1) {
      expect(isZipFileId(newFileId(true))).toBe(true);
      expect(isZipFileId(newFileId())).toBe(false);
    }
  });

  it("an ordinary id whose token happens to begin `zip-` is still not one: the length differs", () => {
    // A token is exactly 22 characters; a ZIP id has `zip-` AND 22 more.
    const unlucky = `f_zip-${"a".repeat(18)}`;
    expect(unlucky.length).toBe(newFileId().length);
    expect(isZipFileId(unlucky)).toBe(false);
  });

  it("both shapes pass the job API's own file id check", () => {
    expect(isValidFileId(newFileId(true))).toBe(true);
    expect(isValidFileId(newFileId())).toBe(true);
  });
});
