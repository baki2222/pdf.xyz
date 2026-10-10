// @vitest-environment node
/**
 * The production proof's PDF to PowerPoint verdict, held to its controls
 * before it is allowed to judge a deployment: it must PASS the deck this
 * tree's engine writes from the proof PDF, and FAIL the text-only deck (the
 * owner's report), a deck whose picture moved, and the package PowerPoint
 * refused. A verdict that passed the text-only deck would be the proof that
 * was green on production while the pictures were missing.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { pptxBefore20260927 } from "@/tests/pptx-before-2026-09-27";
import { pptxTextOnly20261010 } from "@/tests/pptx-text-only-2026-10-10";
import {
  PPTX_PROOF_TEXT,
  pptxDeploymentVerdict,
  pptxProofPdf,
} from "./deployment-proof";
import { runPdfOfficeExport } from "./engine";
import { scanPdfPages } from "./page-scan";

const PAGES = [
  {
    pageNumber: 1,
    text: PPTX_PROOF_TEXT,
    characterCount: PPTX_PROOF_TEXT.length,
  },
];

async function engineDeck(): Promise<Uint8Array> {
  const run = await runPdfOfficeExport(
    "pdf-to-powerpoint",
    await pptxProofPdf(),
    {
      extract: async () => ({
        pageCount: 1,
        pages: PAGES,
        text: PPTX_PROOF_TEXT,
        characterCount: PPTX_PROOF_TEXT.length,
        hasText: true,
      }),
      scanPages: scanPdfPages,
    },
  );
  if (!run.ok) throw new Error(run.message);
  return run.output;
}

describe("pptxDeploymentVerdict", () => {
  it("POSITIVE CONTROL: passes the deck this tree's engine writes", async () => {
    const verdict = await pptxDeploymentVerdict(await engineDeck());
    expect(verdict.detail).toMatch(/picture is on slide 1/);
    expect(verdict.ok).toBe(true);
  });

  it("NEGATIVE CONTROL: fails the text-only deck — opens, walks, has the text, no picture", async () => {
    const verdict = await pptxDeploymentVerdict(
      await pptxTextOnly20261010(PAGES),
    );
    expect(verdict.ok).toBe(false);
    // It fails for the right reason: the slide size first (16:9, not A4).
    expect(verdict.detail).toMatch(/not the page's/);
  });

  it("NEGATIVE CONTROL: fails a deck whose picture moved half an inch", async () => {
    const zip = await JSZip.loadAsync(await engineDeck());
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const moved = xml.replace(
      /(<p:pic>[\s\S]*?<a:off x=")(\d+)/,
      (_, head: string, x: string) => `${head}${Number(x) + 457_200}`,
    );
    expect(moved).not.toBe(xml);
    zip.file("ppt/slides/slide1.xml", moved);
    const verdict = await pptxDeploymentVerdict(
      new Uint8Array(await zip.generateAsync({ type: "uint8array" })),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/carries no picture at the page's/);
  });

  it("NEGATIVE CONTROL: fails the package PowerPoint refused", async () => {
    const verdict = await pptxDeploymentVerdict(
      await pptxBefore20260927(PAGES),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/^PowerPoint cannot open this deck/);
  });
});
