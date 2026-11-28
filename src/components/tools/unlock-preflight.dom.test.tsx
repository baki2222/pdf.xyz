// @vitest-environment jsdom
// @native-canvas
/**
 * Unlock PDF looks at the file in the browser before it uploads anything
 * (audit unlock-pdf#1). Until 2026-11-22 only the batch did: the single-file
 * panel uploaded up to 100 MB, with the password, only for our server to say
 * the file was not locked, or that the password was a typo.
 *
 *  - a PDF that is not locked is reported at once, and nothing is sent;
 *  - a file that opens freely but is restricted asks for its OWNER password,
 *    by name, in the field's label;
 *  - a wrong open password is caught in the browser, and nothing is sent;
 *  - the right password uploads, as before (the control);
 *  - a password the browser must not judge (non-ASCII) and a file it cannot
 *    read go to our server, as before (the other controls).
 *
 * Every count of what was sent is the REAL job client over the stubbed
 * network (`stubJobNetwork`), so "nothing is sent" is measured at the wire
 * the client meets, and a control in each group shows the same counter
 * moving.
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
import { PDFDocument } from "pdf-lib";
import { getToolBySlug } from "@/lib/tools";
import { resetTelemetry } from "@/lib/telemetry/track";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { resetUnsavedForTests } from "@/lib/intent/unsaved";
import {
  OWNER_ONLY_PDF_BASE64,
  USER_PASSWORD_PDF_BASE64,
} from "@/tests/fixtures-encrypted";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import {
  stubJobNetwork,
  type JobNetwork,
  type StubbedJobOutcome,
} from "@/tests/stub-job-network";
import { PdfSecurityWorkerPanel } from "./pdf-security-worker-panel";
import {
  UNLOCK_NOT_LOCKED_LINE,
  UNLOCK_OWNER_PASSWORD_LABEL,
  UNLOCK_WRONG_PASSWORD_LINE,
} from "./unlock-preflight";

afterEach(() => {
  cleanup();
  resetTelemetry();
  resetAnnouncer();
  resetUnsavedForTests();
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const completed: StubbedJobOutcome = {
  status: "completed",
  artifact: {
    artifact: {
      artifactId: "art_1",
      filename: "locked-unlocked.pdf",
      contentType: "application/pdf",
      bytes: 8,
      url: "/__art/1",
      expiresAt: new Date(0).toISOString(),
    },
    bytes: new TextEncoder().encode("%PDF-out"),
  },
};

async function plainPdf(): Promise<File> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return new File([(await doc.save()) as BlobPart], "plain.pdf", {
    type: "application/pdf",
  });
}

const fromBase64 = (base64: string, name: string) =>
  new File([Buffer.from(base64, "base64")], name, { type: "application/pdf" });

/** Requests that carried the file or started a job. */
const sentAnything = (wire: JobNetwork) =>
  wire.uploads() + wire.jobBodies.length;

async function pick(file: File) {
  const wire = stubJobNetwork(READY_WORKER_STATUS, () => completed);
  const tool = getToolBySlug("unlock-pdf")!;
  render(
    <InToolPage tool={tool}>
      <PdfSecurityWorkerPanel tool={tool} />
    </InToolPage>,
  );
  const input = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(el).not.toBeNull();
    return el!;
  });
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText(file.name);
  return wire;
}

const field = () =>
  document.getElementById("pdf-security-password") as HTMLInputElement;
const hint = () => document.getElementById("pdf-security-password-hint")!;
const runButton = () => screen.getByRole("button", { name: "Unlock PDF" });

function typePassword(value: string) {
  fireEvent.change(field(), { target: { value } });
}

async function pressRun() {
  const button = runButton();
  fireEvent.click(button);
}

describe("a PDF that is not locked", () => {
  it("is reported at once, Run stays off, and nothing is sent", async () => {
    const wire = await pick(await plainPdf());
    const line = await screen.findByText(UNLOCK_NOT_LOCKED_LINE);
    expect(line).toBeVisible();
    typePassword("anything");
    await waitFor(() =>
      expect(runButton()).toHaveAttribute("aria-disabled", "true"),
    );
    await pressRun();
    expect(sentAnything(wire)).toBe(0);
    // Still said, and still nothing sent, after the press.
    expect(screen.getByText(UNLOCK_NOT_LOCKED_LINE)).toBeVisible();
    expect(sentAnything(wire)).toBe(0);
  });
});

describe("a PDF that opens freely but is restricted", () => {
  it("asks for its owner (permissions) password by name", async () => {
    await pick(fromBase64(OWNER_ONLY_PDF_BASE64, "restricted.pdf"));
    await waitFor(() =>
      expect(field().labels?.[0]?.textContent).toBe(
        UNLOCK_OWNER_PASSWORD_LABEL,
      ),
    );
    expect(hint().textContent).toMatch(/owner \(permissions\) password/);
    expect(screen.queryByText(UNLOCK_NOT_LOCKED_LINE)).toBeNull();
  });
});

describe("a PDF that needs a password to open", () => {
  const locked = () => fromBase64(USER_PASSWORD_PDF_BASE64, "locked.pdf");

  it("control: before a file the field is the current password", async () => {
    stubJobNetwork(READY_WORKER_STATUS);
    const tool = getToolBySlug("unlock-pdf")!;
    render(
      <InToolPage tool={tool}>
        <PdfSecurityWorkerPanel tool={tool} />
      </InToolPage>,
    );
    await waitFor(() => expect(field()).not.toBeNull());
    expect(field().labels?.[0]?.textContent).toBe("Current password");
  });

  it("a wrong password is caught in the browser, said inline, and nothing is sent", async () => {
    const wire = await pick(locked());
    expect(field().labels?.[0]?.textContent).toBe("Current password");
    typePassword("nope");
    await waitFor(() =>
      expect(runButton()).not.toHaveAttribute("aria-disabled"),
    );
    await pressRun();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(UNLOCK_WRONG_PASSWORD_LINE);
    expect(alert.id).toBe("pdf-security-password-hint");
    expect(sentAnything(wire)).toBe(0);
    // Editing the password clears the refusal.
    typePassword("nope2");
    await waitFor(() =>
      expect(screen.queryByText(UNLOCK_WRONG_PASSWORD_LINE)).toBeNull(),
    );
  });

  it("control: the right password uploads and the job runs", async () => {
    const wire = await pick(locked());
    typePassword("open-sesame");
    await waitFor(() =>
      expect(runButton()).not.toHaveAttribute("aria-disabled"),
    );
    await pressRun();
    await screen.findByText("Your PDF is unlocked and ready.", undefined, {
      timeout: 10_000,
    });
    expect(wire.uploads()).toBe(1);
    expect(wire.jobBodies).toHaveLength(1);
    expect(wire.jobBodies[0]!.tool).toBe("unlock-pdf");
    expect(screen.queryByText(UNLOCK_WRONG_PASSWORD_LINE)).toBeNull();
  });

  it("control: a non-ASCII password the browser must not judge goes to our server", async () => {
    const wire = await pick(locked());
    typePassword("öpen-sesame");
    await waitFor(() =>
      expect(runButton()).not.toHaveAttribute("aria-disabled"),
    );
    await pressRun();
    await waitFor(() => expect(wire.jobBodies).toHaveLength(1), {
      timeout: 10_000,
    });
    expect(screen.queryByText(UNLOCK_WRONG_PASSWORD_LINE)).toBeNull();
  });
});

describe("a file the browser cannot read", () => {
  it("control: goes to our server as before, which decides", async () => {
    const wire = await pick(
      new File(["%PDF-1.7 not really a pdf %%EOF"], "odd.pdf", {
        type: "application/pdf",
      }),
    );
    typePassword("nope");
    await waitFor(() =>
      expect(runButton()).not.toHaveAttribute("aria-disabled"),
    );
    await pressRun();
    await waitFor(() => expect(wire.jobBodies).toHaveLength(1), {
      timeout: 10_000,
    });
    expect(screen.queryByText(UNLOCK_NOT_LOCKED_LINE)).toBeNull();
  });
});

describe("the page says what the panel does", () => {
  it("the steps name the relabelled field and the browser check", async () => {
    const { pageSteps, stepText } = await import("@/lib/tools/page-copy");
    const tool = getToolBySlug("unlock-pdf")!;
    const steps = pageSteps(tool).map(stepText).join(" ");
    expect(steps).toContain(UNLOCK_OWNER_PASSWORD_LABEL);
    expect(steps).toMatch(/checks the file first, without sending it/);
    expect(steps).toMatch(/stops there and sends nothing/);
  });

  // Review 2026-11-28 finding 13: an answer still called the field
  // "Current password" for a restricted file, which the panel now labels
  // with the owner label. Any answer naming the default label must name
  // the relabel too.
  it("an FAQ answer that names Current password also names the owner label", async () => {
    const { default: content } = await import("@/lib/tools/content/unlock-pdf");
    const naming = content.faqs.filter((f) =>
      /Current password|password field is blank/.test(f.a),
    );
    expect(naming.length).toBeGreaterThanOrEqual(1);
    for (const f of naming) expect(f.a).toContain(UNLOCK_OWNER_PASSWORD_LABEL);
  });
});
