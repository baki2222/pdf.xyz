// @vitest-environment jsdom
// @native-canvas
/**
 * Sign PDF on a RESTRICTED file (audit sign-pdf#3): a PDF that opens without
 * a password but whose author set an owner password and withheld changes.
 *
 * Until 2026-11-08 Sign PDF — the same editor as Edit PDF, Annotate PDF and
 * Fill Forms — refused such a file at upload and sent it to Unlock PDF, which
 * uploads it to the server: the one document the person was about to sign,
 * off the device for no reason, while Edit PDF opened it in the browser. Now
 * it opens as it does there: the author's limits in force (a signature is
 * drawn into the page, so it needs the owner password), and the owner
 * password checked in the browser unlocks every tool.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { withAppRouter } from "@/tests/app-router";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  RESTRICTED_FIXTURES,
  SIGNED_RESTRICTED_FIXTURE,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { PDF_RESTRICTED_MESSAGE } from "@/lib/pdf/encryption";
import { getToolBySlug } from "@/lib/tools";
import { pageFaq, pageSteps, stepText } from "@/lib/tools/page-copy";
import { UNLOCKED_NOTE } from "./protection-banner";
import { SignRunner } from "./sign-runner";

afterEach(() => {
  cleanup();
});

const FIXTURE = RESTRICTED_FIXTURES[0]!;

async function dropRestricted() {
  const bytes = readRestrictedFixture(FIXTURE.file);
  const { container } = render(withAppRouter(<SignRunner />));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the dropzone's file input").not.toBeNull();
  fireEvent.change(input!, {
    target: {
      files: [
        new File([bytes.slice()], "contract.pdf", { type: "application/pdf" }),
      ],
    },
  });
  return container;
}

describe("sign-pdf: a PDF its author restricted", () => {
  it("opens in the editor with the author's limits, and the owner password unlocks signing in the browser", async () => {
    const container = await dropRestricted();
    await waitFor(
      () =>
        expect(
          container.querySelector('[data-protection-banner="restricted"]'),
          "the restricted banner",
        ).not.toBeNull(),
      { timeout: 10_000 },
    );
    expect(screen.queryByText(PDF_RESTRICTED_MESSAGE)).toBeNull();
    // Under the lock the Sign tool cannot draw into the page: the editor
    // opened on Select instead, and Sign is refused with the reason.
    expect(screen.queryByRole("tab", { name: "Draw" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Owner password"), {
      target: { value: FIXTURE.owner },
    });
    fireEvent.click(screen.getByRole("button", { name: /unlock all tools/i }));
    await screen.findByText(UNLOCKED_NOTE, {}, { timeout: 10_000 });

    // Unlocked: the Sign tool opens its panel.
    fireEvent.click(screen.getByRole("button", { name: /^sign\b/i }));
    await screen.findByRole("tab", { name: "Draw" }, { timeout: 8000 });
  }, 30_000);

  it("the page no longer sends a restricted file to the server: it says the owner password is checked here", () => {
    const tool = getToolBySlug("sign-pdf")!;
    const text = [
      ...pageFaq(tool).map((f) => f.answer),
      ...pageSteps(tool).map(stepText),
    ].join("\n");
    expect(text).toMatch(/opens here with the author's limits in force/);
    expect(text).toMatch(/owner password[^.]*checked in your browser/);
  });

  // Review of audit sign-pdf#3: the step promised "the signature panel open
  // above them" to every file, while a restricted one opens with no Draw tab
  // (above); and the FAQ said "restricted changes" while the lock holds for
  // ANY restriction, a printing-only one too.
  it("the step and FAQ say what a restricted file actually shows", () => {
    const tool = getToolBySlug("sign-pdf")!;
    const steps = pageSteps(tool).map(stepText).join(" ");
    expect(steps).toMatch(
      /carries its author's restrictions opens with those limits shown, and the Sign tool waits for its owner password/,
    );
    const faq = pageFaq(tool)
      .map((f) => f.answer)
      .join(" ");
    expect(faq).not.toMatch(/whose author restricted changes/);
    expect(faq).toMatch(
      /carries any restriction from its author \(on changes, printing, copying or anything else\) opens here/,
    );
  });
});

/*
 * Review of the w3 integration (2026-11-08): a file both restricted by its
 * author and certificate-signed. The FAQ says it is not countersigned by
 * appending — once its owner password unlocks it for signing, the copy is
 * written whole without the author's encryption, so the earlier signature no
 * longer verifies — and that a warning above the pages says so before the
 * person starts. Driven through the runner with a fixture qpdf/pypdf made.
 */
describe("sign-pdf: a PDF both restricted and certificate-signed", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns before signing that the signature will not verify, and writes the unlocked copy whole", async () => {
    const original = readRestrictedFixture(SIGNED_RESTRICTED_FIXTURE.file);
    // Health check: the fixture IS signed, as the runner's own scan sees it.
    expect(countDigitalSignatures(original)).toBe(1);
    const blobs: Blob[] = [];
    const realCreate = URL.createObjectURL;
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      if (b instanceof Blob && b.type === "application/pdf") blobs.push(b);
      return realCreate ? realCreate.call(URL, b) : "blob:mock";
    });
    const { container } = render(withAppRouter(<SignRunner />));
    fireEvent.change(
      container.querySelector<HTMLInputElement>('input[type="file"]')!,
      {
        target: {
          files: [
            new File([original.slice()], "contract.pdf", {
              type: "application/pdf",
            }),
          ],
        },
      },
    );
    await waitFor(
      () =>
        expect(
          container.querySelector('[data-protection-banner="restricted"]'),
        ).not.toBeNull(),
      { timeout: 10_000 },
    );
    // The runner's "will no longer verify" warning, not the countersign one.
    const notice = container.querySelector("[data-signed-input-notice]");
    expect(notice, "a signed-input notice above the pages").not.toBeNull();
    expect(notice!.getAttribute("data-signed-input-notice")).not.toBe(
      "appended",
    );
    expect(notice!.textContent).toMatch(/will no longer verify/);

    fireEvent.change(screen.getByLabelText("Owner password"), {
      target: { value: SIGNED_RESTRICTED_FIXTURE.owner },
    });
    fireEvent.click(screen.getByRole("button", { name: /unlock all tools/i }));
    await screen.findByText(UNLOCKED_NOTE, {}, { timeout: 10_000 });
    fireEvent.click(screen.getByRole("button", { name: /^sign\b/i }));
    await screen.findByRole("tab", { name: "Type" }, { timeout: 8000 });
    fireEvent.click(screen.getByRole("tab", { name: "Type" }));
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use signature" }));
    const page1 = await screen.findByRole(
      "group",
      { name: /^Page 1 of/ },
      { timeout: 8000 },
    );
    const apply = () =>
      screen.getByRole("button", { name: /Apply & download/ });
    await vi.waitFor(() => {
      if (
        apply().hasAttribute("disabled") ||
        apply().getAttribute("aria-disabled") === "true"
      )
        fireEvent.pointerDown(page1, { button: 0, clientX: 5, clientY: 5 });
      expect(apply().hasAttribute("disabled")).toBe(false);
      expect(apply().getAttribute("aria-disabled")).not.toBe("true");
    });
    fireEvent.click(apply());
    await vi.waitFor(() => expect(blobs.length).toBeGreaterThan(0), {
      timeout: 15000,
    });
    const out = new Uint8Array(await blobs.at(-1)!.arrayBuffer());

    // Written whole: the signed original is not the output's prefix, the
    // output is one revision, and it carries no encryption dictionary.
    expect(
      out.length >= original.length &&
        out.subarray(0, original.length).every((v, i) => v === original[i]),
    ).toBe(false);
    const text = new TextDecoder("latin1").decode(out);
    expect(text.match(/%%EOF/g)).toHaveLength(1);
    expect(text).not.toMatch(/\/Encrypt\b/);
    // And the signature was drawn into it.
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(SIGNED_RESTRICTED_FIXTURE.pageCount);
  }, 60_000);

  // The FAQ sentence the test above holds true. Scoped to SIGNING: a
  // comment-only save before the unlock goes through the author's own
  // encryption as an incremental update, so "is not appended to" (the
  // integration's first wording) was false on that path.
  it("the FAQ scopes the whole-copy sentence to signing", () => {
    const faq = pageFaq(getToolBySlug("sign-pdf")!)
      .map((f) => f.answer)
      .join(" ");
    expect(faq).toMatch(
      /both restricted by its author and certificate-signed is not countersigned by appending: once its owner password unlocks it for signing, the copy is written whole[^.]*a warning above the pages says so/,
    );
    expect(faq).not.toMatch(/certificate-signed is not appended to/);
  });
});
