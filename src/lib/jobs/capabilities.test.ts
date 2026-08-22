import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
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

describe("worker pipeline stages", () => {
  // This block used to assert `expect(ids).toContain("scan")` unconditionally, which
  // pinned the defect rather than catching it: the stage list was static, so the
  // product told every user "Every file is scanned before any processor touches it"
  // while the malware scanner was optional, off by default, and not configured on
  // production. The test agreed with the copy because both were written from the same
  // wrong assumption. The claim is now a function of the live capability, and what is
  // worth asserting is that the two branches differ in exactly the right way.
  it("keeps its shape in both branches — unique ids, real titles and descriptions", () => {
    for (const active of [true, false]) {
      const stages = workerPipelineStages(active);
      const ids = stages.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain("upload");
      expect(ids).toContain("process");
      expect(ids).toContain("delete");
      for (const stage of stages) {
        expect(stage.title.length).toBeGreaterThan(0);
        expect(stage.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("claims a malware scan only when one is actually running", () => {
    const scanning = workerPipelineStages(true).map((s) => s.id);
    const notScanning = workerPipelineStages(false).map((s) => s.id);
    expect(scanning).toContain("scan");
    expect(notScanning).not.toContain("scan");
    // The stage is replaced, not dropped: the structural preflight is a real gate
    // that really does reject files, so the step count and the flow stay truthful.
    expect(notScanning).toContain("preflight");
    expect(notScanning.length).toBe(scanning.length);
  });

  it("never uses the word malware as a promise when nothing is scanning", () => {
    const copy = workerPipelineStages(false)
      .map((s) => `${s.title} ${s.description}`)
      .join(" ");
    // It may *mention* malware — saying "files are not scanned for malware here" is
    // the honest disclosure. What it must never do is assert scanning happens.
    expect(copy).not.toMatch(/every file is scanned for malware/i);
    expect(copy).toMatch(/not scanned for malware/i);
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
