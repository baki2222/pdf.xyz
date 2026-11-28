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
import { InToolPage } from "@/tests/in-tool-page";
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
import {
  CSV_CHARSETS,
  CSV_CHARSET_LABEL,
  CSV_DELIMITERS,
  CSV_DELIMITER_LABEL,
  CSV_IMPORT_HINT,
} from "@/lib/workers/office-conversion/csv-import";
import { getToolBySlug } from "@/lib/tools";
import { WORKER_BATCH_TOOLS } from "@/lib/batch/tools";
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
  const view = render(
    <InToolPage tool={tool(slug)}>
      <OfficeConversionWorkerPanel tool={tool(slug)} />
    </InToolPage>,
  );
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
    render(
      <InToolPage tool={tool(slug)}>
        <OfficeConversionWorkerPanel tool={tool(slug)} />
      </InToolPage>,
    );
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

  // Audit wave 2 excel-to-pdf#1 (2026-11-28): a worker that proves
  // `sheetPageSetupAnyFormat` takes page setup on a .csv, .xls and .ods.
  for (const filename of ["towns.csv", "towns.xls", "towns.ods"])
    it(`${filename}: a worker proving sheetPageSetupAnyFormat shows the controls, no note, and Landscape and fit reach the job`, async () => {
      resetWorkerStatusForTests({ sleep: () => Promise.resolve() });
      const network = stubJobNetwork({
        ...READY,
        sheetPageSetupAnyFormat: true,
      });
      render(
        <InToolPage tool={tool("excel-to-pdf")}>
          <OfficeConversionWorkerPanel tool={tool("excel-to-pdf")} />
        </InToolPage>,
      );
      const input = await waitFor(() => {
        const el =
          document.querySelector<HTMLInputElement>('input[type="file"]');
        expect(el).not.toBeNull();
        return el!;
      });
      fireEvent.change(input, {
        target: { files: [new File(["PK"], filename)] },
      });
      await screen.findByText(filename);
      const select = await screen.findByRole("combobox", {
        name: ORIENTATION_LABEL,
      });
      expect(screen.queryByText(PAGE_SETUP_XLSX_ONLY_NOTE)).toBeNull();
      fireEvent.change(select, { target: { value: "landscape" } });
      fireEvent.click(
        screen.getByRole("checkbox", { name: FIT_COLUMNS_TO_WIDTH_LABEL }),
      );
      expect(await convert(network)).toEqual({
        orientation: "landscape",
        fitColumnsToWidth: true,
      });
    });

  // Review of excel-to-pdf#1 (2026-11-28): the BATCH run never passed the
  // worker's sheetPageSetupAnyFormat to officeJobOptions, so every .csv,
  // .xls and .ods row dropped Orientation and fit while the controls showed
  // and the copy said any spreadsheet takes them. Through the batch view.
  it("a batch of a .csv and an .ods on a worker proving sheetPageSetupAnyFormat sends Landscape and fit on every row", async () => {
    resetWorkerStatusForTests({ sleep: () => Promise.resolve() });
    const network = stubJobNetwork({ ...READY, sheetPageSetupAnyFormat: true });
    render(
      <InToolPage tool={tool("excel-to-pdf")}>
        <OfficeConversionWorkerPanel tool={tool("excel-to-pdf")} />
      </InToolPage>,
    );
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.change(input, {
      target: {
        files: [new File(["a,b"], "towns.csv"), new File(["PK"], "towns.ods")],
      },
    });
    const { verb, noun } = WORKER_BATCH_TOOLS["excel-to-pdf"];
    const run = await screen.findByRole("button", {
      name: `${verb} 2 ${noun[1]}`,
    });
    fireEvent.change(
      await screen.findByRole("combobox", { name: ORIENTATION_LABEL }),
      { target: { value: "landscape" } },
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: FIT_COLUMNS_TO_WIDTH_LABEL }),
    );
    await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(run);
    await waitFor(() => expect(network.jobBodies).toHaveLength(2), {
      timeout: 5000,
    });
    expect(network.jobBodies.map((b) => b.options)).toEqual([
      { orientation: "landscape", fitColumnsToWidth: true },
      { orientation: "landscape", fitColumnsToWidth: true },
    ]);
  });

  it("an orientation chosen for an .xlsx is NOT sent once a .csv replaces it on a worker that does not prove sheetPageSetupAnyFormat", async () => {
    const network = await pick("excel-to-pdf", "wide.xlsx");
    fireEvent.change(
      screen.getByRole("combobox", { name: ORIENTATION_LABEL }),
      { target: { value: "landscape" } },
    );
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    if (input) {
      fireEvent.change(input, {
        target: { files: [new File(["a,b"], "towns.csv")] },
      });
      await screen.findByText("towns.csv");
      expect(await convert(network)).toEqual({});
    }
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

/*
 * Competitor audit #18 (2026-11-17): a .csv's Delimiter and Character set,
 * from the selects a reader uses (found by role and name) to the job the
 * worker receives. Shown only for a .csv, and only while the live status
 * proves `csvImportOptions` — an older worker would drop both.
 */
describe("Excel to PDF: a CSV's delimiter and character set reach the job", () => {
  const PROVED: WorkerStatus = { ...READY, csvImportOptions: true };

  async function pick(status: WorkerStatus, slug: string, filename: string) {
    resetWorkerStatusForTests({ sleep: () => Promise.resolve() });
    const network = stubJobNetwork(status);
    render(
      <InToolPage tool={tool(slug)}>
        <OfficeConversionWorkerPanel tool={tool(slug)} />
      </InToolPage>,
    );
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.change(input, {
      target: { files: [new File(["a;b\n"], filename)] },
    });
    await screen.findByText(filename);
    // The selects wait on the status, so let the run button settle first.
    const run = await screen.findByRole("button", {
      name: OFFICE_CONVERSION_RUN_LABEL,
    });
    await waitFor(() => expect(run).not.toBeDisabled());
    return network;
  }

  async function convert(network: JobNetwork) {
    fireEvent.click(
      screen.getByRole("button", { name: OFFICE_CONVERSION_RUN_LABEL }),
    );
    await waitFor(() => expect(network.jobBodies).toHaveLength(1));
    return network.jobBodies[0]!.options;
  }

  const delimiter = () =>
    screen.queryByRole("combobox", { name: CSV_DELIMITER_LABEL });
  const charset = () =>
    screen.queryByRole("combobox", { name: CSV_CHARSET_LABEL });

  it("a .csv shows both selects, with every choice, Auto first", async () => {
    await pick(PROVED, "excel-to-pdf", "rows.csv");
    const options = (el: HTMLElement | null) =>
      [...(el as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options(delimiter())).toEqual(CSV_DELIMITERS.map((d) => d.label));
    expect(options(charset())).toEqual(CSV_CHARSETS.map((c) => c.label));
    expect((delimiter() as HTMLSelectElement).value).toBe("");
    expect(screen.getByText(CSV_IMPORT_HINT)).toBeInTheDocument();
  });

  it("Semicolon and Windows-1251 are in the job's options", async () => {
    const network = await pick(PROVED, "excel-to-pdf", "rows.csv");
    fireEvent.change(delimiter()!, { target: { value: "semicolon" } });
    fireEvent.change(charset()!, { target: { value: "windows-1251" } });
    expect(await convert(network)).toEqual({
      csvDelimiter: "semicolon",
      csvCharset: "windows-1251",
    });
  });

  it("every choice of each select reaches the job as its own value", async () => {
    for (const d of CSV_DELIMITERS.filter((x) => x.value)) {
      cleanup();
      const network = await pick(PROVED, "excel-to-pdf", "rows.csv");
      fireEvent.change(delimiter()!, { target: { value: d.value } });
      expect(await convert(network)).toEqual({ csvDelimiter: d.value });
    }
    for (const c of CSV_CHARSETS.filter((x) => x.value)) {
      cleanup();
      const network = await pick(PROVED, "excel-to-pdf", "rows.csv");
      fireEvent.change(charset()!, { target: { value: c.value } });
      expect(await convert(network)).toEqual({ csvCharset: c.value });
    }
  });

  it("CONTROL: left on Auto, a .csv carries the empty bag it always did", async () => {
    const network = await pick(PROVED, "excel-to-pdf", "rows.csv");
    expect(delimiter()).not.toBeNull();
    expect(await convert(network)).toEqual({});
  });

  it("an .xlsx shows neither", async () => {
    await pick(PROVED, "excel-to-pdf", "wide.xlsx");
    // Health: the panel's other controls rendered, so absence means something.
    expect(
      screen.getByRole("combobox", { name: ORIENTATION_LABEL }),
    ).toBeVisible();
    expect(delimiter()).toBeNull();
    expect(charset()).toBeNull();
  });

  it("a worker that does not prove csvImportOptions shows neither, and the job carries no CSV key", async () => {
    const network = await pick(READY, "excel-to-pdf", "rows.csv");
    expect(READY.csvImportOptions).not.toBe(true);
    expect(delimiter()).toBeNull();
    expect(charset()).toBeNull();
    expect(await convert(network)).toEqual({});
  });

  it("CONTROL: Word's panel shows neither, even for a proving worker", async () => {
    await pick(PROVED, "word-to-pdf", "letter.docx");
    expect(delimiter()).toBeNull();
    expect(charset()).toBeNull();
  });
});
