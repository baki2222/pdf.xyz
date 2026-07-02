import { describe, expect, it } from "vitest";
import { ProcessorRegistry } from "./registry";
import { processorOk, type Processor } from "./types";

/** A minimal fake processor that owns the given tools and never really runs. */
function fakeProcessor(id: string, tools: string[]): Processor {
  return {
    id,
    tools,
    supports: (tool) => tools.includes(tool),
    capability: () => ({ id, tools, ready: true, detail: `${id} ready` }),
    process: async () => processorOk([]),
  };
}

describe("ProcessorRegistry", () => {
  it("resolves a registered processor by each of its tools", () => {
    const registry = new ProcessorRegistry();
    const proc = fakeProcessor("multi", ["a-pdf", "b-pdf"]);
    registry.register(proc);
    expect(registry.resolve("a-pdf")).toBe(proc);
    expect(registry.resolve("b-pdf")).toBe(proc);
    expect(registry.resolve("c-pdf")).toBeUndefined();
  });

  it("reports support only for registered tools", () => {
    const registry = new ProcessorRegistry();
    registry.register(fakeProcessor("one", ["a-pdf"]));
    expect(registry.supports("a-pdf")).toBe(true);
    expect(registry.supports("z-pdf")).toBe(false);
  });

  it("lists processors once and exposes their capabilities", () => {
    const registry = new ProcessorRegistry();
    registry.register(fakeProcessor("one", ["a-pdf"]));
    registry.register(fakeProcessor("two", ["b-pdf"]));
    expect(registry.list().map((p) => p.id)).toEqual(["one", "two"]);
    expect(registry.capabilities().map((c) => c.id)).toEqual(["one", "two"]);
  });

  it("is idempotent when the same processor is registered twice", () => {
    const registry = new ProcessorRegistry();
    const proc = fakeProcessor("one", ["a-pdf", "b-pdf"]);
    registry.register(proc);
    registry.register(proc);
    expect(registry.list()).toHaveLength(1);
  });

  it("throws when two different processors claim the same tool", () => {
    const registry = new ProcessorRegistry();
    registry.register(fakeProcessor("one", ["a-pdf"]));
    expect(() => registry.register(fakeProcessor("two", ["a-pdf"]))).toThrow(
      /already registered/i,
    );
  });
});
