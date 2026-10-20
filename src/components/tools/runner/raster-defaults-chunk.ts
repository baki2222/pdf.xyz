/**
 * PDF to Image's smart default and option memory, fetched while its file
 * opens rather than with the page: the runner passes
 * {@link loadRasterDefaults} as the open's `prepare`, so both modules are in
 * memory — read synchronously by {@link rasterDefaults} — before the editor
 * is first drawn, and its resolution chips never change under the reader.
 * A page that never opens a file never downloads them (spec G.1: the
 * package's tool-page growth is held to 1.5 KB gz).
 *
 * If the fetch fails the editor opens at the usual default, remembering
 * nothing: a missed convenience, never a wrong claim.
 */
type Defaults = typeof import("@/lib/intent/defaults");
type Memory = typeof import("@/lib/intent/option-memory");

let loaded: { readonly defaults: Defaults; readonly memory: Memory } | null =
  null;

export async function loadRasterDefaults(): Promise<void> {
  if (loaded) return;
  const [defaults, memory] = await Promise.all([
    import("@/lib/intent/defaults"),
    import("@/lib/intent/option-memory"),
  ]);
  loaded = { defaults, memory };
}

/** Both modules, or null until {@link loadRasterDefaults} has resolved. */
export function rasterDefaults(): typeof loaded {
  return loaded;
}
