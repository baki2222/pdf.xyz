import { waitFor } from "@testing-library/react";

/**
 * Resolves once the runner `<ToolRunner>` dispatched has rendered into
 * `container`.
 *
 * Since 2026-10-09 every runner is a `next/dynamic` loader in `tool-runner.tsx`
 * (so a tool page's first load carries only its own runner). Outside Next that
 * loader renders NOTHING on its first pass and the runner once its module has
 * loaded — which, under `isolate: false`, may already have happened in an
 * earlier file sharing this worker, or may not. A query made straight after
 * `render()` therefore reads either the runner or an empty container depending
 * on file order. It did: three runner tests found no file input, and the
 * signed-input census saw 0 single-file runners and failed its own corpus
 * floor. Every test that renders `<ToolRunner>` waits here first.
 *
 * "Rendered" is "the container has an element": every runner renders one, and
 * the loader renders none until it resolves.
 */
export async function runnerMounted(container: HTMLElement): Promise<void> {
  await waitFor(
    () => {
      if (!container.firstElementChild)
        throw new Error("the dispatched runner has not rendered yet");
    },
    // 20 s, not 5: in the native-canvas project (vitest.config.ts) each
    // file runs in a fresh process, so the runner's module graph is imported
    // cold here, and on Node 22 under load 5 s ran out in 6 of 42 runs. The
    // tests that wait here allow 30 s or more themselves.
    { timeout: 20_000 },
  );
}
