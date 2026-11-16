// @vitest-environment jsdom
/**
 * The notice a partial delivery has to produce, and the silence a complete one
 * has to keep.
 *
 * Both directions matter equally here. A notice that never appeared would leave
 * the panel saying "ready" over a job that delivered eight of twelve pages —
 * the defect this exists to fix. A notice that appeared on every job would
 * teach people to ignore it, which is the same defect one release later.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeliveryNotice } from "./delivery-notice";
import type { Job } from "@/lib/jobs/types";
import type { AiDeliveryMeta } from "@/lib/jobs/ai-results";
import { WITHHELD_UNDERCOUNT_SENTENCE } from "@/lib/jobs/translate-withheld-copy";

function job(delivery?: AiDeliveryMeta): Job {
  return {
    jobId: "job_test000001",
    tool: "translate-pdf",
    capability: "ai",
    status: "completed",
    progress: 100,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    expiresAt: "2100-01-01T00:00:00.000Z",
    retention: {
      inputTtlMinutes: 60,
      outputTtlMinutes: 60,
      persistsAfterJob: false,
    },
    results: {
      ai: {
        truncation: {
          truncated: false,
          charactersSent: 100,
          charactersTotal: 100,
          totalPages: 12,
          lastCompletePage: 12,
          cutMidPage: false,
        },
        ...(delivery ? { delivery } : {}),
      },
    },
  };
}

describe("DeliveryNotice", () => {
  it("states the count when pages were withheld", () => {
    render(
      <DeliveryNotice
        job={job({
          deliveredPages: 8,
          withheldPages: 4,
          boundBy: "characters",
        })}
      />,
    );
    // The fact first: a reader needs to know how much of their document came
    // back before they need to know why.
    expect(screen.getByText(/Translated 8 of 12 pages/)).toBeInTheDocument();
  });

  it("names the ALLOWANCE bound, and offers no step that cannot work", () => {
    render(
      <DeliveryNotice
        job={job({
          deliveredPages: 8,
          withheldPages: 4,
          boundBy: "characters",
        })}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/allowance/i);
    // INVERTED 2026-11-17: this required "separate document", the advice the
    // notice gave. A rerun of those pages is declared by the same browser
    // count and is refused the same way
    // (`translate-withheld-remedy.chain.test.ts`), so the notice now says
    // what happened, in the package marker's words, and no longer advises it.
    expect(text).toContain(WITHHELD_UNDERCOUNT_SENTENCE);
    expect(text).not.toMatch(/separate document/i);
  });

  it("names the PAGE bound differently, because the action differs", () => {
    // An exhausted reservation means "translate the rest separately"; a page
    // bound means the document is not what was declared. Collapsing the two
    // would leave a reader with a number and nowhere to go.
    render(
      <DeliveryNotice
        job={job({ deliveredPages: 2, withheldPages: 10, boundBy: "pages" })}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/more pages of text than were declared/i);
    expect(text).not.toMatch(/allowance/i);
  });

  it("is ANNOUNCED, not just drawn", () => {
    // The panel's own announcement is what a screen reader speaks. This block
    // carries `role=status` for the same reason: a visual-only disclosure is
    // not a disclosure for everyone.
    render(
      <DeliveryNotice
        job={job({ deliveredPages: 8, withheldPages: 4, boundBy: "pages" })}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("CONTROL: renders nothing for a complete delivery", () => {
    const { container } = render(<DeliveryNotice job={job()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("CONTROL: renders nothing when there is no job at all", () => {
    const { container } = render(<DeliveryNotice job={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("CONTROL: renders nothing for a zero withholding that slipped through", () => {
    // `buildAiResultMeta` drops this at the persistence boundary, so it should
    // be unreachable — belt and braces at the surface that would otherwise
    // announce a partial delivery of nothing.
    const { container } = render(
      <DeliveryNotice
        job={job({ deliveredPages: 12, withheldPages: 0, boundBy: "pages" })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
