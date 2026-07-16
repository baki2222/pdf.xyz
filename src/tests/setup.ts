import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount anything rendered by a test and reset the DOM after every test.
//
// @testing-library/react registers this same afterEach hook automatically, but
// only as a side effect of being imported — and because our config runs the
// suite with `isolate: false`, that module is imported just once per worker and
// its auto-registration hooks only the first test file. Every later DOM test
// sharing the worker would otherwise inherit an un-reset document and see
// "found multiple elements". setupFiles run for every test file, so registering
// cleanup here restores per-file reset regardless of module caching. In the Node
// worker tests nothing is ever rendered, so cleanup() is a harmless no-op.
afterEach(() => {
  cleanup();
});
