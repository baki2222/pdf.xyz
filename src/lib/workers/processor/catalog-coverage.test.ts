// @vitest-environment node
/**
 * Drift guard between the public tool catalog and the processor registry.
 *
 * The catalog is what the site *promises*: a tool whose `processing` is `server`
 * or `hybrid` tells users their file may be uploaded to a secure worker, and the
 * job API accepts uploads and jobs for it on that basis. If no processor claims
 * that tool, every one of those jobs fails with `not_implemented` — after the file
 * has already been uploaded.
 *
 * That is exactly what happened to `markdown-to-pdf`: it was catalogued as
 * `hybrid`, but its only implementation was the in-browser runner, so the promised
 * "secure-worker fallback for large or complex files" did not exist. Nothing in
 * the type system or the test suite noticed, because the two sides never met.
 * This is where they meet.
 */
import { describe, expect, it } from "vitest";
import { getAllToolSlugs, getToolBySlug } from "@/lib/tools";
import { capabilityForMode, usesWorkerBackend } from "@/lib/jobs/capabilities";
import { createProcessorRegistry } from "./index";

/** Catalog slugs whose declared processing mode implies a worker backend. */
function workerBackedSlugs(): string[] {
  return getAllToolSlugs().filter((slug) => {
    const tool = getToolBySlug(slug);
    return tool ? usesWorkerBackend(capabilityForMode(tool.processing)) : false;
  });
}

describe("catalog ↔ processor registry coverage", () => {
  // Every dep supplied but empty. Registration is gated on a deps object being
  // *passed* (which the daemon always does), not on the native engine existing —
  // so this is the full set of processors the worker can ever route to, each of
  // which then honestly reports `ready:false` until its engine is present.
  const registry = createProcessorRegistry({
    // All engines absent — compression still registers and reports `ready:false`.
    compression: { tools: { ghostscript: false, qpdf: false, mutool: false } },
    ocr: {},
    pdfSecurity: {},
    pdfStructure: {},
    pdfArchive: {},
    htmlRender: {},
    officeConversion: {},
    pdfOfficeExport: {},
    tableExtract: {},
    requestSignatures: {},
    summarize: {},
    translate: {},
    aiExtract: {},
    chatWithPdf: {},
  });

  it("finds worker-backed tools to check", () => {
    expect(workerBackedSlugs().length).toBeGreaterThan(10);
  });

  it("every worker-backed catalog tool resolves to a processor", () => {
    const orphans = workerBackedSlugs().filter((slug) => !registry.resolve(slug));
    // An orphan means the site accepts an upload for a job that can only ever
    // fail. Either register a processor, or mark the tool `processing: "client"`.
    expect(orphans).toEqual([]);
  });

  it("no processor claims a tool the catalog does not have", () => {
    const known = new Set(getAllToolSlugs());
    const unknown = registry
      .list()
      .flatMap((processor) => processor.tools)
      .filter((tool) => !known.has(tool));
    expect(unknown).toEqual([]);
  });

  it("no processor claims a tool the catalog says runs in the browser", () => {
    // A client-only tool has no server job — the job API rejects it — so a
    // processor claiming it is dead code that misrepresents the tool.
    const clientOnly = registry
      .list()
      .flatMap((processor) => processor.tools)
      .filter((slug) => {
        const tool = getToolBySlug(slug);
        return tool ? !usesWorkerBackend(capabilityForMode(tool.processing)) : false;
      });
    expect(clientOnly).toEqual([]);
  });
});
