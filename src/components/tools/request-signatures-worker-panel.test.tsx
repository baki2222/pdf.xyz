// @vitest-environment jsdom
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
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { getToolBySlug } from "@/lib/tools";
import { signatureBlockFields } from "@/lib/jobs/request-signatures";
import { pickRefusal } from "@/lib/uploads/pick-check";
import {
  PDF_ENCRYPTED_UNKNOWN_MESSAGE,
  PDF_NEEDS_PASSWORD_MESSAGE,
  PDF_RESTRICTED_MESSAGE,
  UNLOCK_TOOL_HREF,
  UNLOCK_TOOL_NAME,
} from "@/lib/pdf/encryption";
import {
  ownerOnlyEncryptedPdf,
  userPasswordEncryptedPdf,
} from "@/tests/encrypted-pdf-fixture";
import {
  RequestBuilder,
  clampSignaturePage,
} from "./request-signatures-worker-panel";

afterEach(() => {
  cleanup();
});

/** The panel's own pick refusal, so the builder is driven as the panel mounts it. */
const refuse = (file: File) =>
  pickRefusal(getToolBySlug("request-signatures")!, file);

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
    const { container } = render(<RequestBuilder refuse={refuse} />);
    // Before a file, the default is page 1 with no known upper bound.
    expect(pageInput().value).toBe("1");

    pick(container, await pdfFile(3));
    await waitFor(() => expect(pageInput().value).toBe("3"));
    expect(pageInput().max).toBe("3");
    expect(screen.getByText("3 pages")).toBeInTheDocument();

    fireEvent.change(pageInput(), { target: { value: "9" } });
    expect(pageInput().value).toBe("3");
    fireEvent.change(pageInput(), { target: { value: "2" } });
    expect(pageInput().value).toBe("2");
  });

  it("previews the exact layout the request carries, on the chosen page", async () => {
    const { container } = render(<RequestBuilder refuse={refuse} />);
    pick(container, await pdfFile(2));
    await waitFor(() => expect(pageInput().value).toBe("2"));
    // No valid signer yet: nothing would be sent, so nothing is drawn.
    expect(screen.queryByTestId("signature-page-preview")).toBeNull();

    addSigner();
    const preview = await screen.findByTestId("signature-page-preview");
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
    expect(screen.getByText(/Page 2 —/)).toBeInTheDocument();
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
    const { container } = render(<RequestBuilder refuse={refuse} />);
    addSigner();
    pick(
      container,
      new File([bytes.slice()], "contract.pdf", { type: "application/pdf" }),
    );
    const alert = await screen.findByRole("alert");
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

  it("a lock no reader can classify gets the sentence true of both kinds", async () => {
    const file = await pdfFile(2, { encrypted: true });
    const alert = await lockAlert(new Uint8Array(await file.arrayBuffer()));
    expect(alert).toHaveTextContent(PDF_ENCRYPTED_UNKNOWN_MESSAGE);
    expect(alert).not.toHaveTextContent(/password-protected/i);
  });

  it("control: an unlocked PDF with a signer is runnable and shows no lock alert", async () => {
    const { container } = render(<RequestBuilder refuse={refuse} />);
    addSigner();
    pick(container, await pdfFile(1));
    await screen.findByTestId("signature-page-preview");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Prepare signature request/ }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });
});
