import { defineConfig } from "vitest/config";
import base, { sharedTestOptions } from "../../vitest.config";

/**
 * The config `typescript-external.test.ts` runs a child vitest with: the
 * suite's own shared options over one probe file. With
 * `TS_EXTERNAL_CONTROL=inline` the external list is emptied, which is the
 * positive control: the probe must then print the source-map miss.
 */
const inline = process.env.TS_EXTERNAL_CONTROL === "inline";

export default defineConfig({
  plugins: base.plugins,
  resolve: base.resolve,
  test: {
    ...sharedTestOptions,
    ...(inline ? { server: { deps: { external: [] } } } : {}),
    include: ["src/tests/typescript-external.probe.ts"],
    // The worker-CLI precompile is for the CLI smoke tests; none run here.
    globalSetup: [],
  },
});
