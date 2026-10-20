// @vitest-environment node
/**
 * A guide's `updated` date cannot go stale.
 *
 * `updated` ships as the TechArticle `dateModified` and the sitemap `lastmod`
 * (guide-structured-data.test.tsx). The defect it guards: a guide's steps,
 * sections or FAQ change while `updated` keeps an older date, so crawlers and
 * readers are told the page is older than what they read. Before this file,
 * four guides already had exactly that, found by blame when it was written.
 *
 * The relationship pinned is CONTENT -> DATE, never a string. Each guide's
 * reader-visible content is hashed from the catalogue's own objects — every
 * field except `updated`, so a field added to `Guide` later is covered without
 * editing this file — and compared with a recorded table. The content is the
 * ASSEMBLED catalogue, so a changed constant that is interpolated into the
 * prose (a cap, a list of kept features) moves the hash too, exactly as it
 * moves what the reader gets.
 *
 * Any hash change is red. If `updated` was not moved past the recorded date
 * the message says to bump it; if it was, the message says to re-record —
 * otherwise one bump would license every later edit without another.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { guides } from "./catalog";
import type { Guide } from "./types";
import recorded from "./freshness.fixture.json";

interface FreshnessRecord {
  readonly contentHash: string;
  readonly updated: string;
}
type Table = Readonly<Record<string, FreshnessRecord>>;

/** Floor on the corpus: the guide count when this guard was written. */
const MIN_GUIDES = 22;

/** JSON with sorted object keys, so key order in the source is not content. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Everything a reader receives from `guide`, minus the date under test. */
function content(guide: Guide): Omit<Guide, "updated"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { updated, ...rest } = guide;
  return rest;
}

function contentHash(guide: Guide): string {
  return createHash("sha256").update(canonical(content(guide))).digest("hex");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function entryFor(guide: Guide): string {
  return `"${guide.slug}": { "contentHash": "${contentHash(guide)}", "updated": "${guide.updated}" }`;
}

/** Every reason the catalogue's dates disagree with its content. */
function freshnessFindings(
  list: readonly Guide[],
  table: Table,
  today: string,
): string[] {
  const findings: string[] = [];
  for (const guide of list) {
    const { slug, updated } = guide;
    if (!isValidIsoDate(updated)) {
      findings.push(`${slug}: updated "${updated}" is not a valid yyyy-mm-dd date`);
      continue;
    }
    if (updated > today) {
      findings.push(`${slug}: updated ${updated} is in the future (today is ${today})`);
    }
    if (isValidIsoDate(guide.published) && updated < guide.published) {
      findings.push(`${slug}: updated ${updated} is before published ${guide.published}`);
    }
    const rec = table[slug];
    if (!rec) {
      findings.push(`${slug}: not in freshness.fixture.json — add ${entryFor(guide)}`);
      continue;
    }
    const hash = contentHash(guide);
    if (hash !== rec.contentHash) {
      findings.push(
        updated > rec.updated
          ? `${slug}: content changed and updated was bumped — re-record ${entryFor(guide)}`
          : `${slug}: content changed but updated is still ${updated} (recorded ${rec.updated}) — bump updated to the date of this edit, then re-record the entry in freshness.fixture.json`,
      );
    } else if (updated !== rec.updated) {
      findings.push(
        `${slug}: updated moved to ${updated} with no content change (recorded ${rec.updated}) — re-record ${entryFor(guide)}`,
      );
    }
  }
  const live = new Set(list.map((g) => g.slug));
  for (const slug of Object.keys(table)) {
    if (!live.has(slug)) {
      findings.push(`${slug}: recorded in freshness.fixture.json but no such guide — remove the entry`);
    }
  }
  return findings;
}

const TODAY = new Date().toISOString().slice(0, 10);
const TABLE: Table = recorded;

describe("guide freshness: updated moves when the content does", () => {
  it("health: the corpus is the whole catalogue, and the table matches it both ways", () => {
    expect(guides.length).toBeGreaterThanOrEqual(MIN_GUIDES);
    expect(new Set(guides.map((g) => g.slug)).size).toBe(guides.length);
    expect(Object.keys(TABLE).sort()).toEqual(guides.map((g) => g.slug).sort());
  });

  it("health: the hashed content is the reader's content, and it tells guides apart", () => {
    const keys = Object.keys(content(guides[0]!));
    for (const k of ["title", "description", "intro", "steps", "sections", "faq"]) {
      expect(keys).toContain(k);
    }
    expect(keys).not.toContain("updated");
    expect(new Set(guides.map(contentHash)).size).toBe(guides.length);
  });

  it("every guide's updated date is valid, not in the future, and current with its content", () => {
    expect(freshnessFindings(guides, TABLE, TODAY)).toEqual([]);
  });

  describe("controls — the check reports what it claims to", () => {
    const base = guides[0]!;
    const table: Table = { [base.slug]: { contentHash: contentHash(base), updated: base.updated } };
    const check = (g: Guide) => freshnessFindings([g], table, base.updated);

    it("negative: the unchanged guide has no findings", () => {
      expect(check(base)).toEqual([]);
    });

    const edits: Record<string, (g: Guide) => Guide> = {
      "a step": (g) => ({ ...g, steps: [...g.steps.slice(0, -1), `${g.steps.at(-1)} Edited.`] }),
      "a section body": (g) => ({
        ...g,
        sections: g.sections.map((s, i) => (i === 0 ? { ...s, body: [...s.body, "Edited."] } : s)),
      }),
      "an FAQ answer": (g) => ({
        ...g,
        faq: g.faq.map((f, i) => (i === 0 ? { ...f, answer: `${f.answer} Edited.` } : f)),
      }),
    };
    for (const [what, edit] of Object.entries(edits)) {
      it(`positive: editing ${what} without bumping updated is reported`, () => {
        const findings = check(edit(base));
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatch(/content changed but updated is still/);
      });
    }

    it("positive: a bump with no re-record is still red, so one bump cannot license later edits", () => {
      const bumped = { ...edits["a step"]!(base), updated: "2099-01-01" };
      const findings = freshnessFindings([bumped], table, "2099-01-01");
      expect(findings).toEqual([expect.stringMatching(/re-record/)]);
    });

    it("positive: a future date and an invalid date are reported", () => {
      expect(check({ ...base, updated: "2999-12-31" })).toEqual(
        expect.arrayContaining([expect.stringMatching(/in the future/)]),
      );
      expect(check({ ...base, updated: "2026-02-30" })).toEqual([
        expect.stringMatching(/not a valid/),
      ]);
    });

    it("positive: a guide missing from the table, and a table entry with no guide, are reported", () => {
      expect(freshnessFindings([base], {}, base.updated)).toEqual([
        expect.stringMatching(/not in freshness\.fixture\.json/),
      ]);
      expect(freshnessFindings([], table, base.updated)).toEqual([
        expect.stringMatching(/no such guide/),
      ]);
    });
  });
});
