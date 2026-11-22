// @vitest-environment jsdom
/**
 * The note beside an EPUB to PDF download says what the job did with the
 * book's extra sections and its fonts (audit epub-to-pdf#3 and #4,
 * 2026-11-06) — built from the job's own counts, never from a static promise.
 *
 * THE COMPOSED CHAIN, not the units: the real processor (with a stand-in
 * printer, one page per chapter) → its `results` → the persistence boundary
 * (`sanitizeJobResults`) → the note the page renders. Each hop could drop the
 * block alone and every unit test would still pass.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createEpubRenderProcessor } from "@/lib/workers/processor/epub";
import type { EpubRenderDeps } from "@/lib/workers/epub/engine";
import { sanitizeJobResults } from "@/lib/jobs/results";
import type { Job } from "@/lib/jobs/types";
import { epub3Book, obfuscatedRealFontBook } from "@/tests/epub-fixtures";
import { EpubResultNote } from "./epub-result-note";

afterEach(cleanup);

const deps: EpubRenderDeps = {
  chromium: {
    renderPackage: async (pkg) => {
      const { PDFDocument } = await import("pdf-lib");
      return Promise.all(
        pkg.documents.map(async () => {
          const doc = await PDFDocument.create();
          doc.addPage([300, 400]);
          return doc.save();
        }),
      );
    },
  },
  limits: { maxInputBytes: 50 * 1024 * 1024, timeoutMs: 60_000 },
};

/** The job record the page reads, as the real chain builds it. */
async function jobFor(bytes: Uint8Array): Promise<Job> {
  const result = await createEpubRenderProcessor(deps).process({
    tool: "epub-to-pdf",
    options: {},
    inputs: [
      {
        fileId: "f1",
        filename: "book.epub",
        contentType: "application/epub+zip",
        bytes,
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  return { results: sanitizeJobResults(result.results) } as unknown as Job;
}

describe("the EPUB note beside the download", () => {
  it("counts the extra sections printed after the last chapter", async () => {
    const job = await jobFor(await epub3Book({ nonLinearNotes: true }));
    expect(job.results?.epub).toMatchObject({ chapters: 4, extraSections: 1 });
    render(<EpubResultNote job={job} />);
    expect(screen.getByRole("status").textContent).toBe(
      "1 extra section the book keeps outside its reading order, such as notes or answers, is printed at the end, after the last chapter.",
    );
  }, 30_000);

  it("counts the fonts that could not be used", async () => {
    const job = await jobFor(
      await obfuscatedRealFontBook(
        "idpf",
        "urn:uuid:00000000-0000-4000-8000-000000000000",
      ),
    );
    render(<EpubResultNote job={job} />);
    expect(screen.getByRole("status").textContent).toBe(
      "1 of the book's fonts could not be used, so the text set in it prints in a standard font.",
    );
  }, 30_000);

  it("says nothing for a book printed whole in its own fonts (positive control: the block IS there)", async () => {
    const job = await jobFor(await obfuscatedRealFontBook("adobe"));
    // The block reached the record, so silence is the note's decision.
    expect(job.results?.epub).toEqual({
      chapters: 3,
      extraSections: 0,
      fontsRestored: 1,
      fontsLeftOut: 0,
    });
    const { container } = render(<EpubResultNote job={job} />);
    expect(container.textContent).toBe("");
  }, 30_000);

  it("a job from a worker that did not report has no note", () => {
    const { container } = render(
      <EpubResultNote job={{ results: undefined } as unknown as Job} />,
    );
    expect(container.textContent).toBe("");
  });
});
