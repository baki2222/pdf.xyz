import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import type { ProcessingMode } from "@/lib/tools/types";
import {
  CAPABILITY_BY_MODE,
  capabilityForMode,
  describeCapability,
  getToolCapability,
  getToolInputKind,
  usesWorkerBackend,
  WORKER_PIPELINE_STAGES,
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
    const caps: ToolCapability[] = ["in-browser", "secure-worker", "hybrid", "ai"];
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
  it("has unique, ordered stages including scan, process, and auto-delete", () => {
    const ids = WORKER_PIPELINE_STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("upload");
    expect(ids).toContain("scan");
    expect(ids).toContain("process");
    expect(ids).toContain("delete");
    for (const stage of WORKER_PIPELINE_STAGES) {
      expect(stage.title.length).toBeGreaterThan(0);
      expect(stage.description.length).toBeGreaterThan(0);
    }
  });
});

describe("catalog ↔ capability integrity", () => {
  it("assigns a valid capability to every tool in the catalog", () => {
    for (const tool of tools) {
      const capability = capabilityForMode(tool.processing);
      expect(describeCapability(capability).id).toBe(capability);
      // A worker capability iff the tool is not a pure client tool.
      expect(usesWorkerBackend(capability)).toBe(tool.processing !== "client");
    }
  });
});
