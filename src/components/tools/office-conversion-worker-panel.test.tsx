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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { stubJobNetwork, type JobNetwork } from "@/tests/stub-job-network";
import { OFFICE_CONVERSION_RUN_LABEL } from "@/lib/tools/office-run-label";
import {
  FIT_COLUMNS_TO_WIDTH_LABEL,
  ONE_PAGE_PER_SHEET_LABEL,
  ORIENTATION_LABEL,
  PAGE_SETUP_XLSX_ONLY_NOTE,
} from "@/lib/workers/office-conversion/sheet-layout";
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

/*
 * Review 2026-11-08 (audit excel-to-pdf#1): the chain tests start at the
 * option bag, so a ticked box that sent nothing passed them all (a reviewer
 * mutated `layout: { onePagePerSheet }` to `false` and every test stayed
 * green). These start at the controls a reader uses, found by role and
 * name, and end at the job the worker receives.
 */
describe("Excel to PDF: the layout controls reach the job", () => {
  async function pick(slug: string, filename: string) {
    resetWorkerStatusForTests({ sleep: () => Promise.resolve() });
    const network = stubJobNetwork(READY);
    render(<OfficeConversionWorkerPanel tool={tool(slug)} />);
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.change(input, {
      target: { files: [new File(["PK"], filename)] },
    });
    await screen.findByText(filename);
    return network;
  }

  async function convert(network: JobNetwork) {
    const run = await screen.findByRole("button", {
      name: OFFICE_CONVERSION_RUN_LABEL,
    });
    await waitFor(() => expect(run).not.toBeDisabled());
    fireEvent.click(run);
    await waitFor(() => expect(network.jobBodies).toHaveLength(1));
    return network.jobBodies[0]!.options;
  }

  it("a ticked 'Put each sheet on one page' is in the job's options", async () => {
    const network = await pick("excel-to-pdf", "wide.xlsx");
    fireEvent.click(
      screen.getByRole("checkbox", { name: ONE_PAGE_PER_SHEET_LABEL }),
    );
    expect(await convert(network)).toEqual({ onePagePerSheet: true });
  });

  it("Landscape and a ticked fit box are in the job's options", async () => {
    const network = await pick("excel-to-pdf", "wide.xlsx");
    fireEvent.change(
      screen.getByRole("combobox", { name: ORIENTATION_LABEL }),
      { target: { value: "landscape" } },
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: FIT_COLUMNS_TO_WIDTH_LABEL }),
    );
    expect(await convert(network)).toEqual({
      orientation: "landscape",
      fitColumnsToWidth: true,
    });
  });

  it("CONTROL: untouched, the job carries the empty bag it always did", async () => {
    const network = await pick("excel-to-pdf", "wide.xlsx");
    expect(await convert(network)).toEqual({});
  });

  it("one page per sheet hides the page-setup controls it would override", async () => {
    await pick("excel-to-pdf", "wide.xlsx");
    expect(
      screen.getByRole("combobox", { name: ORIENTATION_LABEL }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("checkbox", { name: ONE_PAGE_PER_SHEET_LABEL }),
    );
    expect(
      screen.queryByRole("combobox", { name: ORIENTATION_LABEL }),
    ).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: FIT_COLUMNS_TO_WIDTH_LABEL }),
    ).toBeNull();
  });

  it("a CSV gets the note, not controls it cannot honour", async () => {
    const network = await pick("excel-to-pdf", "towns.csv");
    expect(
      screen.queryByRole("combobox", { name: ORIENTATION_LABEL }),
    ).toBeNull();
    expect(screen.getByText(PAGE_SETUP_XLSX_ONLY_NOTE)).toBeInTheDocument();
    // One page per sheet still applies to a CSV.
    fireEvent.click(
      screen.getByRole("checkbox", { name: ONE_PAGE_PER_SHEET_LABEL }),
    );
    expect(await convert(network)).toEqual({ onePagePerSheet: true });
  });

  it("CONTROL: Word's panel shows none of them", async () => {
    await pick("word-to-pdf", "letter.docx");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: ORIENTATION_LABEL }),
    ).toBeNull();
  });
});
