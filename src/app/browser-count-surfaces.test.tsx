// @vitest-environment jsdom
/**
 * The number a reader is actually handed, on every page that states one.
 *
 * `processing-split.test.ts` proves the catalogue is partitioned once and that
 * no module restates the rule. Both of those verify the author's artifact. The
 * defect they cannot see is the one that shipped: four pages, each deriving
 * correctly from its own private reading of the catalogue, disagreeing in the
 * browser. So this file renders them and reads the digits out of the output.
 *
 * WHAT IT PINS, and why each half is needed:
 *
 *  - **The right number is present.** Built from `processingSplit()` at
 *    assertion time, so a surface that stops tracking the catalogue fails here
 *    even if its own arithmetic is impeccable.
 *  - **The rival number is absent.** This is the half that would have caught
 *    what shipped. Both 29 and 30 were true; the failure was showing the
 *    capability count under a privacy sentence. `hasBrowserPath.length` is
 *    therefore forbidden on every privacy-framed surface, and the health check
 *    below fails loudly if the two counts ever coincide — at which point this
 *    assertion is vacuous and must not be trusted.
 *  - **The numbers a reader can add up, add up.** `/privacy` states both sides
 *    of its partition and the total. 29 + 21 = 50 is checkable arithmetic a
 *    visitor can do, and 30 + 21 = 51 is what they were given.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { tools } from "@/lib/tools";
import { processingSplit } from "@/lib/tools/processing-split";
import { supportedToolSlugs } from "@/lib/pdf/registry";
import { CtaSection } from "@/components/sections/cta-section";
import { StatsBand } from "@/components/sections/stats-band";
import { PricingSection } from "@/components/sections/pricing-section";
import PrivacyPage from "./privacy/page";
import StatusPage from "./status/page";

const split = processingSplit();
const NEVER = split.neverUploads.length;
const MAY = split.mayUpload.length;
/** The capability count — true, and not a privacy number. */
const HAS_PATH = split.hasBrowserPath.length;

/**
 * `/status` renders a live card; its in-browser paragraph does not depend on
 * the fetch, but an unstubbed one throws inside the effect.
 */
function stubWorkerStatus() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("not under test here")),
  );
}

/**
 * Numbers a reader reads AS A COUNT OF TOOLS.
 *
 * Not every integer on the page: the first version of this scanned them all
 * and reported `/privacy` as showing the capability count, because BENEERA
 * LLC's registered office is at 30 N Gould St. A right predicate over the
 * wrong set — the page really does render a 30 and it really is not a claim
 * about tools.
 *
 * So a number counts only when its neighbourhood is talking about tools. The
 * window is deliberately generous and the vocabulary deliberately broad,
 * because a miss here is a blind guard: the pairing below is what keeps that
 * honest — every surface must be found to state the RIGHT count by this same
 * extractor, so a window that stopped matching fails loudly rather than
 * silently reporting no offenders.
 */
const COUNT_VOCABULARY = /tool|browser|upload|device|worker|of our|of them/i;

function countClaims(node: HTMLElement): number[] {
  const text = (node.textContent ?? "").replace(/\s+/g, " ");
  const claims: number[] = [];
  for (const m of text.matchAll(/\d+/g)) {
    const i = m.index ?? 0;
    const around = text.slice(Math.max(0, i - 60), i + m[0].length + 60);
    if (COUNT_VOCABULARY.test(around)) claims.push(Number(m[0]));
  }
  return claims;
}

function renderSurface(ui: React.ReactElement): HTMLElement {
  stubWorkerStatus();
  return render(ui).container;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Every surface that states one of these counts, with the group it is entitled
 * to state. Rendered, not read from source.
 *
 * `/status` is the one that may legitimately differ: it counts never-upload
 * tools that ship a runner in THIS environment, so it is checked as a subset
 * with its own upper bound rather than for equality.
 */
interface Surface {
  name: string;
  render: () => HTMLElement;
}

/** Privacy-framed surfaces that state a COUNT. */
const COUNT_SURFACES: Surface[] = [
  { name: "homepage CTA", render: () => renderSurface(<CtaSection />) },
  { name: "homepage spec strip", render: () => renderSurface(<StatsBand />) },
  { name: "/privacy", render: () => renderSurface(<PrivacyPage />) },
];

/**
 * Every surface that PROMISES files never leave the device, counted or not.
 *
 * A superset, because the promise and the number are separate obligations and
 * the pricing card has only the first. It joined on 2026-08-22, found by
 * reading the built HTML rather than the source: its summary named "compress"
 * by hand inside "your files never leave it", so the browser-first tool
 * appeared under an absolute promise. It carries no digits at all, which is
 * exactly why every numeric instrument in this repository was blind to it.
 */
const PROMISE_SURFACES: Surface[] = [
  ...COUNT_SURFACES,
  { name: "homepage pricing", render: () => renderSurface(<PricingSection />) },
];

/**
 * Tools that may upload, which no "never leaves your device" sentence may name.
 *
 * The count guards above cannot see this: a sentence listing tools by name
 * carries no digits. Same defect, spelled in words.
 */
const NEVER_LEAVES = /never leaves? (?:your|it|the) ?(?:device|browser)?/i;

/** Escape a catalogue name for use inside a generated pattern. */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * How a sentence can name a tool: by its full name, or by the leading word a
 * marketing line reaches for ("compress", not "Compress PDF").
 *
 * The bare word only counts when it IDENTIFIES one tool, and that is derived
 * from the catalogue rather than judged: "Extract" leads three tools and
 * "PDF" leads eleven, so neither names anything in particular, while
 * "Compress" leads exactly one. Without this the guard flagged "PDF to Word"
 * on any page containing the word PDF — a right predicate over the wrong set,
 * for the second time in this file.
 */
const leadCount = new Map<string, number>();
for (const tool of tools) {
  const lead = tool.name.split(" ")[0]!.toLowerCase();
  leadCount.set(lead, (leadCount.get(lead) ?? 0) + 1);
}

function namesTool(sentence: string, name: string): boolean {
  if (new RegExp(`\\b${escape(name)}\\b`, "i").test(sentence)) return true;
  const lead = name.split(" ")[0]!;
  if (leadCount.get(lead.toLowerCase()) !== 1) return false;
  return new RegExp(`\\b${escape(lead)}\\b`, "i").test(sentence);
}

/**
 * The sentence a match sits in — from the previous full stop to the end of the
 * match.
 *
 * A fixed character window was too wide: 200 characters after "never leave it"
 * reached into the NEXT card, whose summary legitimately says "The AI tools …
 * run on secure workers". A promise is broken by what its own sentence claims.
 */
function sentenceEndingAt(text: string, end: number): string {
  const head = text.slice(0, end);
  return head.slice(head.lastIndexOf(".") + 1);
}

describe("the count a reader is shown", () => {
  it("health: the two answers are still different numbers", () => {
    // If no browser-first tool exists, `neverUploads` and `hasBrowserPath`
    // coincide and every "the rival is absent" assertion below becomes
    // vacuously true while reporting the strongest possible pass.
    expect(
      HAS_PATH,
      "no browser-first tool remains — the rival-number assertions are now vacuous and must be re-derived, not trusted",
    ).not.toBe(NEVER);
    expect(NEVER + MAY).toBe(tools.length);
    expect(COUNT_SURFACES.length).toBeGreaterThanOrEqual(3);
    expect(PROMISE_SURFACES.length).toBeGreaterThan(COUNT_SURFACES.length);
  });

  it.each(COUNT_SURFACES)(
    "$name states the never-upload count",
    ({ render: renderIt }) => {
      expect(countClaims(renderIt())).toContain(NEVER);
    },
  );

  it("no privacy-framed surface shows the capability count", () => {
    // Kept as one case rather than a parameterised one so the failure message
    // can name every offending surface at once, the way the split was actually
    // discovered — by reading two pages side by side.
    const offenders = COUNT_SURFACES.filter(({ render: renderIt }) => {
      const seen = countClaims(renderIt());
      cleanup();
      return seen.includes(HAS_PATH);
    }).map((s) => s.name);
    expect(
      offenders,
      `these render ${HAS_PATH} — the count of tools with an in-browser path — ` +
        `beside a promise about privacy, where the honest number is ${NEVER}`,
    ).toEqual([]);
  });

  it("no surface names an uploading tool inside a never-leaves promise", () => {
    // POSITIVE CONTROL, on the whole predicate rather than half of it: the
    // sentence that really shipped on the homepage at 60993e6 must still be
    // caught, both the promise and the tool it names. Two moving parts here —
    // the phrase pattern and the name matcher — and a pass means nothing
    // unless the pair can still fail on a real example.
    const SHIPPED =
      "Merge, split, compress, rotate, convert and more run entirely on your device — your files never leave it.";
    const hit = [...SHIPPED.matchAll(new RegExp(NEVER_LEAVES, "gi"))][0];
    expect(
      hit,
      "the never-leaves phrase no longer matches what shipped",
    ).toBeDefined();
    const shippedSentence = sentenceEndingAt(
      SHIPPED,
      (hit!.index ?? 0) + hit![0].length,
    );
    expect(
      split.mayUpload.filter((t) => namesTool(shippedSentence, t.name)),
      "the name matcher no longer sees `compress` in the sentence that shipped",
    ).not.toEqual([]);
    expect(split.mayUpload.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const surface of PROMISE_SURFACES) {
      const text = (surface.render().textContent ?? "").replace(/\s+/g, " ");
      cleanup();
      for (const m of text.matchAll(new RegExp(NEVER_LEAVES, "gi"))) {
        // THE SENTENCE, not the page. `/privacy` names Compress PDF on
        // purpose — to say it can upload — and separately promises elsewhere
        // that files never leave. Only naming it INSIDE the promise is a lie.
        const sentence = sentenceEndingAt(text, (m.index ?? 0) + m[0].length);
        for (const tool of split.mayUpload)
          if (namesTool(sentence, tool.name))
            offenders.push(
              `${surface.name}: "${tool.name}" in — ${sentence.trim()}`,
            );
      }
    }
    expect(
      offenders,
      `these promise files never leave the device and then name a tool that can upload:\n  ` +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("/privacy's own arithmetic closes", () => {
    const seen = countClaims(renderSurface(<PrivacyPage />));
    // Both sides of the partition and the total, all three visible to a reader
    // who wants to check the sum. This is the check that fails on 30 + 21 = 51.
    expect(seen).toContain(NEVER);
    expect(seen).toContain(MAY);
    expect(seen).toContain(tools.length);
    expect(NEVER + MAY).toBe(tools.length);
  });

  it("/privacy reconciles the browser-first tool by name", () => {
    const text = render(<PrivacyPage />).container.textContent ?? "";
    // The sentence that lets a reader who met the other number elsewhere
    // understand why the two differ, rather than concluding one page is wrong.
    for (const tool of split.browserFirst) expect(text).toContain(tool.name);
    expect(text).toContain(String(split.browserFirst.length));
  });

  it("/status states a count of never-upload tools it can actually run", () => {
    const seen = countClaims(renderSurface(<StatusPage />));
    // What the page should be showing, computed the way the page computes it:
    // never-upload tools that ship a runner in THIS environment.
    const runnable = split.neverUploads.filter((t) =>
      supportedToolSlugs.includes(t.slug),
    ).length;
    expect(seen, "/status states no tool count at all").not.toEqual([]);
    expect(seen).toContain(runnable);
    // It may report FEWER than the catalogue if a runner is withdrawn, never
    // more: anything above `neverUploads` means a tool that can upload has
    // been counted under "your files never leave the browser" — which is
    // exactly what including the hybrid tool would do.
    expect(
      seen.filter((n) => n > split.neverUploads.length),
      "a count on /status exceeds the number of tools that never upload",
    ).toEqual([]);
  });
});
