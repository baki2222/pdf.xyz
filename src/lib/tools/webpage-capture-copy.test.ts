import { describe, expect, it } from "vitest";
import {
  WEBPAGE_CAPTURE_SENTENCE,
  WEBPAGE_OVERLAY_ANSWER,
  WEBPAGE_SETTINGS_STEP,
} from "./webpage-capture-copy";
import {
  OVERLAY_MIN_SHARE,
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

  it("the page no longer says cookie notices cannot be removed", () => {
    const page = JSON.stringify(toolContent["webpage-to-pdf"]);
    expect(page).not.toMatch(/Ads cannot be removed/);
    expect(page).toContain(WEBPAGE_OVERLAY_ANSWER);
  });
});
