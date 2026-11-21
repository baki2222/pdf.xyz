import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import base, { sharedTestOptions } from "../../vitest.config";
import { TimeoutHeadroomReporter } from "./timeout-headroom";

/**
 * The config `time-bound-chain.test.ts` runs a child vitest with: the
 * suite's own setup files (so the wait recorder is the real one), the
 * reporters CI runs (default and the headroom reporter), and a 3000 ms hookTimeout so the
 * fixture's 1950 ms beforeAll is over half of it, about 1000 ms either way.
 *
 * `TIME_BOUND_CHAIN_HELPER` swaps the fixture's `./time-bound` for a mutant
 * the parent writes (the registration deleted), so the control runs through
 * the same child, config and reporter as the real run.
 */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MUTANT = process.env.TIME_BOUND_CHAIN_HELPER;
const baseAlias = (base.resolve?.alias ?? {}) as Record<string, string>;

export default defineConfig({
  plugins: base.plugins,
  resolve: {
    alias: [
      ...Object.entries(baseAlias).map(([find, replacement]) => ({
        find,
        replacement,
      })),
      ...(MUTANT ? [{ find: /^\.\/time-bound$/, replacement: MUTANT }] : []),
    ],
  },
  test: {
    ...sharedTestOptions,
    include: ["src/tests/time-bound-chain.fixture.ts"],
    globalSetup: [],
    pool: "forks",
    hookTimeout: 3000,
    // As CI names them (vitest.config.ts): "default" prints each test's
    // console lines, which is the log the harvest reads.
    reporters: [
      "default",
      new TimeoutHeadroomReporter({
        root: ROOT,
        github: true,
        brokenPipeMinTests: 1,
        ...(process.env.TIME_BOUND_CHAIN_SUMMARY
          ? { stepSummary: process.env.TIME_BOUND_CHAIN_SUMMARY }
          : {}),
      }),
    ],
  },
});
