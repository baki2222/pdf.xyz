// @vitest-environment node
/**
 * The OpenDocument / RTF proof's verdict, held to stand-ins that break each
 * property it claims to check — and its fixtures held to the recogniser and
 * the content check, so the files CI's LibreOffice converts are the files the
 * engine is meant to take.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { formatOfName } from "@/lib/intent/formats";
import { sniffFormat, zipMimetype } from "@/lib/intent/sniff";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { getToolBySlug } from "@/lib/tools";
import {
  OFFICE_INPUT_FIXTURES,
  odsWith,
  odtWith,
} from "@/tests/office-input-fixtures";
import type { LibreOfficePdfRunner } from "./engine";
import { officeContentRefusal, SIGNED_OFFICE_INPUTS } from "./input-content";
import { runOfficeInputProof, type OfficeInputProofDeps } from "./input-proof";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** The words a reader of the file would see: content.xml's text, or the RTF's. */
async function wordsIn(bytes: Uint8Array): Promise<string> {
  if (bytes[0] === 0x7b) return dec.decode(bytes).replace(/\\[a-z0-9]+ ?/g, "");
  const zip = await JSZip.loadAsync(bytes);
  const xml = (await zip.file("content.xml")?.async("string")) ?? "";
  return xml.replace(/<[^>]+>/g, " ");
}

/** A PDF-shaped envelope (`looksLikePdf` wants 32 bytes) around `text`. */
const HEAD = `%PDF-1.7\n%${"-".repeat(32)}\n`;
const TAIL = "\n%%EOF\n";
const pdfOf = (text: string) => enc.encode(`${HEAD}${text}${TAIL}`);

/** A stand-in LibreOffice that lays out exactly the words in the file. */
const honest: LibreOfficePdfRunner = {
  convertToPdf: async (input) => pdfOf(await wordsIn(input)),
};

/** A stand-in pdftotext for {@link pdfOf}'s PDFs. */
async function extract(pdf: Uint8Array): Promise<ExtractedPdfText> {
  const all = dec.decode(pdf);
  const text = all.slice(HEAD.length, all.length - TAIL.length);
  return {
    pageCount: 1,
    pages: [],
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

async function deps(
  over: Partial<OfficeInputProofDeps> = {},
): Promise<OfficeInputProofDeps> {
  return {
    libreoffice: honest,
    extract,
    fixtures: OFFICE_INPUT_FIXTURES,
    spreadsheetBytes: await odsWith("Renamed"),
    ...over,
  };
}

describe("the fixtures are the files the engine is meant to take", () => {
  it("one per checked format, derived from the content check's own table", () => {
    expect(OFFICE_INPUT_FIXTURES.map((f) => f.kind).sort()).toEqual(
      Object.keys(SIGNED_OFFICE_INPUTS).sort(),
    );
  });

  it.each(OFFICE_INPUT_FIXTURES.map((f) => [f.kind, f] as const))(
    "%s: its tool takes it, its bytes name it, and the content check passes it",
    async (kind, fixture) => {
      const bytes = await fixture.build();
      expect(getToolBySlug(fixture.tool)!.accept).toContain(kind.toUpperCase());
      expect(formatOfName(fixture.name)).toBe(kind.toUpperCase());
      expect(sniffFormat(bytes)).toBe(kind.toUpperCase());
      expect(officeContentRefusal(kind, bytes)).toBeNull();
      if (kind !== "rtf") expect(zipMimetype(bytes)).toBe(fixture.type);
      expect(await wordsIn(bytes)).toContain(fixture.word);
    },
  );

  it("no fixture's word is inside another's", () => {
    const words = OFFICE_INPUT_FIXTURES.map((f) => f.word);
    expect(new Set(words).size).toBe(words.length);
    for (const a of words)
      for (const b of words)
        if (a !== b) expect(a.toLowerCase()).not.toContain(b.toLowerCase());
  });
});

describe("the proof's verdict", () => {
  it("passes an honest converter, every fixture and both controls", async () => {
    const result = await runOfficeInputProof(await deps());
    expect(result.lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.lines.filter((l) => l.startsWith("ok"))).toHaveLength(
      OFFICE_INPUT_FIXTURES.length + 2,
    );
  });

  it("fails a converter that loses the text", async () => {
    const blank: LibreOfficePdfRunner = {
      convertToPdf: async () => pdfOf(""),
    };
    const result = await runOfficeInputProof(
      await deps({ libreoffice: blank }),
    );
    expect(result.ok).toBe(false);
    expect(
      result.lines.filter((l) => /is not in its text/.test(l)),
    ).toHaveLength(OFFICE_INPUT_FIXTURES.length);
  });

  it("fails a converter that answers every file with the same PDF", async () => {
    const all = OFFICE_INPUT_FIXTURES.map((f) => f.word).join(" ");
    const same: LibreOfficePdfRunner = {
      convertToPdf: async () => pdfOf(all),
    };
    const result = await runOfficeInputProof(await deps({ libreoffice: same }));
    expect(result.ok).toBe(false);
    expect(result.lines.some((l) => /also carries/.test(l))).toBe(true);
  });

  it("fails a PDF with no pages", async () => {
    const result = await runOfficeInputProof(
      await deps({
        extract: async (pdf) => ({ ...(await extract(pdf)), pageCount: 0 }),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines.some((l) => /has no pages/.test(l))).toBe(true);
  });

  it("fails when the renamed-file control is not refused", async () => {
    // A genuine .odt as the "spreadsheet named .odt": the engine converts it,
    // so the control must report it.
    const result = await runOfficeInputProof(
      await deps({ spreadsheetBytes: await odtWith("Genuine") }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines.filter((l) => l.startsWith("FAIL")).join("\n")).toMatch(
      /spreadsheet named \.odt: answered ok/,
    );
  });

  it("fails a run with too few fixtures (a shrunken corpus is not a pass)", async () => {
    const result = await runOfficeInputProof(
      await deps({ fixtures: OFFICE_INPUT_FIXTURES.slice(0, 2) }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toMatch(/only 2 fixtures/);
  });
});
