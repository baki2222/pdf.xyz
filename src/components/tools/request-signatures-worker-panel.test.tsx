// @vitest-environment jsdom
// @native-canvas
/**
 * The signature page the builder sends, and what it shows before sending.
 *
 * The defect: the page defaulted to 1 — a contract's COVER — with no upper bound
 * and no preview, so the first time anyone saw where the fields went was in the
 * downloaded PDF. These drive the real builder with a real PDF through the real
 * file input: the page count is read in the browser, the default becomes the
 * LAST page, the input is clamped to the document, and the preview draws the
 * exact layout the request will carry.
 */
import { InToolPage } from "@/tests/in-tool-page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { getToolBySlug } from "@/lib/tools";
import {
  MAX_FIELD_LABEL_CHARS,
  MAX_REQUEST_FIELDS,
  MAX_REQUEST_MESSAGE_CHARS,
  MAX_REQUEST_SIGNERS,
  MAX_REQUEST_TITLE_CHARS,
  MAX_SIGNER_EMAIL_CHARS,
  MAX_SIGNER_NAME_CHARS,
  signatureBlockFields,
  type RequestSignatureField,
} from "@/lib/jobs/request-signatures";
import { JOB_LIMITS } from "@/lib/jobs/types";
import { parseCreateJobRequest } from "@/lib/jobs/validation";
import { resetUploadedThisSessionForTests } from "@/lib/uploads/session-uploads";
import {
  PDF_ENCRYPTED_UNKNOWN_MESSAGE,
  PDF_NEEDS_PASSWORD_MESSAGE,
  PDF_RESTRICTED_MESSAGE,
  UNLOCK_TOOL_HREF,
  UNLOCK_TOOL_NAME,
} from "@/lib/pdf/encryption";
import {
  ownerOnlyEncryptedPdf,
  ownerOnlyObjectStreamPdf,
  unknownHandlerObjectStreamPdf,
  userPasswordEncryptedPdf,
  userPasswordObjectStreamPdf,
} from "@/tests/encrypted-pdf-fixture";
import { readPdfFrames } from "@/lib/pdf/page-frame";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import {
  RequestSignaturesWorkerPanel,
  clampSignaturePage,
} from "./request-signatures-worker-panel";

/**
 * The timeout every wait in this file passes (CI-flake lane 3): its panels'
 * lazy chunks load cold per file in the native-canvas project, where waits have
 * outrun the 1 s default on CI (sign-runner's took 1855 ms in run 44931945692).
 *
 * CI (19 passing runs, 11-18 to 11-21): the two 50-box tests take up to 8847 ms
 * (run 44331878323), in their box loops, not in a wait — the wait-headroom
 * blocks of runs 44917160721 and 44924793701 list no wait in this file above
 * 500 ms, half the 1 s default. The slowest of the other tests took 1436 ms
 * (run 44299285879, the 8 KB options ceiling). 3 s is 6x the waits seen and
 * 2.1x that test, and stays below every test's own timeout (5 s, 30 s in the
 * placement block), so a wait that times out fails with its DOM dump.
 */
const WAIT_MS = 3_000;

/** Written here, not imported: the test holds the panel to this sentence. */
const TOO_LONG_SENTENCE =
  "This request is too long to send. Shorten the message or the labels, or remove some boxes.";

// A ready deployment: since WP-10 the builder's Run waits on the page's
// status check, so the "runnable" controls below need one to say yes.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => READY_WORKER_STATUS,
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The builder, as the page mounts it: inside its panel (WP-10). It rendered
 * the builder bare until the drop zone moved out of the status gate — the
 * builder now reads the page's status through the panel shell, and its drop
 * zone renders before the status answers, so the panel is all a test needs.
 */
const TOOL = getToolBySlug("request-signatures")!;
const Builder = () => (
  <InToolPage tool={TOOL}>
    <RequestSignaturesWorkerPanel tool={TOOL} />
  </InToolPage>
);

async function pdfFile(
  pages: number,
  opts: { encrypted?: boolean } = {},
): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([612, 792]);
  if (opts.encrypted) {
    doc.context.trailerInfo.Encrypt = doc.context.register(
      doc.context.obj({ Filter: "Standard", V: 1, R: 2, P: -4 }),
    );
  }
  const bytes = await doc.save({ useObjectStreams: false });
  return new File([new Uint8Array(bytes)], "contract.pdf", {
    type: "application/pdf",
  });
}

function pick(container: HTMLElement, file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the builder renders a file input").not.toBeNull();
  fireEvent.change(input!, { target: { files: [file] } });
}

const pageInput = () =>
  screen.getByLabelText(/Signature page/) as HTMLInputElement;

function addSigner() {
  fireEvent.change(screen.getByLabelText("Signer 1 name"), {
    target: { value: "Ada Lovelace" },
  });
  fireEvent.change(screen.getByLabelText("Signer 1 email"), {
    target: { value: "ada@example.com" },
  });
}

describe("clampSignaturePage", () => {
  it("keeps the page inside the document, and ≥ 1 while the count is unknown", () => {
    expect(clampSignaturePage(9, 3)).toBe(3);
    expect(clampSignaturePage(0, 3)).toBe(1);
    expect(clampSignaturePage(Number.NaN, 3)).toBe(1);
    expect(clampSignaturePage(2.7, 3)).toBe(2);
    expect(clampSignaturePage(40, null)).toBe(40);
  });
});

describe("RequestBuilder signature page", () => {
  it("defaults to the LAST page of the picked PDF and caps the input at its page count", async () => {
    const { container } = render(<Builder />);
    // Before a file, the default is page 1 with no known upper bound.
    expect(pageInput().value).toBe("1");

    pick(container, await pdfFile(3));
    await waitFor(() => expect(pageInput().value).toBe("3"), {
      timeout: WAIT_MS,
    });
    expect(pageInput().max).toBe("3");
    expect(screen.getByText("3 pages")).toBeInTheDocument();

    fireEvent.change(pageInput(), { target: { value: "9" } });
    expect(pageInput().value).toBe("3");
    fireEvent.change(pageInput(), { target: { value: "2" } });
    expect(pageInput().value).toBe("2");
  });

  it("previews the exact layout the request carries, on the chosen page", async () => {
    const { container } = render(<Builder />);
    pick(container, await pdfFile(2));
    await waitFor(() => expect(pageInput().value).toBe("2"), {
      timeout: WAIT_MS,
    });
    // No valid signer yet: nothing would be sent, so nothing is drawn.
    expect(screen.queryByTestId("signature-page-preview")).toBeNull();

    addSigner();
    const preview = await screen.findByTestId(
      "signature-page-preview",
      {},
      { timeout: WAIT_MS },
    );
    const boxes = [
      ...preview.querySelectorAll<HTMLElement>("[data-field-box]"),
    ];
    // Derived from the same function the request is built from (date on by default).
    const expected = signatureBlockFields(1, 2, true);
    expect(expected.length).toBeGreaterThan(0);
    expect(boxes).toHaveLength(expected.length);
    expected.forEach((field, i) => {
      expect(boxes[i]!.style.left).toBe(`${field.x * 100}%`);
      expect(boxes[i]!.style.bottom).toBe(`${field.y * 100}%`);
      expect(boxes[i]!.style.width).toBe(`${field.width * 100}%`);
      expect(boxes[i]!.style.height).toBe(`${field.height * 100}%`);
    });
    // Turning the date off redraws from the same function — a preview that kept
    // its own copy of the layout would still show the date boxes.
    fireEvent.click(screen.getByLabelText(/Add a date field/));
    const withoutDate = signatureBlockFields(1, 2, false);
    expect(withoutDate.length).toBeLessThan(expected.length);
    expect(preview.querySelectorAll("[data-field-box]")).toHaveLength(
      withoutDate.length,
    );
    // The sheet has the page's visible proportions (US Letter here).
    expect(preview.style.aspectRatio).toBe("612 / 792");
    // CHANGED 2026-11-17 (audit #21): the caption was "Page 2 — where each
    // signer's fields will be added."; the sheet is now the placement editor.
    expect(screen.getByText(/^Page 2 of 2\./)).toBeInTheDocument();
  });

  /**
   * INVERTED 2026-10-06, history kept. This was "blocks a password-protected
   * PDF", fed a bare trailer /Encrypt, and required the alert to say
   * "password-protected" — for EVERY encrypted file, because the notice was
   * driven by pdf-lib's `isEncrypted`, which is true of any /Encrypt entry.
   * So a bank statement that opens in every viewer with no prompt was called
   * password-protected here, while the loader (`@/lib/pdf/encryption`) called
   * the same bytes "restricted". The notice now asks the loader's probe, and
   * each lock is checked with a file that HAS that lock.
   */
  async function lockAlert(bytes: Uint8Array): Promise<HTMLElement> {
    const { container } = render(<Builder />);
    addSigner();
    pick(
      container,
      new File([bytes.slice()], "contract.pdf", { type: "application/pdf" }),
    );
    const alert = await screen.findByRole("alert", {}, { timeout: WAIT_MS });
    // Every lock blocks the run (the worker cannot add fields to it) and
    // offers the way out, to a tool the catalog actually ships.
    expect(
      screen.getByRole("button", { name: /Prepare signature request/ }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByTestId("signature-page-preview")).toBeNull();
    const link = screen.getByRole("link", { name: /Unlock PDF/ });
    expect(link.getAttribute("href")).toBe(UNLOCK_TOOL_HREF);
    const slug = UNLOCK_TOOL_HREF.replace(/^\/tools\//, "");
    expect(getToolBySlug(slug)?.name).toBe(UNLOCK_TOOL_NAME);
    return alert;
  }

  it("a PDF that opens without a password is not called password-protected", async () => {
    const alert = await lockAlert(ownerOnlyEncryptedPdf());
    expect(alert).toHaveTextContent(PDF_RESTRICTED_MESSAGE);
    expect(alert).not.toHaveTextContent(/password-protected/i);
    expect(alert).toHaveTextContent(/owner \(permissions\) password/);
  });

  it("positive control: a PDF that needs a password to open is called password-protected", async () => {
    const alert = await lockAlert(userPasswordEncryptedPdf());
    expect(alert).toHaveTextContent(PDF_NEEDS_PASSWORD_MESSAGE);
  });

  /**
   * ADDED 2026-10-08. Every fixture above uses a classic xref table, which
   * pdf-lib reads past encryption. A PDF 1.5+ writer puts the page tree in an
   * encrypted object stream, which pdf-lib cannot decrypt: `readPdfFrames`
   * returned null, the pick became "unreadable", nothing was shown, and the
   * run stayed enabled — so the file was uploaded and refused by the worker,
   * while the page promised the stop came before anything is uploaded.
   */
  it("health: pdf-lib cannot read the object-stream fixtures, and pdf.js can", async () => {
    for (const bytes of [
      ownerOnlyObjectStreamPdf(),
      userPasswordObjectStreamPdf(),
    ])
      expect(await readPdfFrames(bytes)).toBeNull();
  });

  it("an object-stream PDF that opens without a password is stopped before upload, as restricted", async () => {
    const alert = await lockAlert(ownerOnlyObjectStreamPdf());
    expect(alert).toHaveTextContent(PDF_RESTRICTED_MESSAGE);
    expect(alert).not.toHaveTextContent(/password-protected/i);
  });

  it("an object-stream PDF that needs a password is stopped before upload, as password-protected", async () => {
    const alert = await lockAlert(userPasswordObjectStreamPdf());
    expect(alert).toHaveTextContent(PDF_NEEDS_PASSWORD_MESSAGE);
  });

  it("an object-stream PDF under a handler pdf.js cannot decrypt is stopped with the sentence true of both kinds", async () => {
    expect(await readPdfFrames(unknownHandlerObjectStreamPdf())).toBeNull();
    const alert = await lockAlert(unknownHandlerObjectStreamPdf());
    expect(alert).toHaveTextContent(PDF_ENCRYPTED_UNKNOWN_MESSAGE);
  });

  it("control: a PDF no reader can open is left to the worker, not called locked", async () => {
    const { container } = render(<Builder />);
    addSigner();
    pick(
      container,
      new File([new TextEncoder().encode("%PDF-1.7 not really")], "x.pdf", {
        type: "application/pdf",
      }),
    );
    const button = screen.getByRole("button", {
      name: /Prepare signature request/,
    });
    await waitFor(
      () => expect(button).not.toHaveAttribute("aria-disabled", "true"),
      { timeout: WAIT_MS },
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a lock no reader can classify gets the sentence true of both kinds", async () => {
    const file = await pdfFile(2, { encrypted: true });
    const alert = await lockAlert(new Uint8Array(await file.arrayBuffer()));
    expect(alert).toHaveTextContent(PDF_ENCRYPTED_UNKNOWN_MESSAGE);
    expect(alert).not.toHaveTextContent(/password-protected/i);
  });

  it("control: an unlocked PDF with a signer is runnable and shows no lock alert", async () => {
    const { container } = render(<Builder />);
    addSigner();
    pick(container, await pdfFile(1));
    await screen.findByTestId(
      "signature-page-preview",
      {},
      { timeout: WAIT_MS },
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Prepare signature request/ }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });
});

/**
 * Audit #18 (2026-11-06). A row with a name and a mistyped email
 * ("b@x,com") was filtered out of the request without a word: the package
 * went out with one signer fewer, and the page's own How-to said so. The
 * inputs also had no length caps, so an over-long name uploaded the PDF and
 * was refused by the worker afterwards.
 */
describe("RequestBuilder signer rows", () => {
  function fillRow(index: number, name: string, email: string) {
    fireEvent.change(screen.getByLabelText(`Signer ${index} name`), {
      target: { value: name },
    });
    const emailInput = screen.getByLabelText(`Signer ${index} email`);
    fireEvent.change(emailInput, { target: { value: email } });
    fireEvent.blur(emailInput);
  }
  const runButton = () =>
    screen.getByRole("button", { name: /Prepare signature request/ });

  it("marks a row with a malformed email invalid and blocks Prepare, instead of dropping the signer", async () => {
    const { container } = render(<Builder />);
    pick(container, await pdfFile(1));
    fireEvent.click(screen.getByRole("button", { name: /Add signer/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add signer/ }));
    fillRow(1, "Ada Lovelace", "ada@example.com");
    fillRow(2, "Bob Typo", "b@x,com");
    fillRow(3, "Cy Valid", "cy@example.com");

    await waitFor(
      () =>
        expect(screen.getByLabelText("Signer 2 email")).toHaveAttribute(
          "aria-invalid",
          "true",
        ),
      { timeout: WAIT_MS },
    );
    expect(screen.getByLabelText("Signer 1 email")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    const email2 = screen.getByLabelText("Signer 2 email");
    const describedBy = email2.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(
      /valid email/i,
    );
    expect(runButton()).toHaveAttribute("aria-disabled", "true");

    // Fixing the row includes the signer: all three blocks are drawn.
    fillRow(2, "Bob Typo", "bob@example.com");
    await waitFor(
      () => expect(runButton()).not.toHaveAttribute("aria-disabled", "true"),
      { timeout: WAIT_MS },
    );
    const preview = await screen.findByTestId(
      "signature-page-preview",
      {},
      { timeout: WAIT_MS },
    );
    expect(preview.querySelectorAll("[data-field-box]")).toHaveLength(
      signatureBlockFields(3, 1, true).length,
    );
  });

  it("a row with an email and no name is invalid too, while an untouched blank row is not", async () => {
    const { container } = render(<Builder />);
    pick(container, await pdfFile(1));
    fireEvent.click(screen.getByRole("button", { name: /Add signer/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add signer/ }));
    fillRow(1, "Ada Lovelace", "ada@example.com");
    fillRow(2, "", "bob@example.com");
    await waitFor(
      () =>
        expect(screen.getByLabelText("Signer 2 name")).toHaveAttribute(
          "aria-invalid",
          "true",
        ),
      { timeout: WAIT_MS },
    );
    expect(runButton()).toHaveAttribute("aria-disabled", "true");
    // Row 3 was never filled: it is not a signer and not an error.
    expect(screen.getByLabelText("Signer 3 name")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove signer 2" }));
    await waitFor(
      () => expect(runButton()).not.toHaveAttribute("aria-disabled", "true"),
      { timeout: WAIT_MS },
    );
  });

  it("caps each input at the length the worker accepts", () => {
    render(<Builder />);
    expect(screen.getByLabelText("Signer 1 name")).toHaveAttribute(
      "maxLength",
      String(MAX_SIGNER_NAME_CHARS),
    );
    expect(screen.getByLabelText("Signer 1 email")).toHaveAttribute(
      "maxLength",
      String(MAX_SIGNER_EMAIL_CHARS),
    );
    expect(screen.getByLabelText(/Request title/)).toHaveAttribute(
      "maxLength",
      String(MAX_REQUEST_TITLE_CHARS),
    );
  });
});

/**
 * Audit #21 (2026-11-17): the reader places the boxes. Every assertion here is
 * made against the job options ON THE WIRE — the body the panel's own client
 * POSTs to /api/jobs, captured by the fetch stub — and against the boxes the
 * sheet draws, so "drawn = sent" is checked at the point of consumption, not
 * between two values the panel computed.
 */
describe("RequestBuilder placement (audit #21)", { timeout: 30_000 }, () => {
  interface WireBody {
    tool: string;
    options: {
      signers: { name: string; email: string }[];
      fields: RequestSignatureField[];
      message?: string;
      title?: string;
    };
  }
  let jobs: WireBody[] = [];

  beforeEach(() => {
    jobs = [];
    const reply = (status: number, value: unknown) => ({
      ok: status < 400,
      status,
      headers: new Headers(),
      json: async () => value,
      text: async () => JSON.stringify(value),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: { body?: unknown }) => {
        const url = String(input);
        if (url === "/api/uploads")
          return reply(200, {
            slots: [
              {
                fileId: "f_panelTest0001",
                filename: "contract.pdf",
                url: "https://upload.invalid/slot",
                method: "PUT",
                headers: {},
              },
            ],
          });
        if (url === "https://upload.invalid/slot") return reply(200, {});
        if (url === "/api/jobs") {
          // The body as sent: an ArrayBuffer of the JSON (`jsonBody`).
          const raw = init?.body;
          const text =
            typeof raw === "string"
              ? raw
              : new TextDecoder().decode(raw as ArrayBuffer);
          jobs.push(JSON.parse(text) as WireBody);
          return reply(400, { error: { code: "stop", message: "captured" } });
        }
        return reply(200, READY_WORKER_STATUS);
      }),
    );
  });
  afterEach(() => resetUploadedThisSessionForTests());

  const runButton = () =>
    screen.getByRole("button", { name: /Prepare signature request/ });

  async function prepare(): Promise<WireBody> {
    const before = jobs.length;
    await waitFor(
      () => expect(runButton()).not.toHaveAttribute("aria-disabled", "true"),
      { timeout: WAIT_MS },
    );
    fireEvent.click(runButton());
    await waitFor(() => expect(jobs.length).toBe(before + 1), {
      timeout: 20_000,
    });
    return jobs[jobs.length - 1]!;
  }

  async function ready(pages: number): Promise<HTMLElement> {
    const { container } = render(<Builder />);
    pick(container, await pdfFile(pages));
    addSigner();
    return screen.findByTestId(
      "signature-page-preview",
      {},
      { timeout: WAIT_MS },
    );
  }

  const boxes = (sheet: HTMLElement) => [
    ...sheet.querySelectorAll<HTMLElement>("[data-field-box]"),
  ];
  /**
   * What the sheet draws for a box, back in the contract's unit: its outline
   * (`[data-field-box]`), found from the box's button when given one — the
   * button is the outline grown to a 24 px target, so it is not the field.
   */
  const drawnOf = (el: HTMLElement) => {
    const outline = el.hasAttribute("data-field-box")
      ? el
      : el.parentElement!.querySelector<HTMLElement>(
          `[data-field-box][data-of="${el.getAttribute("data-box-id")}"]`,
        )!;
    return {
      x: parseFloat(outline.style.left) / 100,
      y: parseFloat(outline.style.bottom) / 100,
      width: parseFloat(outline.style.width) / 100,
      height: parseFloat(outline.style.height) / 100,
    };
  };
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const box = (name: RegExp) => screen.getByRole("button", { name });

  it("untouched: the wire carries exactly signatureBlockFields, as drawn, and no message", async () => {
    const sheet = await ready(2);
    const body = await prepare();
    expect(body.tool).toBe("request-signatures");
    expect(body.options.fields).toEqual(signatureBlockFields(1, 2, true));
    expect("message" in body.options).toBe(false);
    const drawn = boxes(sheet).map(drawnOf);
    body.options.fields.forEach((f, i) => {
      for (const k of ["x", "y", "width", "height"] as const)
        expect(close(drawn[i]![k], f[k]), `${i}.${k}`).toBe(true);
    });
  });

  it("keyboard: arrows move 1 pt, Shift+arrows 10 pt, Up is up; drawn = sent", async () => {
    const sheet = await ready(1);
    const [start] = signatureBlockFields(1, 1, true);
    const sig = box(/Signature box, page 1/);
    sig.focus();
    fireEvent.keyDown(sig, { key: "ArrowRight" });
    fireEvent.keyDown(box(/Signature box, page 1/), {
      key: "ArrowUp",
      shiftKey: true,
    });
    const body = await prepare();
    const sent = body.options.fields.find((f) => f.type === "signature")!;
    // Independent arithmetic: Letter is 612 x 792 pt; 4-decimal fractions.
    expect(sent.x).toBe(round4(start!.x + 1 / 612));
    expect(sent.y).toBe(round4(round4(start!.y) + 10 / 792));
    expect(sent.page).toBe(1);
    const drawn = drawnOf(
      boxes(sheet).find((b) => b.getAttribute("data-kind") === "signature")!,
    );
    for (const k of ["x", "y", "width", "height"] as const)
      expect(close(drawn[k], sent[k]), k).toBe(true);
    // The date box was not touched and is sent as it started.
    expect(body.options.fields.find((f) => f.type === "date")).toEqual(
      signatureBlockFields(1, 1, true)[1],
    );
  });

  it("touch drag: 30 px on a 300 px sheet moves the box a tenth of the page; a 2 px wobble is a tap", async () => {
    const sheet = await ready(1);
    sheet.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 300,
        height: 388,
        right: 300,
        bottom: 388,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const [start] = signatureBlockFields(1, 1, true);
    const at = { pointerId: 1, pointerType: "touch", button: 0 };
    // A tap: selects, does not move.
    let sig = box(/Signature box, page 1/);
    fireEvent.pointerDown(sig, { ...at, clientX: 100, clientY: 300 });
    fireEvent.pointerMove(sig, { ...at, clientX: 102, clientY: 300 });
    fireEvent.pointerUp(sig, { ...at, clientX: 102, clientY: 300 });
    sig = box(/Signature box, page 1/);
    expect(sig).toHaveAttribute("aria-pressed", "true");
    expect(drawnOf(sig).x).toBe(start!.x);
    // A drag.
    fireEvent.pointerDown(sig, { ...at, clientX: 100, clientY: 300 });
    fireEvent.pointerMove(sig, { ...at, clientX: 130, clientY: 300 });
    fireEvent.pointerUp(sig, { ...at, clientX: 130, clientY: 300 });
    const body = await prepare();
    const sent = body.options.fields.find((f) => f.type === "signature")!;
    expect(sent.x).toBe(round4(start!.x + 0.1));
    expect(sent.y).toBe(round4(start!.y));
  });

  it("the resize handle: Down makes the box taller with its displayed top fixed", async () => {
    await ready(1);
    const sig = box(/Signature box, page 1/);
    fireEvent.pointerDown(sig, {
      pointerId: 1,
      button: 0,
      clientX: 1,
      clientY: 1,
    });
    fireEvent.pointerUp(sig, {
      pointerId: 1,
      button: 0,
      clientX: 1,
      clientY: 1,
    });
    const before = drawnOf(box(/Signature box, page 1/));
    const handle = screen.getByRole("button", {
      name: "Resize Signer 1 Signature box",
    });
    fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: true });
    const body = await prepare();
    const sent = body.options.fields.find((f) => f.type === "signature")!;
    expect(sent.height).toBeGreaterThan(before.height);
    expect(sent.height - round4(before.height)).toBeCloseTo(10 / 792, 3);
    expect(sent.y + sent.height).toBeCloseTo(before.y + before.height, 4);
  });

  it("Delete removes a box and moves focus on; Undo restores it; Start over restores the starting layout", async () => {
    const sheet = await ready(1);
    expect(boxes(sheet)).toHaveLength(2);
    const sig = box(/Signature box, page 1/);
    sig.focus();
    fireEvent.keyDown(sig, { key: "Delete" });
    expect(boxes(sheet)).toHaveLength(1);
    await waitFor(
      () =>
        expect(document.activeElement?.getAttribute("aria-label")).toMatch(
          /Date box, page 1/,
        ),
      { timeout: WAIT_MS },
    );
    expect(screen.getByText("Removed Signer 1 Signature box")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(boxes(sheet)).toHaveLength(2);
    // Customise, then Start over: the starting block comes back exactly.
    fireEvent.keyDown(box(/Signature box, page 1/), { key: "ArrowLeft" });
    expect(screen.queryByLabelText(/Signature page/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText(/Signature page/)).toBeInTheDocument();
    const body = await prepare();
    expect(body.options.fields).toEqual(signatureBlockFields(1, 1, true));
  });

  it("Add a box adds each type for the chosen signer on the page shown; Name is a text box labelled Name", async () => {
    await ready(1);
    for (const name of ["Signature", "Initials", "Date", "Name", "Text"])
      fireEvent.click(screen.getByRole("button", { name }));
    const body = await prepare();
    const added = body.options.fields.slice(2);
    expect(
      added.map((f) => [f.type, f.label ?? null, f.signer, f.page]),
    ).toEqual([
      ["signature", null, 0, 1],
      ["initials", null, 0, 1],
      ["date", null, 0, 1],
      ["text", "Name", 0, 1],
      ["text", null, 0, 1],
    ]);
    for (const f of added) {
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.x + f.width).toBeLessThanOrEqual(1);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.y + f.height).toBeLessThanOrEqual(1);
    }
  });

  it(`49 boxes: Add still works; ${MAX_REQUEST_FIELDS}: the add buttons are blocked, with the reason`, async () => {
    await ready(1);
    const sig = () => screen.getByRole("button", { name: "Signature" });
    while (
      screen.queryByText(
        `Boxes (${MAX_REQUEST_FIELDS - 1} of ${MAX_REQUEST_FIELDS})`,
      ) === null
    )
      fireEvent.click(sig());
    expect(sig()).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(/can hold up to/)).toBeNull();
    fireEvent.click(sig());
    expect(
      screen.getByText(
        `Boxes (${MAX_REQUEST_FIELDS} of ${MAX_REQUEST_FIELDS})`,
      ),
    ).toBeInTheDocument();
    expect(sig()).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(
        `A request can hold up to ${MAX_REQUEST_FIELDS} boxes. Remove one to add another.`,
      ),
    ).toBeInTheDocument();
    fireEvent.click(sig());
    const body = await prepare();
    expect(body.options.fields).toHaveLength(MAX_REQUEST_FIELDS);
  });

  it("a box moved to another page is sent on that page; labels are sent as typed", async () => {
    await ready(3);
    fireEvent.change(screen.getByLabelText("Box 2 page"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Box 1 label"), {
      target: { value: "  Signed by  " },
    });
    expect(screen.getByLabelText("Box 1 label")).toHaveAttribute(
      "maxLength",
      String(MAX_FIELD_LABEL_CHARS),
    );
    const body = await prepare();
    expect(body.options.fields.map((f) => f.page).sort()).toEqual([1, 3]);
    expect(body.options.fields.filter((f) => f.label)).toHaveLength(1);
    expect(body.options.fields.find((f) => f.label)!.label).toBe("Signed by");
  });

  it("signers: a removed signer takes their boxes; a box whose row is blank blocks Prepare in words, never dropped", async () => {
    const sheet = await ready(1);
    fireEvent.click(screen.getByRole("button", { name: /Add signer/ }));
    fireEvent.change(screen.getByLabelText("Signer 2 name"), {
      target: { value: "Bob Builder" },
    });
    fireEvent.change(screen.getByLabelText("Signer 2 email"), {
      target: { value: "bob@example.com" },
    });
    await waitFor(() => expect(boxes(sheet)).toHaveLength(4), {
      timeout: WAIT_MS,
    });
    // Customise.
    fireEvent.keyDown(box(/Signer 1, Ada Lovelace, Signature box/), {
      key: "ArrowRight",
    });
    // Signer 2's row goes blank: their two boxes are orphans and block Prepare.
    fireEvent.change(screen.getByLabelText("Signer 2 name"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Signer 2 email"), {
      target: { value: "" },
    });
    expect(
      screen.getByText(
        "Boxes 1 and 2 belong to signer 2, who has no name or email yet. Fill in that row or remove those boxes.",
      ),
    ).toBeInTheDocument();
    expect(runButton()).toHaveAttribute("aria-disabled", "true");
    expect(boxes(sheet)).toHaveLength(4);
    // Removing the row removes their boxes, and Prepare sends signer 1's only.
    fireEvent.click(screen.getByRole("button", { name: "Remove signer 2" }));
    expect(boxes(sheet)).toHaveLength(2);
    const body = await prepare();
    expect(body.options.signers).toEqual([
      { name: "Ada Lovelace", email: "ada@example.com" },
    ]);
    expect(body.options.fields.every((f) => f.signer === 0)).toBe(true);
  });

  it("a signer completed while customised gets a signature box; one left with none blocks Prepare", async () => {
    const sheet = await ready(1);
    fireEvent.keyDown(box(/Signature box, page 1/), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: /Add signer/ }));
    fireEvent.change(screen.getByLabelText("Signer 2 name"), {
      target: { value: "Cy Valid" },
    });
    fireEvent.change(screen.getByLabelText("Signer 2 email"), {
      target: { value: "cy@example.com" },
    });
    await waitFor(() => expect(boxes(sheet)).toHaveLength(3), {
      timeout: WAIT_MS,
    });
    const mine = box(/Signer 2, Cy Valid, Signature box/);
    mine.focus();
    fireEvent.keyDown(mine, { key: "Delete" });
    expect(
      screen.getByText("Signer 2 has no box to fill in. Add one for them."),
    ).toBeInTheDocument();
    expect(runButton()).toHaveAttribute("aria-disabled", "true");
  });

  // Review findings, 2026-11-17. Each reproduces the reviewer's exact sequence.
  it(`${MAX_REQUEST_FIELDS} boxes, then a signer completed: no starter box past the limit; Prepare blocked in words`, async () => {
    const sheet = await ready(1);
    const sig = () => screen.getByRole("button", { name: "Signature" });
    while (
      screen.queryByText(
        `Boxes (${MAX_REQUEST_FIELDS} of ${MAX_REQUEST_FIELDS})`,
      ) === null
    )
      fireEvent.click(sig());
    fireEvent.click(screen.getByRole("button", { name: /Add signer/ }));
    fireEvent.change(screen.getByLabelText("Signer 2 name"), {
      target: { value: "Cy Valid" },
    });
    fireEvent.change(screen.getByLabelText("Signer 2 email"), {
      target: { value: "cy@example.com" },
    });
    // Was "Boxes (51 of 50)" with Prepare enabled; the worker refused it.
    expect(
      screen.getByText(
        `Boxes (${MAX_REQUEST_FIELDS} of ${MAX_REQUEST_FIELDS})`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Signer 2 has no box to fill in. Add one for them."),
    ).toBeInTheDocument();
    expect(runButton()).toHaveAttribute("aria-disabled", "true");
    expect(boxes(sheet).length).toBeLessThanOrEqual(MAX_REQUEST_FIELDS);
  });

  it("Undo never reaches past a later signer edit: the edit and the added row survive", async () => {
    const sheet = await ready(1);
    const sig = box(/Signature box, page 1/);
    sig.focus();
    fireEvent.keyDown(sig, { key: "Delete" });
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Signer 1 email"), {
      target: { value: "ada@corrected.example" },
    });
    // Was: Undo still offered, and it put back the old email and one row.
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    // And Add signer alone ends it too.
    const date0 = box(/Date box, page 1/);
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: /^Remove box \d+, Signer 1 Text box/,
      }),
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(date0).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add signer/ }));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.getByLabelText("Signer 1 email")).toHaveValue(
      "ada@corrected.example",
    );
    expect(screen.getByLabelText("Signer 2 name")).toBeInTheDocument();
    expect(boxes(sheet)).toHaveLength(1);
    // Control: a blur that only marks the row touched keeps Undo.
    const date = box(/Date box, page 1/);
    date.focus();
    fireEvent.keyDown(date, { key: "Delete" });
    fireEvent.blur(screen.getByLabelText("Signer 1 email"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(boxes(sheet)).toHaveLength(1);
  });

  it("Undo of a box Remove restores only the boxes; Undo of a signer removal restores the row", async () => {
    const sheet = await ready(1);
    fireEvent.click(screen.getByRole("button", { name: /Add signer/ }));
    fireEvent.change(screen.getByLabelText("Signer 2 name"), {
      target: { value: "Bob Builder" },
    });
    fireEvent.change(screen.getByLabelText("Signer 2 email"), {
      target: { value: "bob@example.com" },
    });
    await waitFor(() => expect(boxes(sheet)).toHaveLength(4), {
      timeout: WAIT_MS,
    });
    fireEvent.keyDown(box(/Signer 1, Ada Lovelace, Signature box/), {
      key: "ArrowRight",
    });
    const bin2 = screen.getByRole("button", { name: "Remove signer 2" });
    bin2.focus();
    fireEvent.click(bin2);
    expect(boxes(sheet)).toHaveLength(2);
    // The last row's bin is gone: focus is on a bin still there.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove signer 1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(boxes(sheet)).toHaveLength(4);
    expect(screen.getByLabelText("Signer 2 email")).toHaveValue(
      "bob@example.com",
    );
  });

  it("Start over, then Undo, then a signer edit: no extra box is handed out", async () => {
    const sheet = await ready(1);
    fireEvent.keyDown(box(/Signature box, page 1/), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(boxes(sheet)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Signer 1 name"), {
      target: { value: "Ada King" },
    });
    // Was 3 boxes, and ["signature", "date", "signature"] sent.
    expect(boxes(sheet)).toHaveLength(2);
    const body = await prepare();
    expect(body.options.fields.map((f) => f.type)).toEqual([
      "signature",
      "date",
    ]);
  });

  it("keyboard only: Enter/Space on a box presses its toggle, so the resize handle is reachable without a pointer", async () => {
    await ready(1);
    const handleName = "Resize Signer 1 Signature box";
    let sig = box(/Signature box, page 1/);
    sig.focus();
    // A keyboard press of a button is a click with detail 0.
    fireEvent.click(sig, { detail: 0 });
    sig = box(/Signature box, page 1/);
    expect(sig).toHaveAttribute("aria-pressed", "true");
    const handle = screen.getByRole("button", { name: handleName });
    handle.focus();
    const before = drawnOf(sig);
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(drawnOf(box(/Signature box, page 1/)).width).toBeGreaterThan(
      before.width,
    );
    // Pressed again from the keyboard, the toggle releases.
    fireEvent.click(box(/Signature box, page 1/), { detail: 0 });
    expect(box(/Signature box, page 1/)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("button", { name: handleName })).toBeNull();
  });

  it("focus: Undo lands on the box it restored, Start over on Undo, a list bin on the next row's bin", async () => {
    await ready(1);
    const sig = box(/Signature box, page 1/);
    sig.focus();
    fireEvent.keyDown(sig, { key: "Delete" });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(
      () =>
        expect(document.activeElement?.getAttribute("aria-label")).toMatch(
          /Signature box, page 1/,
        ),
      { timeout: WAIT_MS },
    );
    fireEvent.keyDown(box(/Signature box, page 1/), { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    await waitFor(
      () =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Undo" }),
        ),
      { timeout: WAIT_MS },
    );
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    const bins = () =>
      screen.getAllByRole("button", { name: /^Remove box \d+,/ });
    expect(bins()).toHaveLength(3);
    fireEvent.click(bins()[0]!);
    await waitFor(() => expect(document.activeElement).toBe(bins()[0]), {
      timeout: WAIT_MS,
    });
    // The last row's bin: focus goes to the row before.
    fireEvent.click(bins()[1]!);
    await waitFor(() => expect(document.activeElement).toBe(bins()[0]), {
      timeout: WAIT_MS,
    });
    fireEvent.click(bins()[0]!);
    await waitFor(
      () =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Signature" }),
        ),
      { timeout: WAIT_MS },
    );
    // The list's signer badge is drawn in the panel's text colour.
    fireEvent.click(screen.getByRole("button", { name: "Date" }));
    const row = document.querySelector<HTMLElement>("[data-box-row]")!;
    const badge = row.querySelector<HTMLElement>("span[aria-hidden]")!;
    expect(badge.className).toContain("text-fg");
    expect(badge.style.color).toBe("");
  });

  it("message: line breaks are sent as spaces, blank is not sent, counted and capped", async () => {
    await ready(1);
    const area = screen.getByLabelText(/Message to signers/);
    expect(area).toHaveAttribute(
      "maxLength",
      String(MAX_REQUEST_MESSAGE_CHARS),
    );
    const nl = String.fromCharCode(10);
    const tab = String.fromCharCode(9);
    fireEvent.change(area, { target: { value: `a${nl}b${tab}c` } });
    expect(screen.getByText(/5 of 1,000 characters/)).toBeInTheDocument();
    const body = await prepare();
    expect(body.options.message).toBe("a b c");
    fireEvent.change(area, { target: { value: `  ${nl} ` } });
    const blank = await prepare();
    expect("message" in blank.options).toBe(false);
  });

  it("the 8 KB options ceiling: blocked in words exactly when the server's own validator refuses the same object", async () => {
    const { container } = render(<Builder />);
    pick(container, await pdfFile(1));
    for (let i = 1; i <= MAX_REQUEST_SIGNERS; i += 1) {
      if (i > 1)
        fireEvent.click(screen.getByRole("button", { name: /Add signer/ }));
      fireEvent.change(screen.getByLabelText(`Signer ${i} name`), {
        target: { value: `${i}`.padEnd(MAX_SIGNER_NAME_CHARS, "n") },
      });
      fireEvent.change(screen.getByLabelText(`Signer ${i} email`), {
        target: { value: `${"e".repeat(230)}${i}@example.com` },
      });
    }
    await screen.findByTestId(
      "signature-page-preview",
      {},
      { timeout: WAIT_MS },
    );
    const empty = await prepare();
    const size = (o: unknown) =>
      new TextEncoder().encode(JSON.stringify(o)).byteLength;
    const base = size(empty.options);
    // `,"message":""` adds 13 bytes; fill the rest with a 3-byte character
    // (built from its code point) and ASCII, to land on the limit exactly.
    const room = JOB_LIMITS.maxOptionsBytes - base - 13;
    const euro = String.fromCodePoint(0x20ac);
    const threes = Math.floor(room / 3);
    const atLimit = euro.repeat(threes) + "m".repeat(room - threes * 3);
    expect(atLimit.length).toBeLessThanOrEqual(MAX_REQUEST_MESSAGE_CHARS);
    const message = screen.getByLabelText(/Message to signers/);
    fireEvent.change(message, { target: { value: atLimit } });
    const full = await prepare();
    // Health: the control really is AT the limit, and the server takes it.
    expect(size(full.options)).toBe(JOB_LIMITS.maxOptionsBytes);
    const accepted = parseCreateJobRequest(full);
    expect(
      accepted.ok,
      JSON.stringify(accepted.ok ? null : accepted.error.body),
    ).toBe(true);
    expect(screen.queryByText(TOO_LONG_SENTENCE)).toBeNull();
    // One byte more: the panel blocks, in words, and the server would refuse.
    fireEvent.change(message, { target: { value: `${atLimit}m` } });
    expect(screen.getByText(TOO_LONG_SENTENCE)).toBeInTheDocument();
    expect(runButton()).toHaveAttribute("aria-disabled", "true");
    const over = {
      ...full,
      options: { ...full.options, message: `${atLimit}m` },
    };
    expect(size(over.options)).toBe(JOB_LIMITS.maxOptionsBytes + 1);
    expect(parseCreateJobRequest(over).ok).toBe(false);
  });
});
