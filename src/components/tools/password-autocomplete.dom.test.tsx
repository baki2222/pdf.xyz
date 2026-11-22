// @vitest-environment jsdom
// @native-canvas
/**
 * A field that asks for an EXISTING password must not tell the browser it is
 * a new one (audit unlock-pdf#5).
 *
 * Unlock's "Current password" field, single and batch, carried
 * `autocomplete="new-password"` — the sign-up hint, on which Chrome and
 * Safari offer "Use suggested strong password" and then offer to save it.
 * That suggestion can never open a file someone else locked. Unlock now
 * says `off`; Protect, which really does set a new password, keeps
 * `new-password` (the control).
 *
 * Every password input each form renders is read, so a field added later
 * is in the set without being named here.
 */
import { InToolPage } from "@/tests/in-tool-page";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { getToolBySlug } from "@/lib/tools";
import { resetTelemetry } from "@/lib/telemetry/track";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import { stubJobNetwork } from "@/tests/stub-job-network";
import { PdfSecurityWorkerPanel } from "./pdf-security-worker-panel";
import { BATCH_VIEW_LOADED } from "./runner/batch/batch-view";

afterEach(() => {
  cleanup();
  resetTelemetry();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function plainPdf(name: string): Promise<File> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return new File([(await doc.save()) as BlobPart], `${name}.pdf`, {
    type: "application/pdf",
  });
}

type Slug = "protect-pdf" | "unlock-pdf";

function renderPanel(slug: Slug) {
  stubJobNetwork(READY_WORKER_STATUS);
  const tool = getToolBySlug(slug)!;
  return render(
    <InToolPage tool={tool}>
      <PdfSecurityWorkerPanel tool={tool} />
    </InToolPage>,
  );
}

/** label text → autocomplete, for every password-type input in `root`. */
function passwordFields(root: ParentNode): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const input of root.querySelectorAll<HTMLInputElement>(
    'input[type="password"]',
  ))
    out[input.labels?.[0]?.textContent ?? input.id] =
      input.getAttribute("autocomplete");
  return out;
}

async function singleForm(slug: Slug) {
  const view = renderPanel(slug);
  await waitFor(() =>
    expect(document.getElementById("pdf-security-password")).not.toBeNull(),
  );
  return passwordFields(view.container);
}

async function batchForm(slug: Slug) {
  const view = renderPanel(slug);
  const input = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(el).not.toBeNull();
    return el!;
  });
  fireEvent.change(input, {
    target: { files: [await plainPdf("a"), await plainPdf("b")] },
  });
  await waitFor(() =>
    expect(
      view.container.querySelector(`[data-chunk="${BATCH_VIEW_LOADED}"]`),
    ).not.toBeNull(),
  );
  await waitFor(() =>
    expect(document.getElementById("security-batch-password")).not.toBeNull(),
  );
  return passwordFields(view.container);
}

describe("Unlock's existing-password fields are not marked new-password", () => {
  it("single file: Unlock's field says off", async () => {
    const fields = await singleForm("unlock-pdf");
    expect(Object.keys(fields)).toEqual(["Current password"]);
    expect(fields["Current password"]).toBe("off");
  });

  it("batch: Unlock's field says off", async () => {
    const fields = await batchForm("unlock-pdf");
    expect(Object.keys(fields)).toEqual(["Current password"]);
    expect(fields["Current password"]).toBe("off");
  });

  it("control, single file: every Protect field still says new-password", async () => {
    const fields = await singleForm("protect-pdf");
    expect(Object.keys(fields)).toEqual(["New password", "Confirm password"]);
    for (const value of Object.values(fields))
      expect(value).toBe("new-password");
  });

  it("control, batch: every Protect field still says new-password", async () => {
    const fields = await batchForm("protect-pdf");
    expect(Object.keys(fields)).toEqual(["New password", "Confirm password"]);
    for (const value of Object.values(fields))
      expect(value).toBe("new-password");
  });
});
