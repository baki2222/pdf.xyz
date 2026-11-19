// @native-canvas
// @vitest-environment jsdom
/**
 * Create Fillable Forms' Find fields (backlog #17, slice S2), driven the way
 * a person drives it: a real PDF is dropped and read by the real engine,
 * Find fields is pressed, and the builder is judged on what it shows and on
 * what "Create form" is handed.
 *
 * The finder itself is replaced through the chunk's own seam
 * (`detectDeps.detect`) by a canned report: pdf.js cannot start a worker in
 * this thread. What the real reader proposes is form-detect.pdfjs.test.ts;
 * the composed chain (real reader, real page, downloaded widgets) is
 * e2e/create-forms-detect.spec.ts.
 *
 * The decisions these hold (design open_questions_decided): suggestions are
 * a SEPARATE state, so the card validation and the build cannot see them;
 * only Add makes a card, named then, against the cards and the PDF's own
 * fields as they are at that moment, and filtered by the builder's own
 * validateFormFields; the first Add replaces the starter card only while it
 * is untouched.
 */
import type { ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { dropSheetsLive } from "@/tests/drop-sheets-live";
import { unsavedLabels } from "@/lib/intent/unsaved";
import type { FieldProposal } from "@/lib/pdf/form-detect";
import type { DetectReport } from "@/lib/pdf/form-detect-read";
import { emptyCounts } from "@/lib/pdf/form-detect";
import { CreateFormsRunner } from "./create-forms-runner";
import { KINDS, detectDeps, pagesWord, summarize } from "./create-forms-detect";
import { FIELD_TYPE_LABELS } from "@/lib/pdf/offered-kinds";
import { nearestProposal } from "./create-forms-preview";
import { pageImageDeps } from "./use-page-image";

const realRenderer = pageImageDeps.renderer;
const realDetect = detectDeps.detect;
beforeAll(() => {
  pageImageDeps.renderer = async () =>
    ({
      createThumbnailRenderer: async () => ({
        numPages: 1,
        renderPage: async () => null,
        destroy: async () => {},
      }),
    }) as unknown as typeof import("@/lib/pdf/render");
});
afterAll(() => {
  pageImageDeps.renderer = realRenderer;
  detectDeps.detect = realDetect;
});

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

const withRouter = (children: ReactNode) => (
  <AppRouterContext.Provider value={router as never}>
    {children}
  </AppRouterContext.Provider>
);

const proposal = (
  over: Partial<FieldProposal> & Pick<FieldProposal, "label">,
): FieldProposal => {
  const p = {
    page: 1,
    x: 150,
    y: 600,
    width: 200,
    height: 16,
    type: "text" as const,
    rule: "labelled-rule" as const,
    ...over,
  };
  return { key: `${p.page}:${p.rule}:${p.x}:${p.y}`, ...p };
};

const NAME = proposal({ label: "Full name", y: 650 });
const EMAIL = proposal({ label: "Email", y: 620 });
const AGREE = proposal({
  label: "I agree",
  type: "checkbox",
  rule: "square-checkbox",
  x: 72,
  y: 560,
  width: 10,
  height: 10,
});
const PAGE2 = proposal({ label: "City", page: 2, y: 500 });

function reportOf(proposals: FieldProposal[], pages = 2): DetectReport {
  return {
    pages: Array.from({ length: pages }, (_, i) => {
      const mine = proposals.filter((p) => p.page === i + 1);
      return mine.length > 0
        ? { page: i + 1, outcome: "found" as const, proposals: mine }
        : { page: i + 1, outcome: "no-candidates" as const };
    }),
    counts: { ...emptyCounts(), proposals: proposals.length },
    excluded: [],
  };
}

/** Every call the builder made to the finder, with what it passed. */
let calls: { drafts: unknown }[] = [];
function finderReturns(proposals: FieldProposal[], pages = 2) {
  calls = [];
  detectDeps.detect = async (_bytes, o) => {
    calls.push({ drafts: o?.drafts });
    return reportOf(proposals, pages);
  };
}
afterEach(() => {
  detectDeps.detect = realDetect;
});

async function pdf(
  pages: number,
  existing: string[] = [],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  if (existing.length > 0) {
    const form = doc.getForm();
    existing.forEach((name, i) =>
      form.createTextField(name).addToPage(doc.getPage(0), {
        x: 300,
        y: 100 + 30 * i,
        width: 100,
        height: 20,
      }),
    );
  }
  return doc.save();
}

async function openBuilder(bytes: Uint8Array): Promise<HTMLElement> {
  const { container } = render(withRouter(<CreateFormsRunner />));
  await dropSheetsLive(container);
  const picker = container.querySelector('input[type="file"]');
  fireEvent.drop(picker!.closest("label")!, {
    dataTransfer: {
      files: [
        new File([bytes.slice().buffer as ArrayBuffer], "form.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  await screen.findByRole(
    "button",
    { name: /create form/i },
    { timeout: 10_000 },
  );
  return container;
}

async function findFields() {
  fireEvent.click(screen.getByRole("button", { name: "Find fields" }));
  await screen.findByText(/^Found (\d+ possible|nothing)/, undefined, {
    timeout: 10_000,
  });
}

const cards = (c: HTMLElement) => [
  ...c.querySelectorAll<HTMLElement>("[data-field-card]"),
];
const cardNames = (c: HTMLElement) =>
  cards(c).map(
    (card) =>
      (within(card).getByLabelText("Field name") as HTMLInputElement).value,
  );
const rows = (c: HTMLElement) => [
  ...c.querySelectorAll<HTMLElement>("[data-proposal-row]"),
];
const rowName = (row: HTMLElement) =>
  (within(row).getByLabelText("Field name") as HTMLInputElement).value;
const createButton = () => screen.getByRole("button", { name: /create form/i });

describe("Create Forms: Find fields", { timeout: 30_000 }, () => {
  it("suggestions are not cards: no card error, not in the build, and the run bar says so", async () => {
    // An off-page suggestion would be an error on a card; as a suggestion it
    // is no error at all, and the build is handed the starter card alone.
    const offPage = proposal({ label: "Too far", x: 590, y: 300 });
    finderReturns([NAME, offPage]);
    const c = await openBuilder(await pdf(1));
    await findFields();
    expect(rows(c)).toHaveLength(2);
    expect(cards(c)).toHaveLength(1);
    expect(screen.queryByText(/extends past/i)).toBeNull();
    expect(createButton()).not.toBeDisabled();
    screen.getByText("2 found fields are not in the form until you add them.");
    // Pending suggestions mark the builder dirty.
    await waitFor(() =>
      expect(unsavedLabels().join(" ")).toMatch(/form fields/),
    );
    fireEvent.click(createButton());
    await screen.findByText("Fillable form ready", undefined, {
      timeout: 10_000,
    });
    screen.getByText(/1 field added/);
  });

  // Inverted in review round 7 (2026-11-19). This test required the
  // UNTOUCHED starter card's box to be handed to the finder, whose
  // existing-draft rule then dropped the line under it without a word
  // (only existing-FIELD drops are counted), and the first Add deleted the
  // starter: that line ended with no field and no mention. The starter is
  // handed over only once it is touched, as Add keeps it only then.
  it("the finder is told which boxes the cards hold, and never the untouched starter's", async () => {
    finderReturns([NAME]);
    await openBuilder(await pdf(1));
    await findFields();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.drafts).toEqual([]);
    fireEvent.change(
      screen.getByLabelText("Field name", {
        selector: "[data-field-card] input",
      }),
      { target: { value: "applicant" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Find fields" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.drafts).toEqual([
      expect.objectContaining({ page: 1, width: 200, height: 24 }),
    ]);
  });

  it("a labelled line under the untouched starter's box is suggested, and Add puts its field there", async () => {
    // The starter is field_1 at x 72..272, y 700..724 on page 1 (makeDraft):
    // this line sits right under it.
    const UNDER = proposal({ label: "Full name", x: 132, y: 704, width: 300 });
    finderReturns([UNDER, EMAIL]);
    const c = await openBuilder(await pdf(1));
    const starter = cards(c)[0]!;
    expect(
      (within(starter).getByLabelText("Y") as HTMLInputElement).value,
    ).toBe("700");
    await findFields();
    expect(rows(c).map(rowName)).toEqual(["full_name", "email"]);
    fireEvent.click(screen.getByRole("button", { name: /^Add all \(2\)/ }));
    expect(cardNames(c)).toEqual(["full_name", "email"]);
  });

  it("the first Add replaces the untouched starter card, and focuses the new card's name", async () => {
    finderReturns([NAME, EMAIL]);
    const c = await openBuilder(await pdf(1));
    await findFields();
    fireEvent.click(within(rows(c)[0]!).getByRole("button", { name: /^Add/ }));
    expect(cardNames(c)).toEqual(["full_name"]);
    const card = cards(c)[0]!;
    expect(document.activeElement).toBe(
      within(card).getByLabelText("Field name"),
    );
    expect((within(card).getByLabelText("Y") as HTMLInputElement).value).toBe(
      "650",
    );
    // The second Add appends: there is no starter left to replace.
    fireEvent.click(within(rows(c)[0]!).getByRole("button", { name: /^Add/ }));
    expect(cardNames(c)).toEqual(["full_name", "email"]);
    expect(rows(c)).toHaveLength(0);
  });

  it("an edited starter card is kept", async () => {
    finderReturns([NAME]);
    const c = await openBuilder(await pdf(1));
    fireEvent.change(screen.getByLabelText("Field name"), {
      target: { value: "applicant" },
    });
    await findFields();
    fireEvent.click(screen.getByRole("button", { name: /^Add all \(1\)/ }));
    expect(cardNames(c)).toEqual(["applicant", "full_name"]);
  });

  it("a second run gives the same list, not a second copy", async () => {
    finderReturns([NAME, EMAIL, PAGE2]);
    const c = await openBuilder(await pdf(2));
    await findFields();
    const first = rows(c).map((r) => r.getAttribute("data-proposal-row"));
    fireEvent.click(screen.getByRole("button", { name: "Find fields" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    await screen.findByText(/^Found 3 possible fields/);
    expect(rows(c).map((r) => r.getAttribute("data-proposal-row"))).toEqual(
      first,
    );
  });

  it("names are unique against the PDF's fields, dotted groups included, and re-resolved after a rename", async () => {
    finderReturns([NAME, EMAIL, proposal({ label: "Email", y: 400 })]);
    const c = await openBuilder(await pdf(1, ["full_name.first"]));
    await findFields();
    // "full_name.first" makes "full_name" a group: the name is taken.
    expect(rows(c).map(rowName)).toEqual(["full_name_2", "email", "email_2"]);
    // A card renamed to "email" takes that name; the rows move on.
    fireEvent.change(
      screen.getByLabelText("Field name", {
        selector: "[data-field-card] input",
      }),
      {
        target: { value: "email" },
      },
    );
    expect(rows(c).map(rowName)).toEqual(["full_name_2", "email_2", "email_3"]);
    fireEvent.click(screen.getByRole("button", { name: /^Add all \(3\)/ }));
    expect(cardNames(c)).toEqual([
      "email",
      "full_name_2",
      "email_2",
      "email_3",
    ]);
    expect(createButton()).not.toBeDisabled();
  });

  it("a name typed on a row is the name it is added under", async () => {
    finderReturns([NAME]);
    const c = await openBuilder(await pdf(1));
    await findFields();
    fireEvent.change(within(rows(c)[0]!).getByLabelText("Field name"), {
      target: { value: "applicant_name" },
    });
    fireEvent.click(within(rows(c)[0]!).getByRole("button", { name: /^Add/ }));
    expect(cardNames(c)).toEqual(["applicant_name"]);
  });

  // Inverted in review round 7: a refused suggestion was deleted from the
  // list with the rest of the press, so it could not be fixed and added,
  // and focus fell to <body> from the removed row's button.
  it("Add keeps what the builder's own validation refuses in the list, with its reason, and says so", async () => {
    const offPage = proposal({ label: "Too far", x: 590, y: 300 });
    finderReturns([NAME, offPage]);
    const c = await openBuilder(await pdf(1));
    await findFields();
    fireEvent.click(screen.getByRole("button", { name: /^Add all \(2\)/ }));
    expect(cardNames(c)).toEqual(["full_name"]);
    expect(rows(c).map((r) => r.getAttribute("data-proposal-row"))).toEqual([
      offPage.key,
    ]);
    within(rows(c)[0]!).getByText(/^Not added: .+/);
    screen.getByText(
      "1 suggestion could not be added as it is: fix it below and press Add again.",
    );
    // No error on a CARD: the suggestion is still not a card.
    expect(
      [...c.querySelectorAll("[data-field-card]")].some((el) =>
        /extends past/i.test(el.textContent ?? ""),
      ),
    ).toBe(false);
  });

  it("a refused Add on the untouched starter keeps the starter, and focus goes to the refused row", async () => {
    const offPage = proposal({ label: "Too far", x: 590, y: 300 });
    finderReturns([offPage]);
    const c = await openBuilder(await pdf(1));
    await findFields();
    fireEvent.click(within(rows(c)[0]!).getByRole("button", { name: /^Add/ }));
    // The starter used to be deleted with nothing in its place.
    expect(cardNames(c)).toEqual(["field_1"]);
    expect(rows(c)).toHaveLength(1);
    expect(document.activeElement).toBe(
      within(rows(c)[0]!).getByLabelText("Field name"),
    );
    // Still untouched: nothing arms the unsaved guard but the suggestion.
    fireEvent.click(screen.getByRole("button", { name: "Dismiss all" }));
    expect(unsavedLabels()).toEqual([]);
  });

  it("a name the builder refuses can be fixed on its row and added", async () => {
    finderReturns([NAME, EMAIL]);
    const c = await openBuilder(await pdf(1));
    fireEvent.change(screen.getByLabelText("Field name"), {
      target: { value: "email" },
    });
    await findFields();
    expect(rows(c).map(rowName)).toEqual(["full_name", "email_2"]);
    fireEvent.change(within(rows(c)[0]!).getByLabelText("Field name"), {
      target: { value: "email" },
    });
    fireEvent.click(within(rows(c)[0]!).getByRole("button", { name: /^Add/ }));
    expect(cardNames(c)).toEqual(["email"]);
    expect(rows(c).map(rowName)).toEqual(["email", "email_2"]);
    const input = within(rows(c)[0]!).getByLabelText("Field name");
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "applicant" } });
    fireEvent.click(within(rows(c)[0]!).getByRole("button", { name: /^Add/ }));
    expect(cardNames(c)).toEqual(["email", "applicant"]);
    expect(rows(c).map(rowName)).toEqual(["email_2"]);
    expect(screen.queryByText(/could not be added/)).toBeNull();
  });

  it("an emptied name goes back to the suggested one when the field is left", async () => {
    finderReturns([NAME]);
    const c = await openBuilder(await pdf(1));
    await findFields();
    const input = within(rows(c)[0]!).getByLabelText("Field name");
    fireEvent.change(input, { target: { value: "" } });
    expect(rowName(rows(c)[0]!)).toBe("");
    fireEvent.blur(input);
    expect(rowName(rows(c)[0]!)).toBe("full_name");
  });

  it("the names on the rows are the names Add gives while the starter is untouched", async () => {
    // "1." names as field_1, the starter's own name: the starter is not
    // kept by the first Add, so the row must not dodge it either.
    const NUMBERED = proposal({ label: "1.", y: 500 });
    finderReturns([NUMBERED]);
    const c = await openBuilder(await pdf(1));
    await findFields();
    const shown = rows(c).map(rowName);
    fireEvent.click(within(rows(c)[0]!).getByRole("button", { name: /^Add/ }));
    expect(cardNames(c)).toEqual(shown);
  });

  it("what is added or dismissed while a second run goes does not come back", async () => {
    finderReturns([NAME, EMAIL, AGREE]);
    const c = await openBuilder(await pdf(1));
    await findFields();
    let release: () => void = () => {};
    detectDeps.detect = (_b, o) =>
      new Promise((resolve) => {
        calls.push({ drafts: o?.drafts });
        release = () => resolve(reportOf([NAME, EMAIL, AGREE], 1));
      });
    fireEvent.click(screen.getByRole("button", { name: "Find fields" }));
    await screen.findByText(/^Looking at/);
    fireEvent.click(within(rows(c)[0]!).getByRole("button", { name: /^Add/ }));
    fireEvent.click(
      within(rows(c)[0]!).getByRole("button", { name: /^Dismiss/ }),
    );
    expect(cardNames(c)).toEqual(["full_name"]);
    await act(async () => release());
    await screen.findByText(/^Found 3 possible fields/);
    expect(rows(c).map((r) => r.getAttribute("data-proposal-row"))).toEqual([
      AGREE.key,
    ]);
  });

  it("the press shows at once, before the chunk has arrived", async () => {
    finderReturns([NAME]);
    await openBuilder(await pdf(1));
    fireEvent.click(screen.getByRole("button", { name: "Find fields" }));
    // Synchronously: each builder mounts with no chunk, so the line is
    // there before the import resolves (it used to show nothing at all).
    screen.getByText("Loading Find fields…");
    await screen.findByText(/^Found 1 possible field/);
  });

  it("Add all on this page adds only the page the preview shows", async () => {
    finderReturns([NAME, PAGE2]);
    const c = await openBuilder(await pdf(2));
    await findFields();
    fireEvent.click(
      screen.getByRole("button", { name: /^Add all on this page \(1\)/ }),
    );
    expect(cardNames(c)).toEqual(["full_name"]);
    expect(rows(c).map((r) => r.getAttribute("data-proposal-row"))).toEqual([
      PAGE2.key,
    ]);
  });

  it("Dismiss moves focus to the next suggestion; Dismiss all restores the builder", async () => {
    finderReturns([NAME, EMAIL, AGREE]);
    const c = await openBuilder(await pdf(1));
    const before = cardNames(c);
    await findFields();
    fireEvent.click(
      within(rows(c)[0]!).getByRole("button", { name: /^Dismiss/ }),
    );
    expect(rows(c)).toHaveLength(2);
    expect(document.activeElement).toBe(
      within(rows(c)[0]!).getByRole("button", { name: /^Add/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss all" }));
    expect(rows(c)).toHaveLength(0);
    expect(cardNames(c)).toEqual(before);
    expect(
      screen.queryByText(/found fields? (are|is) not in the form/),
    ).toBeNull();
    expect(unsavedLabels()).toEqual([]);
    expect(document.activeElement).toBe(
      screen.getByTestId("find-fields-summary"),
    );
  });

  it("Cancel stops the run and adds nothing", async () => {
    let release: () => void = () => {};
    detectDeps.detect = (_b, o) =>
      new Promise((resolve, reject) => {
        o?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
        release = () => resolve(reportOf([NAME], 1));
      });
    const c = await openBuilder(await pdf(1));
    fireEvent.click(screen.getByRole("button", { name: "Find fields" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await act(async () => release());
    screen.getByText("Stopped. Nothing was added.");
    expect(rows(c)).toHaveLength(0);
  });
});

describe("Create Forms: Find fields' summary says exactly what happened", () => {
  const base = (pages: DetectReport["pages"], counts = {}): DetectReport => ({
    pages,
    counts: { ...emptyCounts(), ...counts },
    excluded: [],
  });
  const text = (r: DetectReport) => summarize(r).map((l) => l.text);

  it.each([
    [
      "found on some pages",
      base([
        { page: 1, outcome: "found", proposals: [NAME, EMAIL] },
        { page: 2, outcome: "no-candidates" },
        { page: 3, outcome: "found", proposals: [{ ...PAGE2, page: 3 }] },
      ]),
      [
        "Found 3 possible fields on 2 of 3 pages: check each one, as nothing is added until you add it.",
        "Nothing was suggested on page 2: check it and add any field by hand.",
      ],
    ],
    [
      "one page, one field",
      base([{ page: 1, outcome: "found", proposals: [NAME] }]),
      [
        "Found 1 possible field: check each one, as nothing is added until you add it.",
      ],
    ],
    [
      "nothing at all",
      base([{ page: 1, outcome: "no-candidates" }]),
      [
        "Found nothing to suggest, so add each field the form needs with Add field.",
      ],
    ],
    [
      "a scan",
      base([
        { page: 1, outcome: "found", proposals: [NAME] },
        { page: 2, outcome: "no-text-layer" },
      ]),
      [
        "Found 1 possible field on 1 of 2 pages: check each one, as nothing is added until you add it.",
        "Page 2 is only a picture, with no text to read, so it was not searched: add its fields by hand.",
      ],
    ],
    [
      "two scans",
      base([
        { page: 1, outcome: "no-text-layer" },
        { page: 2, outcome: "no-text-layer" },
      ]),
      [
        "Found nothing to suggest, so add each field the form needs with Add field.",
        "Pages 1 and 2 are only pictures, with no text to read, so they were not searched: add their fields by hand.",
      ],
    ],
    [
      "nothing drawn",
      base([{ page: 1, outcome: "nothing-drawn" }]),
      [
        "Found nothing to suggest, so add each field the form needs with Add field.",
        "Nothing could be read on page 1: it may be blank or damaged, so add any field it needs by hand.",
      ],
    ],
    [
      "drawn turned",
      base([{ page: 1, outcome: "turned-content" }]),
      [
        "Found nothing to suggest, so add each field the form needs with Add field.",
        "The writing on page 1 shows sideways or upside down, which Find fields cannot read: add those fields by hand.",
      ],
    ],
    [
      "unread",
      base([{ page: 1, outcome: "unread", reason: "bad" }]),
      [
        "Found nothing to suggest, so add each field the form needs with Add field.",
        "Page 1 could not be read: add its fields by hand.",
      ],
    ],
    [
      "too complex",
      base([{ page: 1, outcome: "skipped", reason: "too-complex" }]),
      [
        "Found nothing to suggest, so add each field the form needs with Add field.",
        "Page 1 has too many drawn lines to search: add its fields by hand.",
      ],
    ],
    [
      "past the page cap",
      base([
        ...Array.from({ length: 50 }, (_, i) => ({
          page: i + 1,
          outcome: "no-candidates" as const,
        })),
        ...[51, 52, 53].map((page) => ({
          page,
          outcome: "skipped" as const,
          reason: "page-cap" as const,
        })),
      ]),
      [
        "Found nothing to suggest, so add each field the form needs with Add field.",
        "Only the first 50 pages are searched, so pages 51 to 53 were not: add their fields by hand.",
      ],
    ],
    [
      "counts",
      base([{ page: 1, outcome: "found", proposals: [NAME] }], {
        signatureLines: 2,
        alreadyFields: 1,
        rotatedText: 3,
        capped: 4,
      }),
      [
        "Found 1 possible field: check each one, as nothing is added until you add it.",
        "2 lines labelled as a signature were skipped: Edit PDF adds a signature field, and Sign PDF signs the PDF.",
        "1 line already has a field, so it was left alone.",
        "3 lines have a label that is not upright, so they were skipped: add those by hand.",
        "4 more possible fields were left out, as at most 60 are suggested on a page and 300 in all: check those pages and add the rest by hand.",
      ],
    ],
    [
      // Review round 7: pages the run cap emptied read as "Nothing was
      // suggested on pages 40 to 50", and the cap line named no page.
      "the caps, by page",
      base(
        [
          { page: 1, outcome: "found", proposals: [NAME], leftOut: 2 },
          { page: 2, outcome: "capped", leftOut: 8 },
          { page: 3, outcome: "capped", leftOut: 8 },
          { page: 4, outcome: "capped", leftOut: 8 },
          { page: 5, outcome: "no-candidates" },
          { page: 6, outcome: "capped", leftOut: 8 },
        ],
        { capped: 34 },
      ),
      [
        "Found 1 possible field on 1 of 6 pages: check each one, as nothing is added until you add it.",
        "Nothing was suggested on page 5: check it and add any field by hand.",
        "34 more possible fields were left out on pages 1 to 4 and 6, as at most 60 are suggested on a page and 300 in all: check those pages and add the rest by hand.",
      ],
    ],
  ] as const)("%s", (_, report, want) => {
    expect(text(report as DetectReport)).toEqual(want);
  });

  it("the signature line links to Edit PDF and Sign PDF", () => {
    const [, sig] = summarize(
      base([{ page: 1, outcome: "found", proposals: [NAME] }], {
        signatureLines: 1,
      }),
    );
    expect(sig).toEqual({
      text: "1 line labelled as a signature was skipped: Edit PDF adds a signature field, and Sign PDF signs the PDF.",
      links: [
        { words: "Edit PDF", href: "/tools/edit-pdf" },
        { words: "Sign PDF", href: "/tools/sign-pdf" },
      ],
    });
  });

  it("pages are named in runs", () => {
    expect(pagesWord([3])).toBe("page 3");
    expect(pagesWord([4, 3])).toBe("pages 3 and 4");
    expect(pagesWord([3, 4, 5, 6, 7])).toBe("pages 3 to 7");
    expect(pagesWord([12, 2, 5, 6, 7, 8, 9])).toBe("pages 2, 5 to 9 and 12");
    expect(pagesWord([1, 2, 4, 5])).toBe("pages 1, 2, 4 and 5");
  });
});

describe(
  "Create Forms: suggestions on the page preview",
  { timeout: 30_000 },
  () => {
    const sheet = () => screen.getByTestId("form-page-preview");
    const drawn = () =>
      [...sheet().querySelectorAll<HTMLElement>("[data-proposed]")].map((el) =>
        el.getAttribute("data-proposed"),
      );
    const button = (p: FieldProposal) =>
      sheet().querySelector<HTMLElement>(`[data-proposal="${p.key}"]`)!;

    it("each suggestion on the shown page is drawn in the third state, dotted, with a named button", async () => {
      finderReturns([NAME, AGREE, PAGE2]);
      await openBuilder(await pdf(2));
      await screen.findByTestId("form-page-preview", undefined, {
        timeout: 10_000,
      });
      await findFields();
      expect(drawn()).toEqual([NAME.key, AGREE.key]);
      const box = sheet().querySelector<HTMLElement>(
        `[data-proposed="${NAME.key}"]`,
      )!;
      expect(box.style.border).toMatch(/dotted/);
      expect(box.getAttribute("aria-hidden")).toBe("true");
      expect(button(NAME).getAttribute("aria-label")).toBe(
        "Found text field, “Full name”, page 1, press Enter to add it or Delete to dismiss it",
      );
      // The 24 px minimum hit area is measured in a real browser
      // (e2e/create-forms-detect.spec.ts): jsdom drops calc()/max() styles.
    });

    it("a press selects the suggestion's row and never adds it", async () => {
      finderReturns([NAME, PAGE2]);
      const c = await openBuilder(await pdf(2));
      await screen.findByTestId("form-page-preview", undefined, {
        timeout: 10_000,
      });
      await findFields();
      fireEvent.pointerDown(button(NAME));
      fireEvent.click(button(NAME));
      expect(button(NAME).getAttribute("aria-pressed")).toBe("true");
      expect(rows(c)).toHaveLength(2);
      expect(cardNames(c)).toEqual(["field_1"]);
      // Selecting a row on another page turns the preview to that page.
      fireEvent.focus(within(rows(c)[1]!).getByLabelText("Field name"));
      expect(drawn()).toEqual([PAGE2.key]);
      expect(button(PAGE2).getAttribute("aria-pressed")).toBe("true");
    });

    it("one suggestion is in the tab order; Delete dismisses it, Enter adds the next", async () => {
      finderReturns([NAME, EMAIL]);
      const c = await openBuilder(await pdf(1));
      await screen.findByTestId("form-page-preview", undefined, {
        timeout: 10_000,
      });
      await findFields();
      // Packed suggestions are not packed targets: one button, the first.
      expect(sheet().querySelectorAll("[data-proposal]")).toHaveLength(1);
      expect(button(EMAIL)).toBeNull();
      fireEvent.keyDown(button(NAME), { key: "Delete" });
      expect(rows(c).map((r) => r.getAttribute("data-proposal-row"))).toEqual([
        EMAIL.key,
      ]);
      expect(cardNames(c)).toEqual(["field_1"]);
      fireEvent.keyDown(button(EMAIL), { key: "Enter" });
      expect(rows(c)).toHaveLength(0);
      expect(cardNames(c)).toEqual(["email"]);
      expect(drawn()).toEqual([]);
    });

    it("a press on any suggestion's area selects it, and it becomes the button", async () => {
      finderReturns([NAME, EMAIL]);
      const c = await openBuilder(await pdf(1));
      await screen.findByTestId("form-page-preview", undefined, {
        timeout: 10_000,
      });
      await findFields();
      const hit = sheet().querySelector<HTMLElement>(
        `[data-proposal-hit="${EMAIL.key}"]`,
      )!;
      expect(hit.getAttribute("aria-hidden")).toBe("true");
      fireEvent.pointerUp(hit);
      expect(button(EMAIL)!.getAttribute("aria-pressed")).toBe("true");
      expect(button(NAME)).toBeNull();
      expect(rows(c)).toHaveLength(2);
      expect(cardNames(c)).toEqual(["field_1"]);
    });

    it("where hit areas overlap, the nearest centre wins", () => {
      const a = { ...AGREE, kind: "Checkbox" };
      const b = { ...AGREE, key: "b", x: AGREE.x + 12, kind: "Checkbox" };
      expect(nearestProposal([a, b], { x: AGREE.x + 2, y: AGREE.y + 5 })).toBe(
        a.key,
      );
      expect(nearestProposal([a, b], { x: AGREE.x + 20, y: AGREE.y + 5 })).toBe(
        "b",
      );
      expect(nearestProposal([], { x: 0, y: 0 })).toBeNull();
    });
  },
);

/**
 * Every type the finder can propose: a Record over FieldProposal["type"], so
 * the compiler refuses this file when the union gains or loses a member
 * (it used to compare KINDS with a typed ["checkbox", "text"], which a
 * widened union would not have touched).
 */
const PROPOSED_TYPES: Record<FieldProposal["type"], true> = {
  text: true,
  checkbox: true,
};

describe("Create Forms: Find fields names a type as the type switch does", () => {
  // The chunk carries its own copy (a second importer of offered-kinds.ts
  // would break that first-load module's concatenation); this holds it.
  it("each kind the finder suggests is FIELD_TYPE_LABELS' word for it", () => {
    for (const [type, word] of Object.entries(KINDS))
      expect(word, type).toBe(
        FIELD_TYPE_LABELS[type as keyof typeof FIELD_TYPE_LABELS],
      );
    expect(Object.keys(KINDS).sort()).toEqual(
      Object.keys(PROPOSED_TYPES).sort(),
    );
  });
});
