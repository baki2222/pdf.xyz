// @vitest-environment node
/**
 * The words a file row shows for what was measured, and the ticket's line
 * about all its files — read off real facts, every number a field of them.
 *
 * Two surfaces read these (the workspace's staged rows and the ticket), so a
 * wording that drifted would drift in both; the corpus below is every branch.
 */
import { describe, expect, it } from "vitest";
import type { PdfProbe } from "@/lib/pdf/probe-result";
import { quickFacts, type FileFacts } from "./facts";
import { factWords, MEASURING, pagesOf } from "./fact-words";
import { isPlainClick, acceptsHref, toolHref } from "./links";
import { ticketSummary } from "./ticket-summary";

const probe = (over: Partial<PdfProbe> = {}): PdfProbe => ({
  read: "ok",
  lock: "none",
  pages: 3,
  formFields: 0,
  sample: ["text"],
  ...over,
});
const pdf = (p: PdfProbe | "pending" | "limit", name = "a.pdf"): FileFacts => ({
  ...quickFacts({ name, size: 2048, type: "application/pdf" }, name),
  bytes: "PDF",
  pdf:
    p === "pending"
      ? { state: "pending" }
      : p === "limit"
        ? { state: "not-checked", reason: "limit" }
        : { state: "checked", probe: p },
});
const text = (facts: FileFacts | null) => factWords(facts).map((w) => w.text);

describe("factWords", () => {
  it("says only what was measured", () => {
    expect(text(null)).toEqual([]);
    expect(text(pdf(probe()))).toEqual([]);
    expect(factWords(pdf("pending"))).toEqual([
      { text: MEASURING, tone: "faint", pending: true },
    ]);
    expect(text(pdf("limit"))).toEqual(["not checked"]);
    expect(text(pdf(probe({ read: "unreadable" })))).toEqual([
      "couldn't be read here",
    ]);
  });

  it("names a lock in the words true of its kind", () => {
    expect(text(pdf(probe({ lock: "password-required" })))).toEqual([
      "needs a password",
    ]);
    expect(text(pdf(probe({ lock: "restricted" })))).toEqual([
      "editing restricted",
    ]);
    expect(text(pdf(probe({ lock: "unknown" })))).toEqual(["encrypted"]);
  });

  it("counts form fields from the probe, and says when no page has text", () => {
    expect(text(pdf(probe({ formFields: 1 })))).toEqual(["1 form field"]);
    expect(text(pdf(probe({ formFields: 4 })))).toEqual(["4 form fields"]);
    expect(text(pdf(probe({ sample: ["image-only", "image-only"] })))).toEqual([
      "no selectable text",
    ]);
    // One page of text among scans: no claim.
    expect(text(pdf(probe({ sample: ["image-only", "text"] })))).toEqual([]);
  });

  it("a file whose bytes contradict its name says what it really is", () => {
    const facts = {
      ...quickFacts({ name: "report.pdf", size: 9, type: "" }, "r"),
      bytes: "PNG" as const,
      contradicted: true,
      pdf: null,
    };
    expect(factWords(facts)).toEqual([{ text: "really PNG", tone: "warn" }]);
  });

  it("pagesOf reads only a probe that counted", () => {
    expect(pagesOf(pdf(probe({ pages: 12 })))).toBe(12);
    expect(pagesOf(pdf("pending"))).toBeNull();
    expect(pagesOf(null)).toBeNull();
  });
});

describe("ticketSummary", () => {
  const row = (facts: FileFacts | null, size = 1024) => ({ size, facts });

  it("2 PDFs · their pages · their size", () => {
    const words = ticketSummary([
      row(pdf(probe({ pages: 12 }), "a.pdf"), 1024 * 1024),
      row(pdf(probe({ pages: 3 }), "b.pdf"), 1024 * 1024),
    ]).map((w) => w.text);
    expect(words).toEqual(["2 PDFs", "15 pages", "2.0 MB"]);
  });

  it("grows only at its end: measuring, then the count, then pages and size", () => {
    const measuring = { text: MEASURING, tone: "faint", pending: true };
    // Nothing read yet: one placeholder.
    expect(ticketSummary([row(null), row(null)])).toEqual([measuring]);
    // A PDF still being read: the count, and the placeholder after it.
    expect(
      ticketSummary([
        row(pdf(probe({ pages: 12 }), "a.pdf")),
        row(pdf("pending", "b.pdf")),
      ]),
    ).toEqual([{ text: "2 PDFs", tone: "muted" }, measuring]);
  });

  it("never totals pages over some of the files", () => {
    const words = ticketSummary([
      row(pdf(probe({ pages: 12 }), "a.pdf")),
      row(pdf("limit", "b.pdf")),
    ]).map((w) => w.text);
    expect(words.some((w) => /page/.test(w))).toBe(false);
  });

  it("names images and other single kinds, and counts a mix as files", () => {
    const jpg = quickFacts({ name: "p.jpg", size: 1, type: "" }, "p");
    const docx = quickFacts({ name: "d.docx", size: 1, type: "" }, "d");
    expect(ticketSummary([row(jpg), row(jpg)])[0]!.text).toBe("2 images");
    expect(ticketSummary([row(docx)])[0]!.text).toBe("1 DOCX file");
    expect(ticketSummary([row(docx), row(jpg)])[0]!.text).toBe("2 files");
    // An unrecognised name: still a count.
    const odd = quickFacts({ name: "notes.weird", size: 1, type: "" }, "o");
    expect(ticketSummary([row(odd)])[0]!.text).toBe("1 file");
  });

  it("every number it prints is a field of the files", () => {
    const files = [
      row(pdf(probe({ pages: 7 }), "a.pdf"), 3 * 1024),
      row(pdf(probe({ pages: 5 }), "b.pdf"), 5 * 1024),
    ];
    const printed = ticketSummary(files)
      .map((w) => w.text)
      .join(" ");
    expect(printed.match(/\d+(?:\.\d+)?/g)).toEqual(["2", "12", "8.0"]);
  });
});

describe("links", () => {
  it("a suggestion links to its tool; a format to the tools that take it", () => {
    expect(toolHref("merge-pdf")).toBe("/tools/merge-pdf");
    expect(acceptsHref("PDF")).toBe("/tools?accepts=pdf");
  });

  it("only a plain primary click is the page's to take", () => {
    const plain = {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    };
    expect(isPlainClick(plain)).toBe(true);
    for (const over of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
      { defaultPrevented: true },
    ])
      expect(isPlainClick({ ...plain, ...over }), JSON.stringify(over)).toBe(
        false,
      );
  });
});
