// @vitest-environment jsdom
/**
 * The Office panel (Word, Excel and PowerPoint to PDF) speaks to the person
 * converting a file, not to the engineer who built the converter.
 *
 * WHY (audit word-to-pdf#5, 2026-11-06; owner ruling 2026-10-21 that the site
 * read "developer style"): the panel's Details said "It produces a PDF
 * artifact or fails honestly — no placeholder output", its not-enabled reason
 * fell back to "Our secure server is not drainable here." or the daemon's own
 * account of queues and object storage, and the pipeline's upload stage said
 * "over a pre-signed URL". Each was true and none was for a reader.
 *
 * The ban list below has a corpus in BOTH directions (CLAUDE.md, Guards
 * rule 1): every sentence the panel shipped is caught by some pattern, and
 * every pattern catches some shipped sentence.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import type { WorkerStatus } from "@/lib/workers/status";
import { canRunOfficeConversion } from "@/lib/workers/office-conversion-client";
import { resetTelemetry } from "@/lib/telemetry/track";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { READY_WORKER_STATUS as READY } from "@/tests/ready-worker-status";
import {
  DOCUMENT_WORDS,
  type OfficeToPdfTool,
} from "@/lib/workers/office-conversion/engine";
import { resetWorkerStatusForTests } from "./use-worker-status";
import { OfficeConversionWorkerPanel } from "./office-conversion-worker-panel";

const SLUGS = ["word-to-pdf", "excel-to-pdf", "powerpoint-to-pdf"] as const;

/** A deployment that answers, but cannot run LibreOffice. */
const OFF: WorkerStatus = {
  ...READY,
  mode: "disabled",
  enabled: false,
  security: { ...READY.security, available: false },
  daemon: resolveDaemonReadiness({}),
};

/** Developer register: each pattern names a shape, not one sentence. */
const JARGON: readonly RegExp[] = [
  /\bartifacts?\b/i,
  /\bfails? honestly\b/i,
  /\bdrain(?:able|s|ing)?\b/i,
  /\bpre-?signed\b/i,
  /\bobject storage\b/i,
  /\bplaceholder\b/i,
  /\b(?:worker )?daemon\b/i,
  /\bjob queue\b/i,
];

/** What the panel shipped before this change, word for word. */
const SHIPPED_BEFORE: readonly string[] = [
  "LibreOffice converts your uploaded document into a real PDF on our isolated server. It produces a PDF artifact or fails honestly — no placeholder output.",
  "Our secure server is not drainable here.",
  "Your file is uploaded directly to short-lived object storage over a pre-signed URL.",
  "Neither the job queue nor object storage is configured, so no worker daemon can run in this environment; nothing is processed.",
];

function tool(slug: string): Tool {
  const found = getToolBySlug(slug);
  expect(found, `${slug} is not in the catalogue`).toBeDefined();
  return found!;
}

async function renderWith(status: WorkerStatus, slug: string) {
  resetWorkerStatusForTests({ sleep: () => Promise.resolve() });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => status })),
  );
  const view = render(<OfficeConversionWorkerPanel tool={tool(slug)} />);
  const slot = view.container.querySelector('[data-slot="worker-status"]')!;
  const state = status === OFF ? "off" : "run";
  await waitFor(() => expect(slot.getAttribute("data-state")).toBe(state));
  if (state === "off") {
    await waitFor(() =>
      expect(slot.querySelector("[data-off]")).not.toBeNull(),
    );
  }
  return view;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetTelemetry();
  resetWorkerStatusForTests();
});

describe("the Office panel's words", () => {
  it("health: READY runs the panel and OFF does not", () => {
    expect(canRunOfficeConversion(READY)).toBe(true);
    expect(canRunOfficeConversion(OFF)).toBe(false);
  });

  it("the ban list and its corpus cover each other", () => {
    for (const sentence of SHIPPED_BEFORE) {
      expect(
        JARGON.some((p) => p.test(sentence)),
        `no pattern catches: ${sentence}`,
      ).toBe(true);
    }
    for (const pattern of JARGON) {
      expect(
        SHIPPED_BEFORE.some((s) => pattern.test(s)),
        `${pattern} catches nothing the panel shipped`,
      ).toBe(true);
    }
  });

  it.each(SLUGS)(
    "%s: no developer wording, ready or not enabled, hidden or shown",
    async (slug) => {
      for (const status of [READY, OFF]) {
        const { container, unmount } = await renderWith(status, slug);
        // textContent includes `hidden` subtrees: Details and "Why?" too.
        const text = container.textContent ?? "";
        expect(text.length).toBeGreaterThan(200);
        for (const pattern of JARGON) {
          expect(
            text,
            `${slug} ${status === OFF ? "off" : "ready"}`,
          ).not.toMatch(pattern);
        }
        unmount();
      }
    },
  );

  it.each(SLUGS)(
    "%s: says in plain words what happens and what a failure looks like",
    async (slug) => {
      const { container } = await renderWith(READY, slug);
      expect(container.textContent).toMatch(
        /LibreOffice turns your \w+ into a PDF on our secure server\. If it cannot, you will see why\./,
      );
    },
  );

  it.each(SLUGS)("%s: not enabled says so plainly", async (slug) => {
    const { container } = await renderWith(OFF, slug);
    expect(container.textContent).toContain(
      "Conversion is unavailable right now.",
    );
  });

  /*
   * The drop zone said "Add your document, or browse" over the hint "Office
   * document" on all three pages (audits excel-to-pdf#5, powerpoint-to-pdf#7).
   * It now names the file the way the engine's own refusals do
   * (`DOCUMENT_WORDS`) and lists the formats the catalogue row accepts.
   */
  it("positive control: the derivation names what a reader expects", () => {
    expect(DOCUMENT_WORDS["excel-to-pdf"].noun).toBe("workbook");
    expect(DOCUMENT_WORDS["powerpoint-to-pdf"].noun).toBe("presentation");
    expect(tool("powerpoint-to-pdf").accept).toEqual(["PPTX", "PPT", "ODP"]);
  });

  it.each(SLUGS)(
    "%s: the drop zone names this tool's file and its formats",
    async (slug: OfficeToPdfTool) => {
      const { container } = await renderWith(READY, slug);
      const text = container.textContent ?? "";
      const noun = DOCUMENT_WORDS[slug].noun;
      const formats = tool(slug).accept;
      const listed = `${formats.slice(0, -1).join(", ")} or ${formats.at(-1)}`;
      expect(text).toContain(`Add your ${noun}, or browse`);
      expect(text).toContain(`${listed} file`);
      expect(text).not.toContain("Office document");
      expect(text).toMatch(
        new RegExp(`LibreOffice turns your ${noun} into a PDF`),
      );
    },
  );
});
