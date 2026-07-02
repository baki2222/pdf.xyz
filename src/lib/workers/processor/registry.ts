/**
 * The processor registry: a small, pure map from a tool slug to the
 * {@link Processor} that runs it. The executor (and the local-dev adapter) resolve
 * a processor here, so adding a new secure-worker capability is a single
 * `register()` call rather than a new branch in the orchestration code.
 *
 * It is deliberately dependency-free and node-free: registration wires already
 * constructed processors (whose own dependencies were injected at build time), so
 * the registry never pulls a native engine or a Node built-in into a bundle.
 */

import type { Processor, ProcessorCapability } from "./types";

/** A registry of processors keyed by the tool slugs each one owns. */
export class ProcessorRegistry {
  private readonly byTool = new Map<string, Processor>();
  private readonly processors: Processor[] = [];

  /**
   * Register a processor for every tool it declares. Throws if two different
   * processors claim the same tool — an ambiguous route is a wiring bug, not a
   * silent last-writer-wins.
   */
  register(processor: Processor): this {
    for (const tool of processor.tools) {
      const existing = this.byTool.get(tool);
      if (existing && existing !== processor) {
        throw new Error(
          `A processor is already registered for tool "${tool}".`,
        );
      }
      this.byTool.set(tool, processor);
    }
    if (!this.processors.includes(processor)) this.processors.push(processor);
    return this;
  }

  /** The processor that owns `tool`, or `undefined` if none is registered. */
  resolve(tool: string): Processor | undefined {
    return this.byTool.get(tool);
  }

  /** True when a registered processor accepts this tool (and optional options). */
  supports(tool: string, options?: Record<string, unknown>): boolean {
    const processor = this.byTool.get(tool);
    return processor ? processor.supports(tool, options) : false;
  }

  /** Every registered processor, in registration order. */
  list(): readonly Processor[] {
    return this.processors;
  }

  /** The honest, presence-only capability of every registered processor. */
  capabilities(): ProcessorCapability[] {
    return this.processors.map((processor) => processor.capability());
  }
}
