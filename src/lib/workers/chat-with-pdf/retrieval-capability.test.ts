// @vitest-environment node
/**
 * `provesChatRetrieval`, the start-up proof published as `chatRetrieval`.
 *
 * The TRUE case runs first, in this file, with an injected extractor: a
 * pdf-lib → page-text fake that reads each page's content stream back (the
 * words the generator drew, nothing it was told). Only after that is green
 * do the four controls mean anything — a false that came from a broken
 * fixture would otherwise pass as four controls at once:
 *
 *   - the selector forced to prefix, through the engine's `select` seam (not
 *     `vi.mock`: under `isolate:false` a module evaluated against a stub stays
 *     cached bound to it for the next file);
 *   - `Intl.Segmenter` deleted (restored in `finally`);
 *   - the soundness gate refusing;
 *   - the manifest gate refusing.
 *
 * And, where this host has a real `pdftotext` (the worker image; a dev box
 * with poppler), the proof as the daemon runs it, with no fake at all.
 */
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { PageSelection } from "@/lib/pdf/page-retrieval";
import {
  artifactInvalid,
  resolveWorkerArtifactManifest,
  type ArtifactManifestGate,
} from "../artifacts";
import { createProcessorRegistry } from "../processor";
import { resolveNativePdfTextExtractor } from "../pdf-text/native";
import {
  resolveWorkerSoundness,
  soundnessReject,
  type SoundnessGate,
} from "../soundness";
import type { PdfTextExtractor } from "./engine";
import {
  CHAT_RETRIEVAL_PLANT,
  CHAT_RETRIEVAL_PLANT_PAGE,
  CHAT_RETRIEVAL_PROOF_PAGES,
  chatRetrievalProofLines,
  chatRetrievalProofPdf,
  noticeNamesPage,
  provesChatRetrieval,
  runChatRetrievalProof,
} from "./retrieval-capability";

const ENV = {};

/** Each page's drawn words, read back out of its content stream. */
const pdfLibPageText: PdfTextExtractor = async (
  bytes,
): Promise<ExtractedPdfText> => {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages().map((page, index) => {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    let ops = "";
    for (const stream of streams)
      if (stream instanceof PDFRawStream)
        ops += new TextDecoder("latin1").decode(
          decodePDFRawStream(stream).decode(),
        );
    const lines = [...ops.matchAll(/<([0-9A-Fa-f]*)> Tj/g)].map((m) =>
      Buffer.from(m[1]!, "hex").toString("latin1"),
    );
    const text = lines.join("\n");
    return { pageNumber: index + 1, text, characterCount: text.length };
  });
  const text = pages.map((page) => page.text).join("\n\n");
  return {
    pageCount: pages.length,
    pages,
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
};

const forcedPrefix = (): PageSelection => ({
  strategy: "prefix",
  reason: "no-signal",
});

function refusingSoundness(): SoundnessGate {
  const real = resolveWorkerSoundness(ENV);
  return {
    capability: real.capability,
    check: () => soundnessReject("missing_input"),
  };
}

function refusingManifest(): ArtifactManifestGate {
  const real = resolveWorkerArtifactManifest(ENV);
  return {
    capability: real.capability,
    validate: () => artifactInvalid("no_artifacts"),
  };
}

describe("the fixture the proof runs on", () => {
  it("draws the plant on page 60 only, and the fake reads it back there", async () => {
    const lines = chatRetrievalProofLines(
      CHAT_RETRIEVAL_PROOF_PAGES,
      CHAT_RETRIEVAL_PLANT_PAGE,
    );
    const drawn = lines
      .map((page, i) => [i + 1, page.join(" ")] as const)
      .filter(([, text]) => text.includes(CHAT_RETRIEVAL_PLANT))
      .map(([page]) => page);
    expect(drawn).toEqual([CHAT_RETRIEVAL_PLANT_PAGE]);
    const read = await pdfLibPageText(
      await chatRetrievalProofPdf(
        CHAT_RETRIEVAL_PROOF_PAGES,
        CHAT_RETRIEVAL_PLANT_PAGE,
      ),
    );
    expect(read.pageCount).toBe(CHAT_RETRIEVAL_PROOF_PAGES);
    expect(read.pages[CHAT_RETRIEVAL_PLANT_PAGE - 1]!.text).toContain(
      CHAT_RETRIEVAL_PLANT,
    );
    // Each page is about 1,200 characters, so 70 of them overrun 8,000.
    expect(read.characterCount).toBeGreaterThan(70 * 1_100);
  });
});

describe("provesChatRetrieval", () => {
  it("TRUE with the injected extractor — asserted first, so the controls below mean something", async () => {
    const result = await runChatRetrievalProof(ENV, {
      extractor: pdfLibPageText,
    });
    expect(result.lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    // Every letter ran: a proof that skipped one would still say ok.
    for (const letter of ["a", "b", "c", "d", "e", "f", "g"])
      expect(
        result.lines.some((l) => l.startsWith(`PASS (${letter})`)),
        letter,
      ).toBe(true);
    expect(result.ok).toBe(true);
    expect(
      await provesChatRetrieval(
        ENV,
        createProcessorRegistry,
        pdfLibPageText,
        resolveWorkerSoundness(ENV),
        resolveWorkerArtifactManifest(ENV),
      ),
    ).toBe(true);
  });

  it("FALSE with the selector forced to prefix (the select seam)", async () => {
    const result = await runChatRetrievalProof(ENV, {
      extractor: pdfLibPageText,
      select: forcedPrefix,
    });
    // The letters that need page 60 fail; the negative and fit controls
    // still pass, so the false is the selector's, not the fixture's.
    const failed = result.lines
      .filter((l) => l.startsWith("FAIL"))
      .map((l) => l.slice(6, 7));
    expect(failed).toEqual(expect.arrayContaining(["a", "b", "d"]));
    expect(failed).not.toContain("e");
    expect(failed).not.toContain("f");
    expect(
      await provesChatRetrieval(
        ENV,
        createProcessorRegistry,
        pdfLibPageText,
        resolveWorkerSoundness(ENV),
        resolveWorkerArtifactManifest(ENV),
        forcedPrefix,
      ),
    ).toBe(false);
  });

  it("FALSE with Intl.Segmenter missing", async () => {
    const intl = Intl as unknown as Record<string, unknown>;
    const saved = intl.Segmenter;
    try {
      delete intl.Segmenter;
      expect(typeof Intl.Segmenter).toBe("undefined");
      expect(
        await provesChatRetrieval(ENV, createProcessorRegistry, pdfLibPageText),
      ).toBe(false);
    } finally {
      intl.Segmenter = saved;
    }
    expect(typeof Intl.Segmenter).toBe("function");
  });

  it("FALSE when the soundness gate refuses", async () => {
    expect(
      await provesChatRetrieval(
        ENV,
        createProcessorRegistry,
        pdfLibPageText,
        refusingSoundness(),
        resolveWorkerArtifactManifest(ENV),
      ),
    ).toBe(false);
  });

  it("FALSE when the manifest gate refuses", async () => {
    expect(
      await provesChatRetrieval(
        ENV,
        createProcessorRegistry,
        pdfLibPageText,
        resolveWorkerSoundness(ENV),
        refusingManifest(),
      ),
    ).toBe(false);
  });

  it("FALSE where the image has no text extractor", async () => {
    expect(
      await provesChatRetrieval({
        PDFXYZ_PDF_TEXT_BIN: "/nonexistent/pdfxyz-no-pdftotext",
      }),
    ).toBe(false);
  });

  it("FALSE on a throw (an extractor that throws mid-proof)", async () => {
    expect(
      await provesChatRetrieval(ENV, createProcessorRegistry, async () => {
        throw new Error("boom");
      }),
    ).toBe(false);
  });

  it.skipIf(!resolveNativePdfTextExtractor())(
    "TRUE on this host's REAL pdftotext, as the daemon runs it",
    async () => {
      const result = await runChatRetrievalProof(process.env);
      expect(result.lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
      expect(result.ok).toBe(true);
    },
  );
});

describe("noticeNamesPage (the proof's reader of a notice)", () => {
  it("reads spans and single pages, and refuses a near miss", () => {
    const notice =
      "This document is longer than one question can read, so 6 of its 70 pages were read: pages 1–5, 60. Pages not listed were not sent.";
    expect(noticeNamesPage(notice, 60)).toBe(true);
    expect(noticeNamesPage(notice, 3)).toBe(true);
    expect(noticeNamesPage(notice, 6)).toBe(false);
    expect(noticeNamesPage(notice, 59)).toBe(false);
    expect(
      noticeNamesPage(
        "This document is longer than one question can read, so only some of its 70 pages were read.",
        60,
      ),
    ).toBe(false);
    expect(
      noticeNamesPage("Only pages 1–6 of 70 could be read, cut mid-page.", 60),
    ).toBe(false);
  });
});
