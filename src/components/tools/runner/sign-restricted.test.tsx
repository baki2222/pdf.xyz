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
import { afterEach, describe, expect, it } from "vitest";
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
