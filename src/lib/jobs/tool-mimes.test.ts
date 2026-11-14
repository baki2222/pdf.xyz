// The job API admits an input by `acceptedMimesForTool`; the worker's
// file-soundness gate then decides, before any processor runs, whether the
// tool accepts that input's family. Production, 2026-11-14: the two derived
// the set separately, the ZIP rule lived in the validator alone, and every
// HTML to PDF ZIP job the APIs admitted died at the gate ("did not pass a
// basic soundness check") while the worker's start-up proof — which called
// the processor directly — published `htmlZip: true`.
//
// So this test walks the COMPOSED path: for every catalogue tool, every MIME
// the validator admits goes through the REAL `checkSoundness` with the
// shipped default policy, as a well-formed input of that type. Discovered
// from the catalogue, not named.
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import {
  UPLOAD_FAMILIES,
  familyForMime,
  type UploadFamily,
} from "@/lib/uploads/intake/families";
import { checkSoundness } from "@/lib/workers/soundness/check";
import { DEFAULT_SOUNDNESS_POLICY } from "@/lib/workers/soundness/policy";
import { HTML_ZIP_MIMES } from "@/lib/workers/html-render/zip-config";
import { acceptedMimesForTool, ZIP_PAGE_TOOL } from "./tool-mimes";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF\n");
const OTHER = new TextEncoder().encode("PK\u0003\u0004 not empty");

function inputOf(mime: string, family: UploadFamily) {
  const ext = UPLOAD_FAMILIES[family].extensions[0]!;
  const bytes = family === "pdf" ? PDF : OTHER;
  return {
    fileId: "f_probe",
    filename: `input.${ext}`,
    contentType: mime,
    bytes,
    declaredBytes: bytes.byteLength,
  };
}

function gateVerdict(tool: string, mime: string) {
  const family = familyForMime(mime);
  if (!family) return null; // an unrecognised MIME is deferred by the gate
  return checkSoundness(DEFAULT_SOUNDNESS_POLICY, {
    tool,
    inputs: [inputOf(mime, family)],
  });
}

const cases = tools
  .filter((t) => t.accept.length > 0)
  .flatMap((t) =>
    [...acceptedMimesForTool(t)]
      .filter((mime) => familyForMime(mime) !== null)
      .map((mime) => ({ tool: t.slug, mime })),
  );

describe("the job API's accepted inputs pass the worker's soundness gate", () => {
  it("the derived set is not implausibly small", () => {
    expect(new Set(cases.map((c) => c.tool)).size).toBeGreaterThanOrEqual(40);
    expect(cases.length).toBeGreaterThanOrEqual(60);
  });

  it("includes HTML to PDF's ZIP — the case that failed in production", () => {
    for (const mime of HTML_ZIP_MIMES)
      expect(cases).toContainEqual({ tool: ZIP_PAGE_TOOL, mime });
  });

  it.each(cases)("$tool admits $mime at the gate", ({ tool, mime }) => {
    const result = gateVerdict(tool, mime);
    expect(result?.reason, `${tool} ${mime}`).not.toBe("unsupported_family");
    expect(result?.verdict, `${tool} ${mime}`).not.toBe("unsound");
  });

  // Positive control: the gate this test relies on DOES refuse a family a
  // tool does not accept, so a green above is not a blind gate.
  it("control: a ZIP sent to a tool that does not take one is refused", () => {
    const merge = tools.find((t) => t.slug === "merge-pdf")!;
    expect(acceptedMimesForTool(merge).has("application/zip")).toBe(false);
    expect(gateVerdict("merge-pdf", "application/zip")?.reason).toBe(
      "unsupported_family",
    );
  });
});
