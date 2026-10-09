import { describe, expect, it } from "vitest";
import { getToolBySlug, tools } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import type { ProcessingMode } from "@/lib/tools/types";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import {
  CAPABILITY_BY_MODE,
  capabilityForMode,
  describeCapability,
  getToolCapability,
  getToolInputKind,
  usesWorkerBackend,
  workerPipelineStages,
} from "./capabilities";
import type { ToolCapability } from "./types";

describe("capability mapping", () => {
  it("maps every processing mode to a capability", () => {
    const modes: ProcessingMode[] = ["client", "server", "hybrid", "ai"];
    for (const mode of modes) {
      expect(CAPABILITY_BY_MODE[mode]).toBeDefined();
    }
    expect(capabilityForMode("client")).toBe("in-browser");
    expect(capabilityForMode("server")).toBe("secure-worker");
    expect(capabilityForMode("hybrid")).toBe("hybrid");
    expect(capabilityForMode("ai")).toBe("ai");
  });

  it("marks only in-browser as not using the worker backend", () => {
    expect(usesWorkerBackend("in-browser")).toBe(false);
    expect(usesWorkerBackend("secure-worker")).toBe(true);
    expect(usesWorkerBackend("hybrid")).toBe(true);
    expect(usesWorkerBackend("ai")).toBe(true);
  });

  it("resolves capability from a tool slug", () => {
    expect(getToolCapability("merge-pdf")).toBe("in-browser");
    expect(getToolCapability("ocr-pdf")).toBe("secure-worker");
    expect(getToolCapability("protect-pdf")).toBe("secure-worker");
    expect(getToolCapability("compress-pdf")).toBe("hybrid");
    expect(getToolCapability("chat-with-pdf")).toBe("ai");
    expect(getToolCapability("does-not-exist")).toBeUndefined();
  });

  it("classifies input kind (file vs url)", () => {
    expect(getToolInputKind("ocr-pdf")).toBe("file");
    expect(getToolInputKind("merge-pdf")).toBe("file");
    expect(getToolInputKind("webpage-to-pdf")).toBe("url");
    expect(getToolInputKind("does-not-exist")).toBeUndefined();
  });

  it("provides a descriptor whose id matches the capability", () => {
    const caps: ToolCapability[] = [
      "in-browser",
      "secure-worker",
      "hybrid",
      "ai",
    ];
    for (const cap of caps) {
      const descriptor = describeCapability(cap);
      expect(descriptor.id).toBe(cap);
      expect(descriptor.label.length).toBeGreaterThan(0);
    }
    // In-browser is the only capability that never uploads files.
    expect(describeCapability("in-browser").uploadsFiles).toBe(false);
    expect(describeCapability("secure-worker").uploadsFiles).toBe(true);
  });
});

/** A real catalog tool, or a loud failure — never a silently-undefined subject. */
function tool(slug: string): Tool {
  const found = getToolBySlug(slug);
  if (!found) throw new Error(`catalog has no ${slug}`);
  return found;
}

/** Every tool whose page renders the worker pipeline: the ones that upload to it. */
const WORKER_TOOLS = tools.filter((t) => modeUploadsFiles(t.processing));
const SCAN_STATES = [true, false, null] as const;

describe("worker pipeline stages", () => {
  it("covers a plausible number of tools (health check on the derived set)", () => {
    expect(WORKER_TOOLS.length).toBeGreaterThanOrEqual(15);
  });

  // This block used to assert `expect(ids).toContain("scan")` unconditionally, which
  // pinned the defect rather than catching it: the stage list was static, so the
  // product told every user "Every file is scanned before any processor touches it"
  // while the malware scanner was optional, off by default, and not configured on
  // production. The test agreed with the copy because both were written from the same
  // wrong assumption. The claim is now a function of the live capability, and what is
  // worth asserting is that the two branches differ in exactly the right way.
  it("keeps its shape in every branch — unique ids, real titles and descriptions", () => {
    for (const t of WORKER_TOOLS) {
      for (const active of SCAN_STATES) {
        const stages = workerPipelineStages(active, t);
        const ids = stages.map((s) => s.id);
        expect(new Set(ids).size, t.slug).toBe(ids.length);
        expect(ids, t.slug).toContain("process");
        expect(ids, t.slug).toContain("download");
        expect(ids, t.slug).toContain("delete");
        for (const stage of stages) {
          expect(stage.title.length).toBeGreaterThan(0);
          expect(stage.description.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("claims a malware scan only when one is actually running", () => {
    const pdfTool = tool("protect-pdf");
    const scanning = workerPipelineStages(true, pdfTool).map((s) => s.id);
    const notScanning = workerPipelineStages(false, pdfTool).map((s) => s.id);
    expect(scanning).toContain("scan");
    expect(notScanning).not.toContain("scan");
    // The stage is replaced, not dropped: the structural preflight is a real gate
    // that really does reject files, so the step count and the flow stay truthful.
    expect(notScanning).toContain("preflight");
    expect(notScanning.length).toBe(scanning.length);
  });

  it("never uses the word malware as a promise when nothing is scanning", () => {
    const copy = workerPipelineStages(false, tool("protect-pdf"))
      .map((s) => `${s.title} ${s.description}`)
      .join(" ");
    // It may *mention* malware — saying "files are not scanned for malware here" is
    // the honest disclosure. What it must never do is assert scanning happens.
    expect(copy).not.toMatch(/every file is scanned for malware/i);
    expect(copy).toMatch(/not scanned for malware/i);
  });

  it("makes NEITHER scan claim when no heartbeat has been observed (null)", () => {
    // The server render has no heartbeat. It used to be rendered as `false`, so
    // production served "Files are not scanned for malware here" to every
    // crawler while /api/worker/status reported an active scanner. The positive
    // control is the two assertions above: the same patterns DO match the
    // `true`/`false` branches, so a silent regex could not pass this.
    for (const t of WORKER_TOOLS) {
      const copy = workerPipelineStages(null, t)
        .map((s) => `${s.title} ${s.description}`)
        .join(" ");
      expect(copy, t.slug).not.toMatch(/not scanned for malware/i);
      expect(copy, t.slug).not.toMatch(/scanned for malware before/i);
      const ids = workerPipelineStages(null, t).map((s) => s.id);
      expect(ids, t.slug).not.toContain("scan");
      expect(ids, t.slug).not.toContain("preflight");
    }
  });

  it("names the third-party AI provider on exactly the AI tools, keeping the process id", () => {
    const aiTools = WORKER_TOOLS.filter(
      (t) => capabilityForMode(t.processing) === "ai",
    );
    const otherTools = WORKER_TOOLS.filter(
      (t) => capabilityForMode(t.processing) !== "ai",
    );
    expect(aiTools.length).toBeGreaterThanOrEqual(2);
    expect(otherTools.length).toBeGreaterThanOrEqual(10);
    const process = (t: Tool) =>
      workerPipelineStages(false, t).find((s) => s.id === "process")!;
    for (const t of aiTools)
      expect(process(t).description, t.slug).toMatch(/third-party AI provider/);
    for (const t of otherTools)
      expect(process(t).description, t.slug).not.toMatch(/AI provider/);
  });

  it("tells a URL tool's reader that nothing is uploaded, and that the page is fetched", () => {
    const urlTools = WORKER_TOOLS.filter(
      (t) => getToolInputKind(t.slug) === "url",
    );
    expect(urlTools.length).toBeGreaterThanOrEqual(1);
    for (const t of urlTools) {
      for (const active of SCAN_STATES) {
        const stages = workerPipelineStages(active, t);
        const copy = stages.map((s) => `${s.title} ${s.description}`).join(" ");
        expect(
          stages.map((s) => s.id),
          t.slug,
        ).not.toContain("upload");
        expect(copy, t.slug).not.toMatch(/your file|encrypted upload/i);
        expect(copy, t.slug).toMatch(/nothing is uploaded/i);
        expect(copy, t.slug).toMatch(/from the internet/i);
      }
    }
    // Positive control: a file tool's stages DO carry the upload story.
    expect(
      workerPipelineStages(false, tool("protect-pdf")).map((s) => s.id),
    ).toContain("upload");
  });

  it("does not describe the secure worker as scanning, since that string is static", () => {
    // `describeCapability` copy cannot see a live capability, so it may only assert
    // what holds in every deployment. Scanning does not.
    expect(describeCapability("secure-worker").summary).not.toMatch(/scans/i);
  });
});

describe("catalog ↔ capability integrity", () => {
  it("assigns a valid capability to every tool in the catalog", () => {
    for (const tool of tools) {
      const capability = capabilityForMode(tool.processing);
      expect(describeCapability(capability).id).toBe(capability);
      // The two booleans in this layer are written independently —
      // `usesWorkerBackend` is `capability !== "in-browser"`, while
      // `uploadsFiles` is a field set by hand on each descriptor — and the
      // copy surfaces now read the descriptor one. If they ever disagree, a
      // page promising "never leaves your device" and a validator deciding
      // where the job runs would be answering the same question differently.
      // (Was `tool.processing !== "client"`, a third spelling of the rule.)
      expect(usesWorkerBackend(capability)).toBe(
        modeUploadsFiles(tool.processing),
      );
    }
  });
});
