// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  ENCRYPTED_PDF_MESSAGES,
  UNLOCK_TOOL_HREF,
  UNLOCK_TOOL_NAME,
} from "@/lib/pdf/encryption";
import { PdfEncryptedError, UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine";
import { ErrorNote, errorMessage } from "./runner-kit";

/**
 * An encrypted-file error sent the user to "Unlock PDF" as a name to go and
 * find. What the user reads is the rendered note, so this renders it: every
 * encrypted-file sentence, through the same `errorMessage` the runners use,
 * must arrive with a working link to the tool it names.
 */
afterEach(cleanup);

describe("ErrorNote offers the way out of an encrypted-file error", () => {
  const messages = [
    ...ENCRYPTED_PDF_MESSAGES,
    // The overlay loader's variant of the same verdicts.
    ...ENCRYPTED_PDF_MESSAGES.map((m) =>
      m.replace(/^This PDF/, "The overlay PDF"),
    ),
  ];

  it.each(messages)("%s", (message) => {
    const verdictMessage = errorMessage(new PdfEncryptedError(null, message));
    render(<ErrorNote message={verdictMessage} />);
    const link = screen.getByRole("link", { name: `Open ${UNLOCK_TOOL_NAME}` });
    expect(link.getAttribute("href")).toBe(UNLOCK_TOOL_HREF);
  });

  it("control: an unrelated error carries no link", () => {
    render(<ErrorNote message={UNREADABLE_PDF_MESSAGE} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
