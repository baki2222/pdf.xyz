// @vitest-environment node
/**
 * The Guides band on a tool page, as a reader receives it.
 *
 * ── WHAT SHIPPED ────────────────────────────────────────────────────────────
 *
 * The band is discovered from each guide's `tools` field, which is right — but
 * a guide lists its NEIGHBOURS there too, and nothing distinguished a guide
 * that teaches this tool from one that merely mentions it. Audited at 67e8d0f:
 *
 *   /tools/word-to-pdf  → only "How to convert a PDF to an editable Word document"
 *   /tools/pdf-to-jpg   → only "How to convert JPG to PDF"
 *
 * Each page's one guide was the OPPOSITE task, presented as that tool's guide,
 * to readers and to crawlers alike. Every guide-catalogue test was green,
 * because every reference resolved; the defect was in which way it pointed.
 *
 * ── WHAT IS READ ────────────────────────────────────────────────────────────
 *
 * The rendered page, not `guidesForTool`: all fifty tool pages are rendered in
 * a fresh process (see src/tests/render-tool-pages.ts for why a subprocess)
 * and each band's cards are parsed out of the markup — the href each links and
 * the label it carries. The reverse-direction rule is written again HERE from
 * the tools' own `accept`/`outputs`, independently of the implementation, so
 * a wrong rule in the product is compared against a second statement of it
 * rather than against itself.
 *
 * Health checks bound the census in both directions, and the positive controls
 * run through the same parser: the raw relationship MUST contain reverse
 * guides (else the rule below is untested), and the rendered bands MUST carry
 * both labels (else the label check is vacuous).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { guides } from "./catalog";
import { reversesTool } from "./index";
import { getToolBySlug, tools } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";

const ROOT = process.cwd();
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const CENSUS = path.join(ROOT, "src", "tests", "render-tool-pages.ts");

const PRIMARY_LABEL = "Step-by-step guide";
const RELATED_LABEL = "Related guide";

interface Card {
  slug: string;
  label: string;
}

/** A format family: a ZIP is packaging, not a format, and JPEG is JPG. */
function formats(list: readonly string[]): Set<string> {
  return new Set(
    list.filter((f) => f !== "ZIP").map((f) => (f === "JPEG" ? "JPG" : f)),
  );
}
const meets = (a: Set<string>, b: Set<string>) => [...a].some((f) => b.has(f));

/**
 * `b` does `a`'s job backwards: both convert between disjoint formats, and
 * each one's output is the other's input. The independent statement.
 */
function reverses(a: Tool, b: Tool): boolean {
  if (a.slug === b.slug) return false;
  const [ai, ao, bi, bo] = [
    formats(a.accept),
    formats(a.outputs),
    formats(b.accept),
    formats(b.outputs),
  ];
  const converts = (i: Set<string>, o: Set<string>) => !meets(i, o);
  return converts(ai, ao) && converts(bi, bo) && meets(ai, bo) && meets(ao, bi);
}

/** The cards of the Guides band, in order, from a page's markup. */
function bandCards(markup: string): Card[] | null {
  const start = markup.indexOf(">Guides</h2>");
  if (start === -1) return null;
  const cards: Card[] = [];
  for (const m of markup
    .slice(start)
    .matchAll(/<a\b[^>]*href="\/guides\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const text = (m[2] ?? "").replace(/<[^>]*>/g, "\n");
    const label = [PRIMARY_LABEL, RELATED_LABEL].find((l) =>
      text.split("\n").some((line) => line.trim() === l),
    );
    cards.push({ slug: m[1] ?? "", label: label ?? "(none)" });
  }
  return cards;
}

const pages = new Map<string, string>();

beforeAll(() => {
  const stdout = execFileSync(process.execPath, [TSX_CLI, CENSUS, "--html"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  for (const [slug, html] of Object.entries(
    JSON.parse(stdout) as Record<string, string>,
  ))
    pages.set(slug, html);
}, 180_000);

describe("each tool page's Guides band points the right way", () => {
  it("the census and the rule are healthy", () => {
    expect(pages.size, "rendered pages").toBe(tools.length);
    const withBand = [...pages].filter(([, html]) => bandCards(html) !== null);
    // Every tool some guide lists could carry a band; there are 11+ guides
    // with up to three tools each, so a census with a handful is broken.
    expect(
      withBand.length,
      withBand.map(([s]) => s).join(", "),
    ).toBeGreaterThanOrEqual(guides.length);
    expect(withBand.length).toBeLessThan(tools.length);

    // Positive control for the rule: the RAW relationship (every guide that
    // lists a tool) contains reverse-direction guides. If it did not, the
    // assertion that the band holds none would be vacuously true.
    const rawReverse = tools.flatMap((tool) =>
      guides
        .filter((g) => g.tools.includes(tool.slug))
        .filter((g) => reverses(tool, getToolBySlug(g.tools[0]!)!))
        .map((g) => `${tool.slug} ← ${g.slug}`),
    );
    expect(rawReverse.length, rawReverse.join("\n")).toBeGreaterThanOrEqual(1);
    // And the rule itself, on the pairs it exists for.
    expect(
      reverses(getToolBySlug("word-to-pdf")!, getToolBySlug("pdf-to-word")!),
    ).toBe(true);
    expect(
      reverses(getToolBySlug("pdf-to-jpg")!, getToolBySlug("jpg-to-pdf")!),
    ).toBe(true);
    expect(
      reverses(getToolBySlug("merge-pdf")!, getToolBySlug("split-pdf")!),
    ).toBe(false);
  });

  it("no band links a guide for the reverse task", () => {
    const bad = [...pages].flatMap(([slug, html]) =>
      (bandCards(html) ?? [])
        .filter((card) => {
          const guide = guides.find((g) => g.slug === card.slug);
          const primary = guide && getToolBySlug(guide.tools[0]!);
          return primary && reverses(getToolBySlug(slug)!, primary);
        })
        .map((card) => `/tools/${slug} → /guides/${card.slug}`),
    );
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("each card says whether it teaches this tool, and those come first", () => {
    const wrong: string[] = [];
    const seen = new Set<string>();
    for (const [slug, html] of pages) {
      const cards = bandCards(html) ?? [];
      let relatedSeen = false;
      for (const card of cards) {
        const guide = guides.find((g) => g.slug === card.slug);
        if (!guide) {
          wrong.push(`/tools/${slug}: links unknown guide ${card.slug}`);
          continue;
        }
        if (!guide.tools.includes(slug))
          wrong.push(`/tools/${slug}: ${card.slug} does not list this tool`);
        const expected =
          guide.tools[0] === slug ? PRIMARY_LABEL : RELATED_LABEL;
        if (card.label !== expected)
          wrong.push(
            `/tools/${slug}: ${card.slug} labelled ${card.label}, expected ${expected}`,
          );
        seen.add(card.label);
        if (card.label === RELATED_LABEL) relatedSeen = true;
        else if (relatedSeen)
          wrong.push(
            `/tools/${slug}: ${card.slug} teaches this tool but sits below a related guide`,
          );
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
    // Positive control: both labels actually reach a page.
    expect([...seen].sort()).toEqual([RELATED_LABEL, PRIMARY_LABEL].sort());
  });

  it("the product's reverse rule agrees with this file's, on every pair", () => {
    const disagree: string[] = [];
    let reversePairs = 0;
    for (const a of tools)
      for (const b of tools) {
        const mine = reverses(a, b);
        if (mine) reversePairs += 1;
        if (reversesTool(a, b) !== mine)
          disagree.push(
            `${a.slug} / ${b.slug}: product ${!mine}, test ${mine}`,
          );
      }
    expect(disagree, disagree.join("\n")).toEqual([]);
    // Health: the converter pairs exist in both directions (word/pdf, jpg/pdf,
    // png/pdf, excel, powerpoint, text, markdown ...), and are not everything.
    expect(reversePairs).toBeGreaterThanOrEqual(6);
    expect(reversePairs).toBeLessThan(tools.length * 2);
  });

  it("every guide that teaches a tool reaches that tool's page", () => {
    // The other direction: dropping reverse guides must not drop anything
    // else. Each guide's primary tool shows it, and every non-reverse
    // neighbour does too.
    const missing: string[] = [];
    for (const guide of guides) {
      const primary = getToolBySlug(guide.tools[0]!)!;
      for (const slug of guide.tools) {
        const tool = getToolBySlug(slug)!;
        if (slug !== primary.slug && reverses(tool, primary)) continue;
        const cards = bandCards(pages.get(slug) ?? "") ?? [];
        if (!cards.some((c) => c.slug === guide.slug))
          missing.push(`/tools/${slug} does not link /guides/${guide.slug}`);
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });
});
