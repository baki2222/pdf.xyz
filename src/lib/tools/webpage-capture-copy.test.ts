import { describe, expect, it } from "vitest";
import {
  WEBPAGE_CAPTURE_SENTENCE,
  WEBPAGE_OVERLAY_ANSWER,
  WEBPAGE_PRINT_STYLES_SENTENCE,
  WEBPAGE_SCROLL_SENTENCE,
  WEBPAGE_OUTLINE_SENTENCE,
  WEBPAGE_SETTINGS_STEP,
  WEBPAGE_STAMP_RETENTION_SENTENCE,
  WEBPAGE_STAMP_SENTENCE,
} from "./webpage-capture-copy";
import {
  STAMP_EMPTY_HEADER,
  WEBPAGE_OUTLINE_PARAMS,
  stampDate,
  stampText,
} from "@/lib/workers/html-render/stamp";
import { LAZY_SCROLL_MAX_STEPS } from "@/lib/workers/html-render/lazy-scroll";
import {
  DEFAULT_WEBPAGE_CAPTURE_OPTIONS,
  OVERLAY_MIN_SHARE,
  WEBPAGE_CAPTURE_LABELS,
  WEBPAGE_CAPTURE_CHOICES,
  WEBPAGE_CAPTURE_GROUP_LABEL,
} from "@/lib/jobs/webpage-capture-options";
import { CONSENT_MANAGERS } from "@/lib/workers/html-render/overlays";
import { toolContent } from "./content";
import { getGuideBySlug } from "@/lib/guides";

/**
 * The Capture sentences are built from the lists the panel draws and the
 * worker hides; these hold each claim to its source (audit webpage-to-pdf#1).
 */
describe("Webpage to PDF capture copy", () => {
  it("health: there are consent tools and capture choices to name", () => {
    expect(CONSENT_MANAGERS.length).toBeGreaterThanOrEqual(5);
    expect(WEBPAGE_CAPTURE_CHOICES.length).toBeGreaterThan(0);
  });

  it("the overlay answer counts and names every listed consent tool, and states the share", () => {
    expect(WEBPAGE_OVERLAY_ANSWER).toContain(
      `${CONSENT_MANAGERS.length} widely used`,
    );
    for (const m of CONSENT_MANAGERS)
      expect(WEBPAGE_OVERLAY_ANSWER).toContain(m.name);
    expect(WEBPAGE_OVERLAY_ANSWER).toContain(
      `at least ${Math.round(OVERLAY_MIN_SHARE * 100)}%`,
    );
    expect(WEBPAGE_OVERLAY_ANSWER).toContain(
      `under ${WEBPAGE_CAPTURE_GROUP_LABEL}`,
    );
    // Ads are named as NOT removed — the option does not block them.
    expect(WEBPAGE_OVERLAY_ANSWER).toMatch(/adverts are not removed/);
  });

  it("every capture choice is named on the tool page and in the guide", () => {
    const page = JSON.stringify(toolContent["webpage-to-pdf"]);
    const guide = JSON.stringify(
      getGuideBySlug("how-to-convert-a-webpage-to-pdf"),
    );
    for (const c of WEBPAGE_CAPTURE_CHOICES) {
      expect(page).toContain(c.label);
      expect(guide).toContain(c.label);
    }
    expect(WEBPAGE_SETTINGS_STEP.body).toContain(WEBPAGE_CAPTURE_SENTENCE);
  });

  it("the print-styles sentence names the default and the screen alternative, on the page and in the guide", () => {
    expect(DEFAULT_WEBPAGE_CAPTURE_OPTIONS.printStyles).toBe(true);
    expect(WEBPAGE_PRINT_STYLES_SENTENCE).toMatch(/stays ticked; untick it/);
    expect(WEBPAGE_PRINT_STYLES_SENTENCE).toContain(
      WEBPAGE_CAPTURE_LABELS.printStyles,
    );
    expect(JSON.stringify(toolContent["webpage-to-pdf"])).toContain(
      WEBPAGE_PRINT_STYLES_SENTENCE,
    );
    expect(
      JSON.stringify(getGuideBySlug("how-to-convert-a-webpage-to-pdf")),
    ).toContain(WEBPAGE_PRINT_STYLES_SENTENCE);
  });

  it("the scroll sentence states the step cap from the renderer's constant, on the page and in the guide (audit webpage-to-pdf#4)", () => {
    expect(WEBPAGE_SCROLL_SENTENCE).toContain(
      `up to ${LAZY_SCROLL_MAX_STEPS} screens`,
    );
    const page = JSON.stringify(toolContent["webpage-to-pdf"]);
    expect(page).toContain(WEBPAGE_SCROLL_SENTENCE);
    expect(page).not.toMatch(/nothing scrolls the page/i);
    const guide = JSON.stringify(
      getGuideBySlug("how-to-convert-a-webpage-to-pdf"),
    );
    expect(guide).toContain(WEBPAGE_SCROLL_SENTENCE);
    expect(guide).not.toMatch(/nothing scrolls the page/i);
  });

  it("the stamp and outline sentences match what the print call adds, on the page and in the guide (audit webpage-to-pdf#7)", () => {
    expect(DEFAULT_WEBPAGE_CAPTURE_OPTIONS.stamp).toBe(false);
    expect(WEBPAGE_STAMP_SENTENCE).toContain(
      `unless you tick ${WEBPAGE_CAPTURE_LABELS.stamp}`,
    );
    // The example is the stamp's own format, from the worker's formatter.
    expect(WEBPAGE_STAMP_SENTENCE).toContain(
      stampDate(new Date(Date.UTC(2026, 10, 8, 14, 3))),
    );
    expect(stampText("https://x.example/", new Date(0))).toMatch(/UTC$/);
    // The empty header is why the title is never printed.
    expect(STAMP_EMPTY_HEADER).not.toMatch(/title|date/);
    expect(WEBPAGE_STAMP_SENTENCE).toMatch(/never adds the page's title/);
    expect(WEBPAGE_OUTLINE_PARAMS.generateDocumentOutline).toBe(true);
    const page = JSON.stringify(toolContent["webpage-to-pdf"]);
    const guide = JSON.stringify(
      getGuideBySlug("how-to-convert-a-webpage-to-pdf"),
    );
    for (const text of [page, guide]) {
      expect(text).toContain(WEBPAGE_STAMP_SENTENCE);
      expect(text).toContain(WEBPAGE_OUTLINE_SENTENCE);
      expect(text).not.toMatch(/adds no date, title, address/);
    }
    expect(page).toContain(WEBPAGE_STAMP_RETENTION_SENTENCE);
  });

  it("the page no longer says cookie notices cannot be removed", () => {
    const page = JSON.stringify(toolContent["webpage-to-pdf"]);
    expect(page).not.toMatch(/Ads cannot be removed/);
    expect(page).toContain(WEBPAGE_OVERLAY_ANSWER);
  });
});
