// @vitest-environment node
/**
 * The tie between the languages this product says it READS and the languages it
 * can WRITE.
 *
 * `OCR_LANGUAGES` populates the OCR menu and is the allowlist the job API
 * validates against, so every entry is a language a user can hand us a document
 * in. For each of them the product also offers to stamp a watermark, a page
 * number, a header, a note. Those two promises lived in different files with
 * nothing tying them together and they drifted completely: twenty-one languages
 * offered for reading, and the text tools could encode WinAnsi — so Chinese,
 * Japanese, Korean, Bengali, Hindi, Russian, Ukrainian, Thai and Arabic were
 * all read-only, and the tool that refused them named none of them.
 *
 * This file is the tie, and it is derived rather than typed: the corpus is
 * built FROM `OCR_LANGUAGES`, so adding a language to the OCR menu without
 * either shipping a face for it or recording it as a known gap fails here.
 *
 * BOTH DIRECTIONS, because a one-way list is decoration:
 *   - every advertised OCR language is either drawable or an ACKNOWLEDGED gap
 *     with a reason (no language may be silently missing);
 *   - every acknowledged gap must still be refused (no entry may linger after
 *     the capability arrives);
 *   - every shipped pack must be exercised by at least one language (no face
 *     may sit in the table drawing nothing).
 */
import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { OCR_LANGUAGES } from "@/lib/jobs/ocr";
import {
  FONT_PACKS,
  SUPPORTED_SCRIPTS,
  UNSUPPORTED_SCRIPTS,
  fontPackUrl,
  unsupportedScriptFor,
} from "./font-packs";
import {
  candidatePacks,
  loadCoverage,
  uncoveredCodePoints,
} from "./font-coverage";
import { installedPackageVersion, notoTtfPath } from "./noto-source";

/**
 * A real phrase per advertised OCR language — "confidential document", the
 * thing a user actually watermarks. Keyed by the Tesseract code so the corpus
 * is checked against `OCR_LANGUAGES` rather than living beside it: a language
 * added to the menu with no sample here fails the completeness test below.
 */
const SAMPLE: Record<string, string> = {
  eng: "Confidential document",
  spa: "Documento confidencial",
  fra: "Document confidentiel",
  deu: "Vertrauliches Dokument",
  ita: "Documento riservato",
  por: "Documento confidencial",
  nld: "Vertrouwelijk document",
  rus: "Секретный документ",
  ukr: "Конфіденційний документ",
  pol: "Dokument poufny — Łódź",
  swe: "Konfidentiellt dokument",
  tur: "Gizli belge — İstanbul",
  chi_sim: "机密文件",
  jpn: "秘密ひらがなカタカナ",
  kor: "기밀 문서",
  vie: "Tài liệu mật",
  ind: "Dokumen rahasia",
  tha: "เอกสารลับ",
  ara: "وثيقة سرية",
  hin: "गोपनीय दस्तावेज़",
  ben: "গোপনীয় নথি",
};

/**
 * Languages we read but still cannot WRITE, each with the property that has to
 * change before the entry may be removed.
 *
 * The reason names the capability, not the mechanism. "Until a Thai face is
 * shipped" would be satisfied by copying a file into `public/`; "until Thai
 * text renders correctly" is the thing a user cares about. Arabic's entry is
 * the sharper one: shipping Noto Sans Arabic would satisfy any font-shaped
 * exit condition and still produce a page that reads backwards, so the
 * condition is bidirectional layout.
 */
const KNOWN_GAPS: Record<string, string> = {
  tha: "no Thai face is shipped",
  ara: "right-to-left layout is not implemented, so an Arabic line would render reversed",
};

describe("what we read and what we can draw", () => {
  it("has a sample for every advertised OCR language", () => {
    // Health check first: a corpus that quietly shrank would let every
    // assertion below pass vacuously.
    expect(OCR_LANGUAGES.length).toBeGreaterThanOrEqual(21);
    const missing = OCR_LANGUAGES.map((l) => l.code).filter(
      (code) => !SAMPLE[code],
    );
    expect(
      missing,
      "these OCR languages have no sample phrase, so nothing here checks whether the text tools can write them",
    ).toEqual([]);
  });

  it("can draw every advertised OCR language that is not an acknowledged gap", async () => {
    const coverage = await loadCoverage();
    const undrawable: string[] = [];
    for (const { code, label } of OCR_LANGUAGES) {
      if (KNOWN_GAPS[code]) continue;
      const text = SAMPLE[code]!;
      const packs = candidatePacks(coverage, text);
      if (packs.length === 0) {
        undrawable.push(
          `${label} (${code}): "${text}" — uncovered code points ${uncoveredCodePoints(
            coverage,
            text,
          )
            .map((cp) => `U+${cp.toString(16).toUpperCase()}`)
            .join(", ")}`,
        );
      }
    }
    expect(
      undrawable,
      "the product offers OCR in these languages and cannot put one character of them into a watermark, page number, header or note",
    ).toEqual([]);
  });

  it("still refuses every acknowledged gap, so a stale entry cannot linger", async () => {
    const coverage = await loadCoverage();
    const nowDrawable: string[] = [];
    for (const [code, reason] of Object.entries(KNOWN_GAPS)) {
      const text = SAMPLE[code]!;
      if (candidatePacks(coverage, text).length > 0) {
        nowDrawable.push(`${code} is drawable but still listed as: ${reason}`);
      }
    }
    expect(
      nowDrawable,
      "a face for this script has arrived — delete the KNOWN_GAPS entry and the matching UNSUPPORTED_SCRIPTS row, or the refusal will keep claiming something false",
    ).toEqual([]);
  });

  it("names a script and a reason for every acknowledged gap", async () => {
    for (const code of Object.keys(KNOWN_GAPS)) {
      const cp = [...SAMPLE[code]!].find(
        (ch) => unsupportedScriptFor(ch.codePointAt(0)!) !== null,
      );
      expect(
        cp,
        `nothing in UNSUPPORTED_SCRIPTS matches ${code}, so its refusal would say "unsupported characters" with no script named`,
      ).toBeDefined();
    }
  });

  it("exercises every shipped face — no pack draws nothing", async () => {
    const coverage = await loadCoverage();
    const used = new Set<string>();
    for (const { code } of OCR_LANGUAGES) {
      const [first] = candidatePacks(coverage, SAMPLE[code]!);
      if (first) used.add(first.id);
    }
    const idle = FONT_PACKS.map((p) => p.id).filter((id) => !used.has(id));
    expect(
      idle,
      "these faces are downloaded by nothing the product advertises — either a language is missing from the corpus or the face is dead weight in public/",
    ).toEqual([]);
  });

  it("routes each CJK language to its own regional face", async () => {
    // The three CJK faces overlap: Noto Sans SC carries 100% of CJK Unified,
    // JP 61%, KR 39%. "Any face that can draw it" would send Chinese through
    // the Japanese file, which is both a wasted download and the wrong
    // regional glyph shapes for a reader who would notice.
    const coverage = await loadCoverage();
    expect(candidatePacks(coverage, SAMPLE.chi_sim!)[0]!.id).toBe("chinese");
    expect(candidatePacks(coverage, SAMPLE.jpn!)[0]!.id).toBe("japanese");
    expect(candidatePacks(coverage, SAMPLE.kor!)[0]!.id).toBe("korean");
    // Bengali and Latin must never pull a multi-megabyte CJK face.
    expect(candidatePacks(coverage, SAMPLE.ben!)[0]!.id).toBe("bengali");
    expect(candidatePacks(coverage, SAMPLE.rus!)[0]!.id).toBe("latin");
    expect(candidatePacks(coverage, SAMPLE.hin!)[0]!.id).toBe("latin");
  });
});

describe("the pack table describes the files that actually ship", () => {
  it("records the installed package version for each face", () => {
    for (const pack of FONT_PACKS) {
      expect(
        installedPackageVersion(pack),
        `${pack.pkg} moved underneath the version stamped into ${fontPackUrl(pack)}`,
      ).toBe(pack.version);
    }
  });

  it("records each face's real size, which is what a user downloads", () => {
    // A number in a table has no relationships to constrain it, so it is
    // compared against a second, independent source: the file itself.
    for (const pack of FONT_PACKS) {
      expect(statSync(notoTtfPath(pack)).size, `${pack.file}`).toBe(pack.bytes);
    }
  });

  it("orders CJK faces after the small ones, so ties break toward the cheap download", () => {
    const bySize = [...FONT_PACKS].sort((a, b) => a.bytes - b.bytes);
    expect(FONT_PACKS.map((p) => p.id)).toEqual(bySize.map((p) => p.id));
  });

  it("serves every face the copy step wrote, at the URL the browser asks for", () => {
    // The chain a fetch depends on: FONT_PACKS -> copy-noto-fonts.ts ->
    // public/. Reading the table alone would not notice the copy step never
    // running; this walks to the file.
    const missing = FONT_PACKS.filter(
      (pack) =>
        !existsSync(path.join(process.cwd(), "public", fontPackUrl(pack))),
    ).map((pack) => fontPackUrl(pack));
    expect(
      missing,
      "these faces are not in public/ — run `pnpm fonts:copy` (dev and build do it automatically). Without them every non-Latin stamp fails with a fetch error",
    ).toEqual([]);
  });

  it("names a reason for every script it refuses", () => {
    for (const entry of UNSUPPORTED_SCRIPTS) {
      expect(entry.ranges.length, entry.name).toBeGreaterThan(0);
      expect(entry.reason.length, entry.name).toBeGreaterThan(20);
    }
    // And the "what we DO draw" half is non-empty, or the refusal reads as
    // though the product supports nothing.
    expect(SUPPORTED_SCRIPTS.length).toBeGreaterThan(5);
  });

  it("does not claim a script is unsupported when a face already draws it", async () => {
    // The reverse direction of the ban list: an UNSUPPORTED_SCRIPTS row whose
    // range is already covered would refuse text we can render, and the
    // refusal would carry a written argument for why that was fine.
    const coverage = await loadCoverage();
    const wrong: string[] = [];
    for (const entry of UNSUPPORTED_SCRIPTS) {
      for (const [lo, hi] of entry.ranges) {
        const probes = [lo, Math.floor((lo + hi) / 2), hi];
        for (const cp of probes) {
          if (cp > 0x10ffff) continue;
          const text = String.fromCodePoint(cp);
          if (uncoveredCodePoints(coverage, text).length === 0) {
            wrong.push(
              `${entry.name} claims U+${cp.toString(16).toUpperCase()} is unsupported, but a shipped face has it`,
            );
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
