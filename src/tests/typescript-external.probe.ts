// @vitest-environment jsdom
/**
 * Run only by the child vitest of `typescript-external.test.ts` (its config
 * includes this file; the suite's `*.test.ts` glob does not). It imports
 * the compiler the way the AST guards do, from jsdom, where the source-map
 * miss was reproduced on 2026-11-22.
 */
import ts from "typescript";
import { expect, it } from "vitest";

it("loads the TypeScript compiler", () => {
  expect(typeof ts.createSourceFile).toBe("function");
});
