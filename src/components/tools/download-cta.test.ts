// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The download/open CTA lives in ONE place: `DownloadCta` in
 * `tools/runner/runner-kit.tsx`.
 *
 * This is #47's defect-shape on the next verb. The run trigger was fixed in
 * #46 and the fix reached 28 of 45 sites, because the other 17 had each pasted
 * their own copy of the markup — so #47 collapsed them into `WorkerRunButton`
 * and `run-trigger-focus.test.ts` now scans source for the paste. The download
 * CTA had lived the identical history and nobody had looked: one class string
 * pasted verbatim across twelve worker panels, twice in the compress runner,
 * and once as an anchor in the OCR panel. The gradient spelling it wore before
 * the redesign died in PR #110; the PASTE survived the restyle. 14 sites in 13
 * files, deleted together when `DownloadCta` was extracted.
 *
 * TWO CHECKS, BECAUSE THE SET MUST BE DERIVED TWICE (CLAUDE.md rule 4):
 *  - a STRING scan for the pasted fingerprint, which catches a sixteenth copy
 *    of today's spelling; and
 *  - a BEHAVIOUR scan — every file that performs a download action must style
 *    it through a shared component — which catches tomorrow's spelling, the
 *    one the string scan by construction cannot know.
 *
 * WOULD THIS BE GREEN IF THE FIX WERE ABSENT? No — measured, not assumed: run
 * against the pre-extraction tree (each file read back out of git with
 * `git show HEAD:<path>`, never a checkout) the fingerprint check reports 13
 * offending files and the behaviour check independently reports the same 13,
 * via the paste carrying neither `DownloadCta` nor `buttonVariants`.
 */

const ROOTS = [
  path.join(process.cwd(), "src", "components"),
  path.join(process.cwd(), "src", "app"),
];

/** The one legal home for the CTA's markup. */
const CTA_OWNER = path.join("tools", "runner", "runner-kit.tsx");

/**
 * The pasted CTA's class fingerprint: the inverted-ground tone joined to its
 * own layout in a single literal. `buttonVariants` composes the same classes
 * from SEPARATE strings at runtime, so this literal only ever appears in
 * source where someone pasted the markup by hand.
 */
const CTA_MARKUP = /hover:bg-invert\/85 inline-flex/;

/**
 * Files that perform a download action but style it as something OTHER than
 * the primary CTA, each with the reason and a fingerprint that must still be
 * present — a stale exception fails instead of sitting ready to excuse the
 * next paste (the LIGHT_SURFACES pattern from muted-text-contrast.test.ts).
 *
 * chat-with-pdf: each exchange in the transcript can carry a per-message
 * artifact; a full-width primary CTA per bubble would make every answer
 * shout, so it renders a quiet outline chip. That is a different ROLE, not a
 * hand-rolled copy of this one.
 */
const STYLED_AS_SOMETHING_ELSE: { file: string; fingerprint: RegExp }[] = [
  {
    file: path.join("tools", "chat-with-pdf-worker-panel.tsx"),
    fingerprint: /border-line text-muted[^"]*rounded-full/,
  },
];

function sourceFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
        ? [full]
        : [];
    });
  return ROOTS.flatMap(walk);
}

function relative(file: string): string {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

describe("the download CTA has one home", () => {
  const files = sourceFiles();

  it("still sees the corpus it polices", () => {
    // Health check: the walk found the surfaces, and the owner still carries
    // the fingerprint. `[] ⊆ X` is vacuously true; this is the positive
    // control that keeps the two checks below from passing blind.
    expect(files.length).toBeGreaterThanOrEqual(80);
    const owner = files.find((f) => f.endsWith(CTA_OWNER));
    expect(owner, "runner-kit.tsx left the walked roots").toBeDefined();
    expect(
      CTA_MARKUP.test(readFileSync(owner!, "utf8")),
      "the fingerprint no longer matches the component it was taken from — " +
        "restyling DownloadCta means re-deriving this fingerprint, not deleting it",
    ).toBe(true);
  });

  it("keeps today's spelling of the CTA markup out of every other file", () => {
    const offenders = files
      .filter((file) => !file.endsWith(CTA_OWNER))
      .filter((file) => CTA_MARKUP.test(readFileSync(file, "utf8")))
      .map(relative);

    expect(
      offenders,
      `these files hand-roll the download/open CTA instead of using <DownloadCta>:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every file that performs a download styles it through a shared component", () => {
    // Derived from BEHAVIOUR, so a re-spelled paste cannot walk past the
    // string check above: any file that calls downloadBytes() or renders a
    // `download=` anchor must reach the markup through DownloadCta or
    // buttonVariants — or be an enumerated, still-true exception.
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const performsDownload =
        src.includes("downloadBytes(") || /\sdownload=\{/.test(src);
      if (!performsDownload) continue;
      if (file.endsWith(CTA_OWNER)) continue;
      if (src.includes("DownloadCta") || src.includes("buttonVariants"))
        continue;
      if (
        STYLED_AS_SOMETHING_ELSE.some(
          (entry) => file.endsWith(entry.file) && entry.fingerprint.test(src),
        )
      )
        continue;
      offenders.push(relative(file));
    }

    expect(
      offenders,
      `these files perform a download but style its trigger by hand:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("exempts only styled-as-something-else sites that genuinely exist", () => {
    for (const entry of STYLED_AS_SOMETHING_ELSE) {
      const file = files.find((f) => f.endsWith(entry.file));
      expect(file, `${entry.file} no longer exists`).toBeDefined();
      expect(
        entry.fingerprint.test(readFileSync(file!, "utf8")),
        `${entry.file} no longer matches its exception fingerprint — the ` +
          `exception is stale; re-derive or remove it`,
      ).toBe(true);
    }
  });
});
