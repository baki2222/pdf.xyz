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
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { howToSteps } from "./tool-facts";

const CLAIMS_UPLOAD = /\bupload/i;

describe("structured steps are mode-true", () => {
  it("covers every tool (the walk cannot quietly empty)", () => {
    expect(tools.length).toBeGreaterThanOrEqual(50);
    for (const tool of tools) {
      expect(howToSteps(tool).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("no in-browser tool's steps claim an upload", () => {
    const offenders: string[] = [];
    for (const tool of tools) {
      if (capabilityForMode(tool.processing) !== "in-browser") continue;
      for (const step of howToSteps(tool)) {
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
      (t) => capabilityForMode(t.processing) === "secure-worker" && !t.how,
    );
    expect(worker).toBeTruthy();
    if (worker) {
      expect(howToSteps(worker).join(" ")).toMatch(CLAIMS_UPLOAD);
    }
  });
});
