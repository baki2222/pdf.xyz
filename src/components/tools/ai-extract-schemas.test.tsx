// @vitest-environment jsdom
// @native-canvas
/**
 * AI Data Extraction's saved schemas (competitor audit #16), through the REAL
 * panel, its lazy chunk, the browser's storage and the real job client over
 * a recording network (`stubJobNetwork`). What a run is held to is the
 * `POST /api/jobs` body: a schema saved, the page gone, the panel mounted
 * again, the schema loaded and run must send exactly its fields — the
 * composed chain from the storage to the wire, not the component's state.
 */
import { InToolPage } from "@/tests/in-tool-page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import { SAVED_SCHEMAS_KEY } from "@/lib/jobs/ai-extract-schema-key";
import {
  MAX_SAVED_SCHEMAS,
  SCHEMA_FILE_FORMAT,
  SCHEMA_FILE_VERSION,
} from "@/lib/jobs/ai-extract-schemas";
import { canRunAiExtract } from "@/lib/workers/ai-extract-client";
import { resetTelemetry } from "@/lib/telemetry/track";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import { stubJobNetwork } from "@/tests/stub-job-network";
import { AI_EXTRACT_SCHEMAS_CHUNK } from "./ai-extract-schemas-chunk";
import { AiExtractWorkerPanel } from "./ai-extract-worker-panel";

/**
 * The timeout every wait in this file passes (CI-flake lane 3): its panels'
 * lazy chunks load cold per file in the native-canvas project, where waits have
 * outrun the 1 s default on CI (sign-runner's took 1855 ms in run 44931945692).
 *
 * CI: the slowest test here took 1871 ms (run 44242439721, a passing run; 108
 * CI runs, passing and failing, to 11-21), so the test alone does not hold its
 * waits to 2x. The wait-headroom blocks of the 5 instrumented runs
 * (44917160721, 44924793701, 44931945692, 44938151052, 44941026100) list no
 * wait in this file above 500 ms, half the 1 s default they ran under: 3 s is
 * 6x that. Five samples; re-harvest before tightening. It stays below every
 * test's own timeout, so a wait that times out fails with its DOM dump.
 */
const WAIT_MS = 3_000;

const tool = getToolBySlug("ai-extract")!;
const LQ = String.fromCodePoint(0x201c);
const RQ = String.fromCodePoint(0x201d);

const THREE = [
  { name: "invoice_number", type: "string" },
  { name: "total", type: "number", description: "grand total incl. VAT" },
  { name: "issued", type: "date" },
] as const;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function mount() {
  return render(
    <InToolPage tool={tool}>
      <AiExtractWorkerPanel tool={tool} />
    </InToolPage>,
  );
}

const nameBox = (i: number) =>
  screen.getByRole("textbox", { name: `Field ${i} name` }) as HTMLInputElement;
const hintBox = (i: number) =>
  screen.getByRole("textbox", { name: `Field ${i} hint` }) as HTMLInputElement;
const typeBox = (i: number) =>
  screen.getByRole("combobox", {
    name: `Field ${i} type`,
  }) as HTMLSelectElement;

async function fillThree() {
  await screen.findByRole(
    "textbox",
    { name: "Field 1 name" },
    { timeout: WAIT_MS },
  );
  const add = screen.getByRole("button", { name: "Add field" });
  fireEvent.click(add);
  fireEvent.click(add);
  THREE.forEach((field, i) => {
    fireEvent.change(nameBox(i + 1), { target: { value: field.name } });
    fireEvent.change(typeBox(i + 1), { target: { value: field.type } });
    if ("description" in field)
      fireEvent.change(hintBox(i + 1), {
        target: { value: field.description },
      });
  });
}

async function openSaved() {
  fireEvent.click(screen.getByRole("button", { name: "Saved schemas" }));
  return (await screen.findByRole(
    "textbox",
    {
      name: "Schema name",
    },
    { timeout: WAIT_MS },
  )) as HTMLInputElement;
}

const status = () =>
  document.querySelector('[data-chunk] [role="status"]')?.textContent ?? "";

function shownFields() {
  const out: { name: string; type: string; hint: string }[] = [];
  for (
    let i = 1;
    screen.queryByRole("textbox", { name: `Field ${i} name` });
    i++
  )
    out.push({
      name: nameBox(i).value,
      type: typeBox(i).value,
      hint: hintBox(i).value,
    });
  return out;
}

async function runAndReadSchema(container: HTMLElement) {
  expect(canRunAiExtract(READY_WORKER_STATUS)).toBe(true);
  const network = stubJobNetwork(READY_WORKER_STATUS);
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("the builder has no file input");
  // Health: the first file input is the PDF's, not the schema import.
  expect(input.getAttribute("aria-label")).not.toBe("Schema file to import");
  fireEvent.change(input, {
    target: {
      files: [
        new File([new Uint8Array([1, 2, 3])], "invoice.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  const button = screen.getByRole("button", { name: /extract data/i });
  await waitFor(
    () => expect(button).not.toHaveAttribute("aria-disabled", "true"),
    { timeout: WAIT_MS },
  );
  fireEvent.click(button);
  await waitFor(() => expect(network.jobBodies).toHaveLength(1), {
    timeout: 10_000,
  });
  return network.jobBodies[0]!.options;
}

function importFile(text: string | Uint8Array, name = "schema.json") {
  const input = document.querySelector(
    'input[aria-label="Schema file to import"]',
  ) as HTMLInputElement | null;
  if (!input) throw new Error("no schema import input");
  fireEvent.change(input, {
    target: {
      files: [
        new File(
          [typeof text === "string" ? text : text.slice().buffer],
          name,
          {
            type: "application/json",
          },
        ),
      ],
    },
  });
}

describe("AI Data Extraction: saved schemas", () => {
  it("save three fields, leave, come back, load them, run: the job carries exactly those fields", async () => {
    stubJobNetwork(READY_WORKER_STATUS);
    mount();
    await fillThree();
    const name = await openSaved();
    // The chunk is the lazy one the bundle guard looks for.
    expect(
      document.querySelector(`[data-chunk="${AI_EXTRACT_SCHEMAS_CHUNK}"]`),
    ).not.toBeNull();
    fireEvent.change(name, { target: { value: "Supplier invoice" } });
    fireEvent.click(screen.getByRole("button", { name: "Save schema" }));
    expect(status()).toBe(
      `Saved ${LQ}Supplier invoice${RQ}, 3 fields, in this browser.`,
    );
    // What storage holds is the job's shape, nothing more.
    expect(JSON.parse(window.localStorage.getItem(SAVED_SCHEMAS_KEY)!)).toEqual(
      {
        version: 1,
        schemas: [{ name: "Supplier invoice", fields: THREE }],
      },
    );

    // A reload: everything unmounted, the module state of the panel gone.
    cleanup();
    vi.unstubAllGlobals();
    const { container } = mount();
    await screen.findByRole(
      "textbox",
      { name: "Field 1 name" },
      { timeout: WAIT_MS },
    );
    expect(shownFields()).toEqual([{ name: "", type: "string", hint: "" }]);
    await openSaved();
    const list = screen.getByRole("list", { name: "Saved schemas" });
    expect(within(list).getByText("Supplier invoice")).toBeTruthy();
    expect(within(list).getByText("3 fields")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Load Supplier invoice" }),
    );
    expect(shownFields()).toEqual(
      THREE.map((f) => ({
        name: f.name,
        type: f.type,
        hint: "description" in f ? f.description : "",
      })),
    );
    expect(await runAndReadSchema(container)).toEqual({
      mode: "schema",
      schema: THREE,
    });
  }, 40_000);

  it("CONTROL: without loading, the same run sends the one blank-default field typed", async () => {
    stubJobNetwork(READY_WORKER_STATUS);
    window.localStorage.setItem(
      SAVED_SCHEMAS_KEY,
      JSON.stringify({ version: 1, schemas: [{ name: "S", fields: THREE }] }),
    );
    const { container } = mount();
    fireEvent.change(
      await screen.findByRole(
        "textbox",
        { name: "Field 1 name" },
        { timeout: WAIT_MS },
      ),
      { target: { value: "only" } },
    );
    expect(await runAndReadSchema(container)).toEqual({
      mode: "schema",
      schema: [{ name: "only", type: "string" }],
    });
  }, 40_000);

  it("delete, then Undo, and a replace by name can be undone too", async () => {
    stubJobNetwork(READY_WORKER_STATUS);
    mount();
    await fillThree();
    const name = await openSaved();
    for (const n of ["First", "Second"]) {
      fireEvent.change(name, { target: { value: n } });
      fireEvent.click(screen.getByRole("button", { name: "Save schema" }));
    }
    const names = () =>
      within(screen.getByRole("list", { name: "Saved schemas" }))
        .getAllByRole("listitem")
        .map((li) => li.querySelector("span span")?.textContent);
    expect(names()).toEqual(["Second", "First"]);
    // A keyboard press: the pressed Delete leaves the page with its row, so
    // focus goes to Undo, never to <body>.
    const del = screen.getByRole("button", { name: "Delete First" });
    del.focus();
    expect(document.activeElement).toBe(del);
    fireEvent.click(del);
    expect(names()).toEqual(["Second"]);
    expect(status()).toContain(`Deleted ${LQ}First${RQ}.`);
    const undo = screen.getByRole("button", { name: "Undo" });
    await waitFor(() => expect(document.activeElement).toBe(undo), {
      timeout: WAIT_MS,
    });
    fireEvent.click(undo);
    expect(names()).toEqual(["Second", "First"]);
    // Undo leaves the page too: focus goes to the row it brought back.
    await waitFor(
      () =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Delete First" }),
        ),
      { timeout: WAIT_MS },
    );

    // Replace "First" with one field, then undo the replace.
    fireEvent.click(screen.getByRole("button", { name: "Remove field 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove field 2" }));
    fireEvent.change(name, { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: "Save schema" }));
    expect(status()).toContain("in place of the one with that name");
    expect(names()).toEqual(["first", "Second"]);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(names()).toEqual(["Second", "First"]);
  }, 40_000);

  it("export, then import the file: the same fields come back", async () => {
    stubJobNetwork(READY_WORKER_STATUS);
    let saved: Blob | null = null;
    let filename = "";
    const create = vi.fn((blob: Blob) => {
      saved = blob;
      return "blob:schema";
    });
    // A subclass, so the real URL is untouched for every later test file
    // (vitest runs `isolate: false`); unstubAllGlobals puts URL back.
    class RecordingURL extends URL {
      static override createObjectURL = create;
      static override revokeObjectURL = () => {};
    }
    vi.stubGlobal("URL", RecordingURL);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      filename = this.download;
    });
    mount();
    await fillThree();
    const name = await openSaved();
    fireEvent.change(name, { target: { value: "Supplier invoice" } });
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(filename).toBe("supplier-invoice.schema.json");
    const text = await (saved as unknown as Blob).text();
    expect(JSON.parse(text)).toEqual({
      format: SCHEMA_FILE_FORMAT,
      version: SCHEMA_FILE_VERSION,
      name: "Supplier invoice",
      fields: THREE,
    });

    // Change the list, then import: the file's fields replace it.
    fireEvent.click(screen.getByRole("button", { name: "Remove field 3" }));
    fireEvent.change(nameBox(1), { target: { value: "other" } });
    fireEvent.change(name, { target: { value: "" } });
    importFile(text);
    await waitFor(() => expect(shownFields()).toHaveLength(3), {
      timeout: WAIT_MS,
    });
    expect(shownFields().map((f) => f.name)).toEqual(THREE.map((f) => f.name));
    expect(name.value).toBe("Supplier invoice");
    expect(status()).toContain("Press Save schema to keep it in this browser.");
  }, 40_000);

  it("a malformed or hostile file is refused with a sentence, and nothing changes", async () => {
    stubJobNetwork(READY_WORKER_STATUS);
    mount();
    await fillThree();
    const name = await openSaved();
    fireEvent.change(name, { target: { value: "Mine" } });
    const before = shownFields();
    const hostile = [
      ["{ not json", "not valid JSON"],
      [
        JSON.stringify({
          format: SCHEMA_FILE_FORMAT,
          version: SCHEMA_FILE_VERSION,
          name: "Bad",
          fields: [
            { name: "fine", type: "string" },
            { name: "x".repeat(500), type: "string" },
          ],
        }),
        "Field 2's name is too long",
      ],
      [
        `{"format":${JSON.stringify(SCHEMA_FILE_FORMAT)},"version":1,"name":"P","fields":[{"name":"a"}],"__proto__":{"x":1}}`,
        "holds more than a schema",
      ],
      [JSON.stringify({ hello: "world" }), "not a schema file"],
    ] as const;
    for (const [text, says] of hostile) {
      importFile(text);
      await waitFor(() => expect(status()).toContain(says), {
        timeout: WAIT_MS,
      });
      expect(status()).toContain("Nothing was changed.");
      expect(shownFields()).toEqual(before);
      expect(name.value).toBe("Mine");
    }
    // Not UTF-8 (a Windows-1252 byte inside an otherwise valid file): refused,
    // never read with replacement characters for its letters.
    const valid = new TextEncoder().encode(
      JSON.stringify({
        format: SCHEMA_FILE_FORMAT,
        version: SCHEMA_FILE_VERSION,
        name: "Caf_",
        fields: [{ name: "a", type: "string" }],
      }),
    );
    const latin1 = valid.slice();
    latin1[latin1.indexOf(0x5f)] = 0xe9;
    importFile(latin1);
    await waitFor(
      () => expect(status()).toContain("could not be read as a schema file"),
      { timeout: WAIT_MS },
    );
    expect(shownFields()).toEqual(before);
    // Too large: refused from its size alone.
    importFile("x".repeat(128 * 1024 + 1));
    await waitFor(
      () => expect(status()).toContain("larger than a schema file"),
      { timeout: WAIT_MS },
    );
    expect(shownFields()).toEqual(before);
    // CONTROL: the same bytes with the ASCII byte back are opened.
    importFile(valid);
    await waitFor(() => expect(status()).toContain("from the file: 1 field."), {
      timeout: WAIT_MS,
    });
  }, 40_000);

  it("storage blocked: saving is off and says why, the list is not shown, and a job still runs", async () => {
    const blocked = new Proxy({} as Storage, {
      get() {
        throw new Error("SecurityError");
      },
    });
    vi.stubGlobal("localStorage", blocked);
    stubJobNetwork(READY_WORKER_STATUS);
    const { container } = mount();
    await fillThree();
    const name = await openSaved();
    expect(
      screen.getByText(
        /^Saving is off: this browser is not letting pdf\.xyz keep anything/,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Saved schemas" })).toBeNull();
    const save = screen.getByRole("button", { name: "Save schema" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(name, { target: { value: "S" } });
    fireEvent.click(save);
    expect(status()).toContain("did not let pdf.xyz keep it");
    // The tool still works.
    expect(await runAndReadSchema(container)).toEqual({
      mode: "schema",
      schema: THREE,
    });
  }, 40_000);

  it("corrupted storage: the list is empty, the panel works, and a save replaces the junk", async () => {
    stubJobNetwork(READY_WORKER_STATUS);
    window.localStorage.setItem(SAVED_SCHEMAS_KEY, "{broken");
    mount();
    await fillThree();
    const name = await openSaved();
    expect(
      screen.getByText(
        `No saved schemas yet. This browser keeps up to ${MAX_SAVED_SCHEMAS}.`,
      ),
    ).toBeTruthy();
    fireEvent.change(name, { target: { value: "Fresh" } });
    fireEvent.click(screen.getByRole("button", { name: "Save schema" }));
    expect(
      JSON.parse(window.localStorage.getItem(SAVED_SCHEMAS_KEY)!).schemas,
    ).toHaveLength(1);
  }, 40_000);

  it("nothing is fetched by saving, loading, exporting or deleting", async () => {
    const network = stubJobNetwork(READY_WORKER_STATUS);
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mount();
    await fillThree();
    const name = await openSaved();
    const callsBefore = fetchSpy.mock.calls.length;
    fireEvent.change(name, { target: { value: "N" } });
    fireEvent.click(screen.getByRole("button", { name: "Save schema" }));
    fireEvent.click(screen.getByRole("button", { name: "Load N" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete N" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
    expect(network.jobBodies).toHaveLength(0);
    // Positive control: the spy does see a request.
    await fetch("/api/worker/status");
    expect(fetchSpy.mock.calls.length).toBe(callsBefore + 1);
  }, 40_000);
});
