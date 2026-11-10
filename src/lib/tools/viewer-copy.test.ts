import { describe, expect, it } from "vitest";
import content from "./content/pdf-viewer";
import { getToolBySlug, tools } from "@/lib/tools";
import { CONTINUE_SHOWN, continueTargetsFor } from "@/lib/intent/next-steps";
import { RUNNER_FILE_CEILINGS } from "./file-ceilings";
import {
  VIEWER_LIVE_PAGES,
  VIEWER_MAX_MATCHES,
  VIEWER_MAX_TEXT_ITEMS,
  VIEWER_PRINT_DPI,
  VIEWER_PRINT_MAX_PAGES,
  VIEWER_PRINT_MAX_PIXELS,
  VIEWER_PRINT_MAX_SIDE,
  printPlan,
} from "@/lib/pdf/viewer-geometry";
import {
  VIEWER_IMAGE_NOTE,
  VIEWER_LABELS,
  VIEWER_ZOOM_RANGE,
  viewerPrintNote,
} from "@/lib/pdf/viewer-copy";

/**
 * The PDF Viewer's page states its limits from the constants that enforce
 * them, so a changed cap changes the sentence. Each figure is looked for as
 * the constant renders it, never as a typed number (a typed "500" would
 * stay green while the cap moved — the mutation run of 2026-11-10 changed
 * VIEWER_MAX_MATCHES and read this file still passing, with the FAQ saying
 * the new number).
 */
const text = [
  ...content.intro,
  ...content.useCases.flatMap((u) => [u.title, u.body]),
  ...content.steps.flatMap((s) => [s.title, s.body]),
  ...content.faqs.flatMap((f) => [f.q, f.a]),
].join(" ");
const n = (x: number) => x.toLocaleString("en-US");

/**
 * Claims the viewer's page must never make, each with the sentences it
 * must catch (synonyms included: the ban that let "you have used your"
 * past a ban on "you've used your") and true sentences it must spare.
 */
const BANS: {
  claim: string;
  pattern: RegExp;
  catches: string[];
  spares: string[];
}[] = [
  {
    claim: "works without the network",
    pattern:
      /\boffline\b|without (?:an? )?(?:internet|network)(?: connection)?|no (?:internet|network) (?:connection )?(?:needed|required)/i,
    catches: [
      "The viewer works offline.",
      "It works without an internet connection.",
      "No internet connection needed.",
    ],
    spares: ["The file is read on your device and is not uploaded."],
  },
  {
    claim: "never contacts the server",
    pattern:
      /\bnever (?:contacts|calls|reaches|talks to|fetches)\b|nothing (?:is )?(?:ever )?(?:fetched|requested|downloaded|loaded) from|no (?:network )?requests?\b/i,
    catches: [
      "The viewer never contacts our server.",
      "Nothing is ever fetched from our server.",
      "It makes no network requests.",
    ],
    spares: ["The file is not sent to pdf.xyz."],
  },
  {
    claim: "an exact or vector print",
    pattern:
      /\bvectors?\b|exact(?:ly)? (?:print|as)|prints? exactly|pixel[- ]perfect/i,
    catches: [
      "Print is an exact print of the file.",
      "Pages print exactly as they appear.",
      "It prints vectors.",
      "A vector print.",
      "Pixel-perfect printing.",
    ],
    spares: ["Print draws each page as an image."],
  },
  {
    claim: "a page count it can open",
    pattern:
      /up to [\d,]+ pages|[\d,]+[- ]page (?:documents?|files?|PDFs?)|unlimited pages|no page limit|any number of pages/i,
    catches: [
      "Opens PDFs of up to 5,000 pages.",
      "It handles 5,000-page documents.",
      "Unlimited pages.",
      "There is no page limit.",
    ],
    spares: ["One print sends at most 50 pages."],
  },
  {
    claim: "every match highlighted (search stops at its cap)",
    pattern: /\bevery match\b|\ball (?:the )?matches\b/i,
    catches: [
      "Every match on every page is highlighted.",
      "Search highlights every match.",
      "All the matches are highlighted.",
    ],
    spares: ["Its matches are highlighted, up to the first 500."],
  },
];

describe("PDF Viewer copy states the numbers it enforces", () => {
  it("the size ceiling, the live pages, the zoom range, the search and text caps, the print caps", () => {
    expect(text).toContain(
      `${Math.round(RUNNER_FILE_CEILINGS.view / (1024 * 1024))} MB`,
    );
    expect(text).toContain(`at most ${VIEWER_LIVE_PAGES} at a time`);
    expect(text).toContain(VIEWER_ZOOM_RANGE);
    expect(text).toContain(`at most ${n(VIEWER_MAX_MATCHES)} matches`);
    expect(text).toContain(`more than ${n(VIEWER_MAX_TEXT_ITEMS)} pieces`);
    expect(text).toContain(`${VIEWER_PRINT_DPI} dpi`);
    expect(text).toContain(`at most ${VIEWER_PRINT_MAX_PAGES} pages`);
  });

  it("names the controls by the labels the viewer draws", () => {
    for (const label of [
      VIEWER_LABELS.previous,
      VIEWER_LABELS.next,
      VIEWER_LABELS.thumbnails,
      VIEWER_LABELS.bookmarks,
      VIEWER_LABELS.zoomIn,
      VIEWER_LABELS.zoomOut,
      VIEWER_LABELS.fitWidth,
      VIEWER_LABELS.fitPage,
      VIEWER_LABELS.rotate,
      VIEWER_LABELS.search,
      VIEWER_LABELS.print,
      VIEWER_LABELS.download,
    ]) {
      expect(text, label).toContain(label);
    }
  });

  it("never claims what it does not do (each ban against its corpus, both ways)", () => {
    // History (review, 2026-11-10): the bans were two bare regexes with no
    // sentence showing what each catches, and "It works without an
    // internet connection.", "Pages print exactly as they appear.",
    // "Nothing is ever fetched from our server.", "prints vectors" and
    // "handles 5,000-page documents" all walked past them.
    const offenders: string[] = [];
    for (const ban of BANS) {
      for (const sentence of ban.catches) {
        if (!ban.pattern.test(sentence))
          offenders.push(`HOLE ${ban.claim}: ${sentence}`);
      }
      for (const sentence of ban.spares) {
        if (ban.pattern.test(sentence))
          offenders.push(`OVERBROAD ${ban.claim}: ${sentence}`);
      }
      // Every pattern catches something, and every ban spares something
      // true: a pattern nothing exercises is decoration.
      if (ban.catches.length === 0) offenders.push(`EMPTY ${ban.claim}`);
      if (ban.spares.length === 0) offenders.push(`NO CONTROL ${ban.claim}`);
      if (ban.pattern.test(text)) {
        offenders.push(`SHIPPED ${ban.claim}: ${text.match(ban.pattern)![0]}`);
      }
    }
    expect(offenders).toEqual([]);
    // The image note names no page: pdf.js does not say which one.
    expect(VIEWER_IMAGE_NOTE).not.toMatch(/\bpage \d/i);
  });

  it("print's resolution is stated with the side cap that lowers it, from the plan", () => {
    // History (review, 2026-11-10): "at 150 dpi" was stated outright, while
    // printPlan draws an A1 sheet at ~124 dpi to stay within the side cap.
    const inches = (VIEWER_PRINT_MAX_SIDE / VIEWER_PRINT_DPI).toFixed(1);
    expect(text).toContain(`wider or taller than ${inches} inches`);
    expect(text).toContain(`${n(VIEWER_PRINT_MAX_SIDE)} pixels a side`);
    // The figure is the plan's: a page that size prints at the full
    // resolution, one inch more prints at less.
    const at = (sideIn: number) => {
      const plan = printPlan([{ width: sideIn * 72, height: 72 }]);
      return (plan.pages[0]!.width / sideIn).toFixed(0);
    };
    expect(at(Number(inches) - 0.1)).toBe(String(VIEWER_PRINT_DPI));
    expect(Number(at(Number(inches) + 1))).toBeLessThan(VIEWER_PRINT_DPI);
  });

  it("the print note says how many pages print and why, from the plan", () => {
    const letter = { width: 612, height: 792 };
    const byPixels = printPlan(Array.from({ length: 80 }, () => letter));
    const note = viewerPrintNote(byPixels, 80)!;
    expect(note).toContain(
      `Printing pages 1 to ${byPixels.pages.length} of 80`,
    );
    expect(note).toContain(`${VIEWER_PRINT_MAX_PIXELS / 1_000_000} megapixels`);
    const a5 = { width: 420, height: 595 };
    const byPages = printPlan(Array.from({ length: 80 }, () => a5));
    expect(viewerPrintNote(byPages, 80)).toContain(
      `at most ${VIEWER_PRINT_MAX_PAGES} pages`,
    );
    // A short document prints whole, and nothing is said.
    expect(viewerPrintNote(printPlan([letter, letter]), 2)).toBeNull();
  });
});

describe("the Do more row the copy promises", () => {
  it("names exactly the tools the row offers, in its order, read from the catalogue's plan", () => {
    // History (review, 2026-11-10): the use case typed four tool names,
    // and reordering `next` in catalog.ts left this file green.
    const plan = continueTargetsFor(getToolBySlug("pdf-viewer")!, tools);
    // As the row orders one file: tools that combine several go last.
    const shown = [
      ...plan.targets.filter((t) => !t.combines),
      ...plan.targets.filter((t) => t.combines),
    ]
      .slice(0, CONTINUE_SHOWN)
      .map((t) => t.name);
    // Health: the row has something to show.
    expect(shown.length).toBe(CONTINUE_SHOWN);
    const list = `${shown.slice(0, -1).join(", ")} or ${shown.at(-1)}`;
    const useCase = content.useCases.find((u) =>
      u.body.includes(VIEWER_LABELS.doMore),
    );
    expect(useCase?.body).toContain(
      `on to ${list} from the ${VIEWER_LABELS.doMore} list`,
    );
  });
});
