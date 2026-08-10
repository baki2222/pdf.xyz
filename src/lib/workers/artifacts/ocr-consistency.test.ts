// @vitest-environment node
/**
 * Cross-channel proof that the two INDEPENDENT content-free descriptions a completed
 * OCR job carries never disagree:
 *  - the client-facing {@link OcrResultMeta} (`results.ocr`) — "a searchable PDF and a
 *    text sidecar were produced", built by `buildOcrResultMeta`;
 *  - the internal artifact MANIFEST the Phase 37 gate derives from the actual produced
 *    outputs — the output KINDS + count.
 * They are computed from different inputs (metadata vs. real bytes/naming), so this
 * test pins that `producedSearchablePdf`/`producedTextSidecar` and the manifest's
 * `pdf`/`text-sidecar` kinds are always consistent — a job can never claim to have
 * produced an output kind the manifest did not see, or vice-versa. See
 * docs/WORKER_ARCHITECTURE.md → "Artifact manifest vs. OCR result metadata".
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION } from "@/lib/jobs";
import { buildOcrResultMeta, type OcrOutputMode } from "@/lib/jobs/ocr";
import type { ProcessorArtifact } from "../processor/types";
import { checkArtifacts } from "./manifest";
import { DEFAULT_ARTIFACT_POLICY } from "./policy";
import type { ArtifactOutputKind } from "./types";

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc(`%PDF-1.7\n${"0".repeat(32)}\n%%EOF\n`);

const OCR_PDF: ProcessorArtifact = {
  filename: "scan-ocr.pdf",
  contentType: "application/pdf",
  bytes: PDF,
};
const OCR_SIDECAR: ProcessorArtifact = {
  filename: "scan.txt",
  contentType: "text/plain; charset=utf-8",
  bytes: enc("recognized text — never surfaced anywhere structural"),
};

/** The produced output set an OCR run yields for each output mode. */
function outputsForMode(mode: OcrOutputMode): ProcessorArtifact[] {
  if (mode === "text") return [OCR_SIDECAR];
  if (mode === "both") return [OCR_PDF, OCR_SIDECAR];
  return [OCR_PDF]; // "searchable-pdf"
}

describe("OCR result metadata ↔ artifact manifest consistency", () => {
  const modes: OcrOutputMode[] = ["searchable-pdf", "text", "both"];

  for (const outputMode of modes) {
    it(`agree on produced kinds + count for output mode "${outputMode}"`, () => {
      const artifacts = outputsForMode(outputMode);

      // Channel A: the client-facing OCR result metadata (from the run's facts).
      const ocrMeta = buildOcrResultMeta({
        engine: "ocrmypdf",
        languages: ["eng"],
        outputMode,
        producedSearchablePdf: outputMode !== "text",
        producedTextSidecar: outputMode !== "searchable-pdf",
        pageCount: 3,
        textCharacters: outputMode === "searchable-pdf" ? null : 42,
      });

      // Channel B: the internal artifact manifest (from the real produced bytes).
      const validation = checkArtifacts(DEFAULT_ARTIFACT_POLICY, {
        tool: "ocr-pdf",
        processor: "ocr",
        retention: DEFAULT_RETENTION,
        artifacts,
      });
      expect(validation.verdict).toBe("valid");
      const kinds = validation.checks.map(
        (c) => c.manifest.outputKind,
      ) as ArtifactOutputKind[];

      // Count agrees with what OCR says it produced.
      const expectedCount =
        (ocrMeta.producedSearchablePdf ? 1 : 0) +
        (ocrMeta.producedTextSidecar ? 1 : 0);
      expect(validation.checks).toHaveLength(expectedCount);
      expect(artifacts).toHaveLength(expectedCount);

      // Kinds agree: a claimed searchable PDF ⟺ a `pdf` kind in the manifest; a
      // claimed sidecar ⟺ a `text-sidecar` kind. Neither channel can outrun the other.
      expect(kinds.includes("pdf")).toBe(ocrMeta.producedSearchablePdf);
      expect(kinds.includes("text-sidecar")).toBe(ocrMeta.producedTextSidecar);

      // Every produced kind is one the OCR processor family may legitimately emit.
      for (const kind of kinds) {
        expect(["pdf", "text-sidecar"]).toContain(kind);
      }
    });
  }

  it("an OCR sidecar's recognized text never reaches the manifest", () => {
    const validation = checkArtifacts(DEFAULT_ARTIFACT_POLICY, {
      tool: "ocr-pdf",
      processor: "ocr",
      retention: DEFAULT_RETENTION,
      artifacts: [
        {
          filename: "secret-scan.txt",
          contentType: "text/plain; charset=utf-8",
          bytes: enc("PATIENT: Jane Roe, SSN 123-45-6789"),
        },
      ],
    });
    const serialized = JSON.stringify(validation);
    for (const secret of [
      "PATIENT",
      "Jane Roe",
      "123-45-6789",
      "secret-scan.txt",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // Only the bounded byte COUNT survives, never the text.
    expect(validation.checks[0]!.manifest.outputKind).toBe("text-sidecar");
    expect(validation.checks[0]!.manifest.byteCount).toBeGreaterThan(0);
  });
});
