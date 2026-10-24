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
  MONOSPACE_CLAIMS,
  SUPPORTED_SCRIPTS,
  UNSUPPORTED_SCRIPTS,
  fontPackUrl,
  unsupportedScriptFor,
  type StandardFace,
} from "./font-packs";
import {
  candidatePacks,
  loadCoverage,
  packCovers,
  uncoveredCodePoints,
} from "./font-coverage";
import { installedPackageVersion, notoTtfPath } from "./noto-source";
import { copyNotoFonts } from "../../../scripts/copy-noto-fonts";
import { monospaceClaimMembers } from "@/tests/unicode-fonts";

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
/**
 * Every face a caller can ask `embedDrawingFont` for. Written as a record so
 * the COMPILER checks it is complete: a StandardFace missing here is a type
 * error, not a face silently left out of the walks below.
 */
const EVERY_FACE = Object.keys({
  sans: true,
  "sans-bold": true,
  "sans-oblique": true,
  mono: true,
  "serif-italic": true,
  "sans-bold-oblique": true,
  serif: true,
  "serif-bold": true,
  "serif-bold-italic": true,
  "mono-bold": true,
  "mono-oblique": true,
  "mono-bold-oblique": true,
} satisfies Record<StandardFace, true>) as StandardFace[];

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
    // Every face a caller can ask for, not just the default: the monospace
    // pack is only ever chosen for "mono", so a sans-only walk would call it
    // dead weight. The record makes the list complete by type — a new
    // StandardFace that is not added here fails to compile.
    const coverage = await loadCoverage();
    const used = new Set<string>();
    for (const face of EVERY_FACE) {
      for (const { code } of OCR_LANGUAGES) {
        const [first] = candidatePacks(coverage, SAMPLE[code]!, face);
        if (first) used.add(first.id);
      }
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

  it("offers the monospace pack only to 'mono', and first there whenever it can draw the text", async () => {
    const coverage = await loadCoverage();
    const monospace = FONT_PACKS.filter((p) => p.role === "monospace");
    // Health check: the property below is vacuous without a monospace pack.
    expect(monospace.length).toBe(1);
    const leaked: string[] = [];
    const outranked: string[] = [];
    let drawnMono = 0;
    for (const face of EVERY_FACE) {
      for (const { code } of OCR_LANGUAGES) {
        const text = SAMPLE[code]!;
        const packs = candidatePacks(coverage, text, face);
        const offered = packs.some((p) => p.role === "monospace");
        if (face !== "mono") {
          if (offered) leaked.push(`${face}: ${code}`);
          continue;
        }
        if (!offered) continue;
        drawnMono++;
        if (packs[0]!.role !== "monospace") outranked.push(code);
      }
    }
    expect(
      leaked,
      "a watermark, header or page number would be set in the monospace face",
    ).toEqual([]);
    expect(
      outranked,
      "a proportional face was preferred for text the monospace face can draw",
    ).toEqual([]);
    // Positive control: Latin-script, Cyrillic and Vietnamese samples are all
    // inside the monospace face, so the preference is actually exercised.
    expect(drawnMono).toBeGreaterThanOrEqual(10);
  });

  it("the scripts the monospace pack names are ones it draws, for real sentences", async () => {
    // The tile USED to be built from `scripts` ("Latin and Cyrillic text …"),
    // and this test was offered as its guard. It could not be one: it reads
    // the OCR sample sentences, which contain no ⇒ and no pinyin ǐ, and the
    // face draws neither. The tile is now built from MONOSPACE_CLAIMS and
    // guarded by the next test; this one only says what it can — every OCR
    // sample written in a named script (by the Unicode Script property of the
    // sample itself) is drawn by the monospace pack.
    const coverage = await loadCoverage();
    const mono = FONT_PACKS.find((p) => p.role === "monospace")!;
    expect(mono.scripts.length).toBeGreaterThan(0);
    for (const script of mono.scripts) {
      const letter = new RegExp(`\\p{Script=${script}}`, "u");
      const samples = Object.entries(SAMPLE).filter(([, text]) =>
        [...text].every((ch) => !/\p{L}/u.test(ch) || letter.test(ch)),
      );
      expect(
        samples.length,
        `no sample is written in ${script}`,
      ).toBeGreaterThan(0);
      for (const [code, text] of samples) {
        const [first] = candidatePacks(coverage, text, "mono");
        expect(first?.id, `${script} (${code}): "${text}"`).toBe(mono.id);
      }
    }
  });

  it("every character the Text to PDF tile promises is set in the monospace face", async () => {
    // Each MONOSPACE_CLAIMS label is expanded from a definition that exists
    // without our font (a Windows code page, a Unicode block, the literal
    // characters) and EVERY member must route to the monospace pack — one at
    // a time, so a miss names itself, and all at once, as a document would.
    const coverage = await loadCoverage();
    expect(MONOSPACE_CLAIMS.length).toBeGreaterThan(0);
    const missed: Record<string, string> = {};
    const all: string[] = [];
    for (const claim of MONOSPACE_CLAIMS) {
      const members = monospaceClaimMembers(claim);
      expect(
        members.length,
        `"${claim.label}" expands to nothing`,
      ).toBeGreaterThan(0);
      all.push(...members);
      const wrong = members.filter(
        (ch) => candidatePacks(coverage, ch, "mono")[0]?.role !== "monospace",
      );
      if (wrong.length > 0) missed[claim.label] = wrong.join("");
      if ("characters" in claim.members) {
        // A literal claim is exactly what the reader sees printed.
        expect(claim.label.replace(/\s+/g, "")).toBe(claim.members.characters);
      }
    }
    expect(
      missed,
      "the tile names these, and they are set proportionally",
    ).toEqual({});
    expect(candidatePacks(coverage, all.join(""), "mono")[0]?.role).toBe(
      "monospace",
    );
    // Bounded both ways: five code pages and a block are hundreds of
    // characters (529 distinct on 2026-09-27); a decoder that returned nothing
    // would make every assertion above vacuous.
    const distinct = new Set(all).size;
    expect(distinct).toBeGreaterThan(400);
    expect(distinct).toBeLessThan(2000);
  });

  it("drops only the soft hyphen from the claimed code pages, by name", async () => {
    // `monospaceClaimMembers` keeps graphic characters. What that filter
    // removes from a code page, other than C0/C1 controls and undefined bytes,
    // is printed here rather than trusted: it is U+00AD SOFT HYPHEN, which
    // Geist Mono does not carry, so a note with a soft hyphen AND an arrow is
    // set proportionally. The tile's second sentence ("other characters … can
    // move the whole document") covers it; this keeps the exclusion visible.
    const coverage = await loadCoverage();
    const mono = FONT_PACKS.find((p) => p.role === "monospace")!;
    const dropped = new Set<string>();
    for (const claim of MONOSPACE_CLAIMS) {
      if (!("codePages" in claim.members)) continue;
      const kept = new Set(monospaceClaimMembers(claim));
      for (const label of claim.members.codePages) {
        const decoded = new TextDecoder(label).decode(
          Uint8Array.from({ length: 256 }, (_, i) => i),
        );
        for (const ch of decoded) {
          if (kept.has(ch) || /\p{Cc}/u.test(ch)) continue;
          if (ch.codePointAt(0) === 0xfffd) continue;
          dropped.add(ch);
        }
      }
    }
    expect([...dropped].map((ch) => ch.codePointAt(0))).toEqual([0xad]);
    expect(packCovers(coverage, mono, 0xad)).toBe(false);
  });

  it("refusals and the 'what we draw' list are about scripts, and the monospace pack adds none", async () => {
    const coverage = await loadCoverage();
    const scriptPacks = FONT_PACKS.filter((p) => p.role === "script");
    expect(SUPPORTED_SCRIPTS).toEqual([
      ...new Set(scriptPacks.flatMap((p) => p.scripts)),
    ]);
    // Every code point only the monospace pack draws is still refused to a
    // face that did not ask for monospace — derived from the coverage tables.
    const mono = FONT_PACKS.find((p) => p.role === "monospace")!;
    const monoOnly: number[] = [];
    for (let cp = 0x20; cp <= 0xffff; cp++) {
      if (!packCovers(coverage, mono, cp)) continue;
      if (scriptPacks.some((p) => packCovers(coverage, p, cp))) continue;
      monoOnly.push(cp);
    }
    for (const cp of monoOnly) {
      const text = String.fromCodePoint(cp);
      expect(uncoveredCodePoints(coverage, text, "sans"), text).toEqual([cp]);
      expect(uncoveredCodePoints(coverage, text, "mono"), text).toEqual([]);
    }
    // Bound it both ways: 17 such code points (↵ ⌫ ␋ …) on 2026-09-27. None
    // would make the loop vacuous; thousands would mean a broken table.
    expect(monoOnly.length).toBeGreaterThan(0);
    expect(monoOnly.length).toBeLessThan(200);
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

  /**
   * The chain a fetch depends on: FONT_PACKS -> copy-noto-fonts.ts -> public/.
   *
   * THIS RUNS THE COPY STEP RATHER THAN ASSERTING SOMEBODY ELSE DID. The first
   * spelling checked `existsSync(public/<fontPackUrl>)` and was red on every CI
   * run of PR #130 — `pnpm test` runs BEFORE `pnpm build`, and only `dev` and
   * `build` invoke the copy step, so the files were legitimately absent. That
   * red said something true about the workflow's ORDER and nothing at all about
   * the product; a developer running `npx vitest` from a fresh clone got it
   * too. Calling `copyNotoFonts()` makes the guard order-independent and moves
   * it onto the question worth asking.
   *
   * That question is BOTH DIRECTIONS of one claim: the path the copy step
   * WRITES and the URL `unicode-font.ts` FETCHES are the same string. They are
   * computed independently — `path.join("public", "fonts", version, file)` on
   * one side, a template literal on the other — so this is a real tie and not a
   * restatement. A face written somewhere the browser never asks for, or asked
   * for at a URL nothing writes, fails here.
   *
   * ── AND IT IS STILL THE AUTHOR'S ARTIFACT ───────────────────────────────────
   *
   * What this proves is that bytes reached a directory on the machine running
   * the tests. It does NOT prove they are SERVED. `next.config.mjs` could stop
   * emitting `public/`, a header rule could break the immutable caching, a
   * rewrite could shadow `/fonts/*` — and every assertion here would stay
   * green while every Bengali watermark in production failed with a fetch
   * error. The reader's artifact is the HTTP response, and the only thing that
   * reads it is `e2e/unicode-fonts.spec.ts`, which runs against a real server
   * in the Playwright CI job (which does build first) and requires a 200 of the
   * right length starting with a TrueType signature.
   */
  it("the copy step writes exactly the URLs the browser is sent to", () => {
    const written = copyNotoFonts();

    // Health check: bound the corpus's own size before comparing sets, because
    // two empty lists are equal and that would be the strongest possible pass.
    expect(FONT_PACKS.length).toBeGreaterThanOrEqual(5);
    expect(written.length).toBe(FONT_PACKS.length);

    // Direction 1: every URL the fetch path builds was written by the copy step.
    // Direction 2: every path the copy step wrote is one the fetch path builds.
    // `toEqual` on two sorted arrays is both at once, and names the offenders.
    expect(
      written.map((face) => face.servedAt).sort(),
      "the copy step's destinations and fontPackUrl() have drifted apart — one of them is now writing or fetching a path the other never mentions",
    ).toEqual(FONT_PACKS.map(fontPackUrl).sort());

    // And walk to the file, at the URL, with the size the table records — the
    // copy step's own return value is its report on itself, so it cannot be the
    // only witness.
    const missing: string[] = [];
    for (const pack of FONT_PACKS) {
      const onDisk = path.join(process.cwd(), "public", fontPackUrl(pack));
      if (!existsSync(onDisk)) {
        missing.push(fontPackUrl(pack));
        continue;
      }
      expect(statSync(onDisk).size, fontPackUrl(pack)).toBe(pack.bytes);
    }
    expect(
      missing,
      "these faces are not in public/ after the copy step ran. Without them every non-Latin stamp fails with a fetch error",
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
