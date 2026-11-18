// @vitest-environment node
/**
 * What OCR PDF says about the restrictions on its searchable copy of a
 * restricted PDF (review finding, 2026-11-18, competitor-audit backlog #11),
 * tied to what the read-back holds.
 *
 * The copy is written AES-256, and one permission cannot be carried there:
 * accessibility extraction (/P bit 10). PDF 2.0 deprecates it and qpdf
 * ignores `--accessibility` for AES-256, so `restrictedLike` requires that
 * bit SET and holds only {@link OWNER_GRANT_KEPT_KEYS} switch for switch.
 * The shipped sentences said the copy "keeps the same restrictions", which
 * was false of an original that withheld accessibility extraction.
 *
 * So every sentence that says OCR or the searchable PDF keeps restrictions
 * must name each switch the read-back does NOT keep: DERIVED here from
 * `QPDF_GRANT_KEYS` minus `OWNER_GRANT_KEPT_KEYS`, so a change to the kept
 * set moves this test with it. The sentences are discovered by shape over
 * every walked copy file and every `src/lib` source, never named.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyFiles,
  flattenForPhraseSearch,
  libSourceFiles,
  withoutComments,
} from "@/lib/tools/copy-surface";
import { OWNER_GRANT_KEPT_KEYS } from "./ocr-owner-password";
import {
  QPDF_GRANT_KEYS,
  type QpdfGrant,
} from "./pdf-security/permission-bits";

/** A sentence that says OCR's copy keeps the author's restrictions. */
const KEEPS_RESTRICTIONS =
  /\b(?:searchable PDF|OCR)\b[^.]{0,160}\bkeeps?\b[^.]{0,80}\brestrictions\b/i;

/**
 * How a reader is told about each switch the copy does not keep. Total over
 * the grant's keys on purpose: a key newly left out of the kept set must
 * have words here before the sentences can name it.
 */
const NOT_KEPT_WORDS: Record<keyof QpdfGrant, RegExp | null> = {
  print: null,
  modify: null,
  copy: null,
  annotate: null,
  fillForms: null,
  accessibility: /\bexcept that screen readers are always allowed to read\b/i,
  assemble: null,
};

const ROOT = process.cwd();

/** U+2014, built from its code point (no raw non-ASCII in tests). */
const EM_DASH = String.fromCodePoint(0x2014);

function claimSentences(): { where: string; text: string }[] {
  const files = new Set(
    [...copyFiles(), ...libSourceFiles()].filter(
      (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
    ),
  );
  const found: { where: string; text: string }[] = [];
  for (const file of files) {
    const flat = flattenForPhraseSearch(
      withoutComments(readFileSync(file, "utf8")),
    );
    // Sentences, and string literals cut at their quotes, so a sentence is
    // never joined to the code around it.
    for (const sentence of flat.split(/(?<=[.!?])\s+|["`]/))
      if (KEEPS_RESTRICTIONS.test(sentence))
        found.push({
          where: path.relative(ROOT, file).split(path.sep).join("/"),
          text: sentence,
        });
  }
  return found;
}

const notKept = QPDF_GRANT_KEYS.filter(
  (key) => !(OWNER_GRANT_KEPT_KEYS as readonly string[]).includes(key),
);

/** Why `sentence` overclaims, or null. */
function overclaim(sentence: string): string | null {
  for (const key of notKept) {
    const words = NOT_KEPT_WORDS[key];
    if (!words) return `"${key}" is not kept and has no words to say so`;
    if (!words.test(sentence)) return `does not say "${key}" is not kept`;
  }
  // The mirror: a qualifier for a switch that IS kept is a new false claim.
  for (const key of OWNER_GRANT_KEPT_KEYS) {
    const words = NOT_KEPT_WORDS[key];
    if (words?.test(sentence)) return `says kept "${key}" is not kept`;
  }
  return null;
}

describe("OCR PDF's restriction claims name what the read-back does not keep", () => {
  it("health: the not-kept set is derived and non-empty today", () => {
    expect(notKept).toEqual(["accessibility"]);
    expect(OWNER_GRANT_KEPT_KEYS.length + notKept.length).toBe(
      QPDF_GRANT_KEYS.length,
    );
  });

  it("every shipped sentence that says the copy keeps restrictions names the exception (members printed, bounded)", () => {
    const found = claimSentences();
    const listing = found.map((f) => `${f.where}: ${f.text}`).join("\n");
    // The hint, the use case, the restricted refusal, the operations promise.
    expect(found.length, listing).toBeGreaterThanOrEqual(4);
    expect(found.length, listing).toBeLessThan(12);
    for (const where of [
      "src/components/tools/ocr-owner-password.tsx",
      "src/lib/tools/content/ocr-pdf.ts",
      "src/lib/workers/ocr-engine-errors.ts",
      "src/lib/workers/observability/snapshot.ts",
    ])
      expect(
        found.some((f) => f.where === where),
        `${where}\n${listing}`,
      ).toBe(true);
    const offenders = found
      .map((f) => ({ ...f, why: overclaim(f.text) }))
      .filter((f) => f.why !== null)
      .map((f) => `${f.where}: ${f.why}: ${f.text}`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("POSITIVE CONTROL: the sentences as first shipped are caught, by shape and by verdict", () => {
    for (const shipped of [
      "The searchable PDF keeps the same restrictions and the same owner password, and still opens without a password; a text file, if you ask for one, has no restrictions.",
      "The searchable PDF keeps the author's restrictions and the same owner password, and still opens without a password; a text file, if you ask for one, has no restrictions.",
      `Remove them with Unlock PDF and the owner (permissions) password that set them, then run OCR again ${EM_DASH} or, when this page shows an Owner password field for the file, type that password there and OCR keeps the restrictions on the result.`,
    ]) {
      expect(KEEPS_RESTRICTIONS.test(shipped), shipped).toBe(true);
      expect(overclaim(shipped), shipped).not.toBeNull();
    }
  });
});
