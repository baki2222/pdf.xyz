// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import {
  COMPARE_VERDICTS,
  MAX_DIFF_CELLS,
  type CompareVerdict,
} from "@/lib/pdf/compare-pdf";
import { extractPdfText, type ExtractedPdfText } from "@/lib/pdf/text";
import { getToolBySlug } from "@/lib/tools";
import {
  ComparePdfEditor,
  OCR_TOOL_HREF,
  type CompareItem,
} from "./compare-pdf-runner";

/**
 * What a person using Compare PDF is TOLD — the rendered result panel — for
 * real PDF bytes read by the extraction code that ships. The engine can be
 * right about a scanned file (`hasComparableText: false`) while the page says
 * "Differences found" under a green check, which is what shipped: the old unit
 * test asserted the engine's fields and never the title.
 *
 * pdfjs's browser build needs DOMMatrix, which jsdom lacks; its legacy build is
 * the same parser with the polyfills, so it is passed in as the reader and
 * `extractPdfText` itself — the part that decides `hasText` — is unchanged.
 */
const legacyReader = () => import("pdfjs-dist/legacy/build/pdf.mjs");
const extract = (bytes: Uint8Array) => extractPdfText(bytes, legacyReader);

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

async function textPdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 600]);
  lines.forEach((line, i) =>
    page.drawText(line, { x: 30, y: 560 - i * 18, size: 11, font }),
  );
  return doc.save();
}

/** An image-only page: ink, and not one character of selectable text. */
async function scanPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  page.drawRectangle({
    x: 40,
    y: 200,
    width: 300,
    height: 300,
    color: rgb(0.2, 0.2, 0.2),
  });
  return doc.save();
}

let nextId = 0;
function item(name: string, bytes: Uint8Array): CompareItem {
  return {
    id: `t-${nextId++}`,
    name,
    size: bytes.byteLength,
    bytes,
    pageCount: 1,
  };
}

function mount(
  left: CompareItem,
  right: CompareItem,
  reader: (bytes: Uint8Array) => Promise<ExtractedPdfText> = extract,
) {
  render(
    <ComparePdfEditor
      items={[left, right]}
      loading={0}
      rejections={[]}
      onFiles={() => {}}
      onRemove={() => {}}
      onClearRejections={() => {}}
      extract={reader}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /compare pdfs/i }));
}

const CLAUSES = ["Clause 1 the parties agree", "Clause 2 payment is due"];

/** One real input pair per verdict; the Record type makes it exhaustive. */
const PAIRS: Record<CompareVerdict, () => Promise<[CompareItem, CompareItem]>> =
  {
    identical: async () => [
      item("v1.pdf", await textPdf(CLAUSES)),
      item("v2.pdf", await textPdf(CLAUSES)),
    ],
    different: async () => [
      item("v1.pdf", await textPdf(CLAUSES)),
      item("v2.pdf", await textPdf([...CLAUSES, "Clause 3 added later"])),
    ],
    "no-text": async () => [
      item("scan-a.pdf", await scanPdf()),
      item("scan-b.pdf", await scanPdf()),
    ],
    "left-no-text": async () => [
      item("signed-scan.pdf", await scanPdf()),
      item("contract.pdf", await textPdf(CLAUSES)),
    ],
    "right-no-text": async () => [
      item("contract.pdf", await textPdf(CLAUSES)),
      item("signed-scan.pdf", await scanPdf()),
    ],
  };

const COMPARED = new Set<CompareVerdict>(["identical", "different"]);

function metric(label: string): string {
  const tile = screen.getByText(label).parentElement!;
  return tile.querySelectorAll("p")[1]!.textContent ?? "";
}

describe("Compare PDF runner — what the user is told", () => {
  it("health: there is one real input pair for every verdict the engine declares", () => {
    expect(Object.keys(PAIRS).sort()).toEqual([...COMPARE_VERDICTS].sort());
    // Both halves of the split below are populated, so neither loop is vacuous.
    expect(COMPARE_VERDICTS.filter((v) => COMPARED.has(v)).length).toBe(2);
    expect(COMPARE_VERDICTS.filter((v) => !COMPARED.has(v)).length).toBe(3);
  });

  it.each(COMPARE_VERDICTS.filter((v) => !COMPARED.has(v)))(
    "%s: a warn panel that says text is missing, points to OCR, and never says 'Differences found'",
    async (verdict) => {
      const [left, right] = await PAIRS[verdict]();
      mount(left, right);

      const panel = await screen.findByRole(
        "group",
        { name: /no text to compare|has no selectable text/i },
        { timeout: 5_000 },
      );
      // "neutral" until the merge with L06, which gave ResultPanel a `warn`
      // tone for exactly this outcome and holds every no-text branch to it
      // (no-text-note.test.tsx). Still never the green "ok".
      expect(panel).toHaveAttribute("data-tone", "warn");
      expect(within(panel).queryByText(/differences found/i)).toBeNull();
      expect(within(panel).queryByText(/selectable text matches/i)).toBeNull();

      // The one-sided verdicts name the file that needs OCR, in the title.
      if (verdict !== "no-text") {
        expect(
          within(panel).getByRole("heading", {
            name: "signed-scan.pdf has no selectable text",
          }),
        ).toBeInTheDocument();
      }

      // The link goes to a tool the catalog actually has.
      const link = within(panel).getByRole("link", { name: /ocr pdf/i });
      expect(link).toHaveAttribute("href", OCR_TOOL_HREF);
      const slug = OCR_TOOL_HREF.replace(/^\/tools\//, "");
      expect(getToolBySlug(slug)?.slug).toBe(slug);

      // No count is shown for a comparison that did not happen, and the report
      // on screen is not a diff of the other file's text.
      expect(metric("Changed lines")).toBe("Not compared");
      expect(panel.textContent).not.toMatch(/\+ Clause/);
      expect(panel.textContent).toContain("Changed lines: not compared");
    },
  );

  it.each(COMPARE_VERDICTS.filter((v) => COMPARED.has(v)))(
    "control — %s: both files have text, so the panel is a success with a count",
    async (verdict) => {
      const [left, right] = await PAIRS[verdict]();
      mount(left, right);

      const title =
        verdict === "identical"
          ? /selectable text matches/i
          : /differences found/i;
      const panel = await screen.findByRole(
        "group",
        { name: title },
        { timeout: 5_000 },
      );
      expect(panel).toHaveAttribute("data-tone", "ok");
      expect(metric("Changed lines")).toBe(verdict === "identical" ? "0" : "1");
      if (verdict === "different") {
        expect(panel.textContent).toContain("+ Clause 3 added later");
      }
    },
  );
});

describe("Compare PDF runner — size delta", () => {
  /** The signed byte count the report prints on its `Bytes:` line. */
  function reportDelta(panel: HTMLElement): number {
    const match = /Bytes: \d+ vs \d+ \(([+-]?\d+)\)/.exec(
      panel.textContent ?? "",
    );
    expect(match).not.toBeNull();
    return Number(match![1]);
  }

  it("a second file that is SMALLER shows a minus sign, agreeing with the report", async () => {
    const big = await textPdf([...CLAUSES, ...Array(30).fill("padding line")]);
    const small = await textPdf(CLAUSES);
    expect(small.byteLength).toBeLessThan(big.byteLength);
    mount(item("big.pdf", big), item("small.pdf", small));

    const panel = await screen.findByRole(
      "group",
      { name: /differences found/i },
      { timeout: 5_000 },
    );
    expect(reportDelta(panel)).toBeLessThan(0);
    expect(metric("Size delta")).toMatch(/^\u2212\d/);
  });

  it("control: a second file that is LARGER shows a plus sign", async () => {
    const small = await textPdf(CLAUSES);
    const big = await textPdf([...CLAUSES, ...Array(30).fill("padding line")]);
    mount(item("small.pdf", small), item("big.pdf", big));

    const panel = await screen.findByRole(
      "group",
      { name: /differences found/i },
      { timeout: 5_000 },
    );
    expect(reportDelta(panel)).toBeGreaterThan(0);
    expect(metric("Size delta")).toMatch(/^\+\d/);
  });
});

describe("Compare PDF runner — documents too large to diff", () => {
  function synthetic(tag: string, lines: number): ExtractedPdfText {
    const text = Array.from({ length: lines }, (_, i) => `${tag} ${i}`).join(
      "\n",
    );
    return {
      pageCount: 1,
      pages: [{ pageNumber: 1, text, characterCount: text.length }],
      text,
      characterCount: text.length,
      hasText: true,
    };
  }

  it("two unrelated documents over the bound show a readable error, not a crash or a result", async () => {
    // Just over the bound, derived from it. A dummy byte identifies each side.
    const over = Math.floor(Math.sqrt(MAX_DIFF_CELLS)) + 1;
    const reader = async (bytes: Uint8Array) =>
      synthetic(bytes[0] === 1 ? "left" : "right", over);
    mount(
      item("a.pdf", new Uint8Array([1])),
      item("b.pdf", new Uint8Array([2])),
      reader,
    );

    const alert = await screen.findByRole("alert", {}, { timeout: 5_000 });
    expect(alert).toHaveTextContent(/too many places to compare/i);
    expect(screen.queryByRole("group")).toBeNull();
  });
});
