// @vitest-environment node
/**
 * A client tool's steps may never claim an upload.
 *
 * The tool pages ship their steps as HowTo structured data — the channel
 * that carried TASK-02's fabricated pricing and TASK-07's retention lie to
 * crawlers. For the 29 in-browser tools the file NEVER leaves the device, so
 * a step saying "upload" is a false claim delivered to Google as fact. This
 * held real defects at birth: on the pre-TASK-20 catalogue, split-pdf's
 * first step read "Upload the PDF you want to split." and compare-pdf's
 * read "Upload your PDF." — both in-browser tools.
 *
 * The relationship pinned, not the strings: for every catalogue tool whose
 * capability is in-browser, no step (authored or default) may match the
 * upload family. Worker/AI/hybrid steps MUST be free to say upload — that is
 * their truth — so the rule is scoped by capability, never global.
 */
import { TOOL_HOW } from "./catalog-how";
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { howToSteps } from "./tool-facts";
import { toolFileCeiling } from "./file-ceilings";
import { pageSteps, stepText } from "./page-copy";

const CLAIMS_UPLOAD = /\bupload/i;

/**
 * A step that tells the reader to pick settings. The default steps are written
 * BLIND — one template for every tool without its own — so they cannot know
 * whether a tool has any settings at all. Until 2026-09-27 both default
 * templates said "Choose your options.", which reached Google as HowToStep 2
 * for html-to-pdf, pdf-to-text and every other option-less tool without
 * authored steps.
 */
const CLAIMS_OPTIONS =
  /\b(?:choose|set|pick|select|adjust)\s+(?:your\s+|the\s+|any\s+)?(?:options|settings)\b/i;

/** A step that names a FILE being uploaded — false for a tool that takes none. */
const CLAIMS_FILE_UPLOAD = /\bupload\w*\s+(?:your|the|a|one)\b[^.]*\bfile\b/i;

describe("structured steps are mode-true", () => {
  it("covers every tool (the walk cannot quietly empty)", () => {
    expect(tools.length).toBeGreaterThanOrEqual(50);
    for (const tool of tools) {
      expect(pageSteps(tool).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("no in-browser tool's steps claim an upload", () => {
    const offenders: string[] = [];
    for (const tool of tools) {
      if (capabilityForMode(tool.processing) !== "in-browser") continue;
      // The steps the page renders and ships as HowTo — authored content
      // where a tool has it (since 2026-09-27), not the catalogue's.
      for (const step of pageSteps(tool).map(stepText)) {
        if (CLAIMS_UPLOAD.test(step)) {
          offenders.push(`${tool.slug}: "${step}"`);
        }
      }
    }
    expect(
      offenders,
      `these in-browser tools ship steps claiming an upload — a false claim in HowTo structured data:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("worker tools' default steps do say upload (the scoping is by capability, not a blanket ban)", () => {
    const worker = tools.find(
      (t) =>
        capabilityForMode(t.processing) === "secure-worker" &&
        !TOOL_HOW[t.slug],
    );
    expect(worker).toBeTruthy();
    if (worker) {
      expect(howToSteps(worker).join(" ")).toMatch(CLAIMS_UPLOAD);
    }
  });

  it("steps no tool authored never claim the tool has options", () => {
    // The subject is the default template, reached through every tool that
    // falls back to it — discovered by asking howToSteps, not typed.
    const defaulted = tools.filter((t) => howToSteps(t) !== TOOL_HOW[t.slug]);
    expect(
      defaulted.length,
      "no tool uses the default steps — the check below is vacuous",
    ).toBeGreaterThan(5);
    const offenders = defaulted.flatMap((t) =>
      howToSteps(t)
        .filter((step) => CLAIMS_OPTIONS.test(step))
        .map((step) => `${t.slug}: "${step}"`),
    );
    expect(
      offenders,
      `the default steps cannot know whether a tool has settings, so they may not say it does:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
    // Positive control: the sentence both templates shipped is caught.
    expect(CLAIMS_OPTIONS.test("Choose your options.")).toBe(true);
  });

  it("a tool that takes no file never tells the reader to upload one", () => {
    const urlTools = tools.filter(
      (t) => toolFileCeiling(t).tier === "no-file-input",
    );
    // Health: webpage-to-pdf is one today; an empty set passes vacuously.
    expect(urlTools.length).toBeGreaterThan(0);
    const offenders = urlTools.flatMap((t) =>
      howToSteps(t)
        .filter((step) => CLAIMS_FILE_UPLOAD.test(step))
        .map((step) => `${t.slug}: "${step}"`),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
    // Positive control: what webpage-to-pdf shipped as HowToStep 1.
    expect(
      CLAIMS_FILE_UPLOAD.test(
        "Upload your URL file over an encrypted connection.",
      ),
    ).toBe(true);
  });
});

/**
 * `TOOL_HOW` (catalog-how.ts) reaches a reader only through `howToSteps`,
 * which `pageSteps` calls only when a tool has NO authored content steps.
 * An entry for a tool with authored steps ships to nobody, so a wrong label
 * in it survives every test (review of feat/booklet-pdf, 2026-11-10: the new
 * booklet-pdf entry quoted its run label and no guard could fail on it).
 *
 * A RATCHET over the entries that predate the rule: each still unreached
 * (else it leaves this list) and no other may join. Reachability is asked
 * of `pageSteps`, the function the page renders, never typed.
 */
const UNREACHED_TOOL_HOW_2026_11_10 = [
  "merge-pdf",
  "split-pdf",
  "organize-pages",
  "remove-pages",
  "rotate-pdf",
  "extract-images",
  "compress-pdf",
  "repair-pdf",
  "jpg-to-pdf",
  "png-to-pdf",
  "html-to-pdf",
  "epub-to-pdf",
  "webpage-to-pdf",
  "markdown-to-pdf",
  "text-to-pdf",
  "pdf-to-jpg",
  "pdf-to-png",
  "pdf-to-pdfa",
  "pdf-to-markdown",
  "pdf-to-text",
  "edit-pdf",
  "annotate-pdf",
  "crop-pdf",
  "header-footer",
  "sign-pdf",
  "request-signatures",
  "unlock-pdf",
  "redact-pdf",
  "flatten-pdf",
  "scan-to-pdf",
  "compare-pdf",
  "chat-with-pdf",
];

describe("no tool gains catalogue steps its page never renders", () => {
  const reaches = (slug: string, how: readonly string[]) => {
    const tool = tools.find((t) => t.slug === slug);
    if (!tool) return false;
    const shown = pageSteps(tool).map((s) => s.text);
    return shown.length === how.length && shown.every((t, i) => t === how[i]);
  };
  const unreached = (table: Readonly<Record<string, readonly string[]>>) =>
    Object.entries(table)
      .filter(([slug, how]) => !reaches(slug, how))
      .map(([slug]) => slug);

  it("health: the predicate sees authored steps win (the legacy entries are unreached)", () => {
    expect(unreached(TOOL_HOW).length).toBeGreaterThanOrEqual(20);
  });

  it("every unreached entry is a legacy one, and every legacy one is still unreached", () => {
    expect(unreached(TOOL_HOW).sort()).toEqual(
      [...UNREACHED_TOOL_HOW_2026_11_10].sort(),
    );
  });

  it("positive control: the booklet-pdf entry that shipped is caught", () => {
    const withBooklet = {
      ...TOOL_HOW,
      "booklet-pdf": ["Click “Create sheets”, then “Download PDF”."],
    };
    expect(unreached(withBooklet)).toContain("booklet-pdf");
  });
});
