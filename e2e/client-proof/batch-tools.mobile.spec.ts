import { expect, test } from "@playwright/test";
import { attachConsoleGuard } from "../helpers";
import { expectMagic } from "./artifacts";
import { BATCH_VARIANTS } from "./batch-cases";
import { expectControlRejected, type CaseContext } from "./cases";

/**
 * The settings batches on a phone (batch plan P1): the same cases the
 * desktop proof runs (`client-tools.spec.ts`, as VARIANTS), run here at the
 * mobile project's 390px with touch — the archive saved, opened, each PDF in
 * it decoded, no request to `/api/`, and every control rejected for its own
 * reason. A phone is where a batch holds the most in the least memory.
 */

// Health: the cases were found, one per settings batch.
test("the batch cases are not empty", () => {
  expect(BATCH_VARIANTS.length).toBeGreaterThanOrEqual(5);
});

for (const proof of BATCH_VARIANTS) {
  test(`${proof.slug} on a phone: ${proof.name} — the ZIP holds both, each right`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const guard = attachConsoleGuard(page);
    await page.goto(`/tools/${proof.slug}`);
    const ctx: CaseContext = { page, data: {} };
    const artifact = await proof.run(ctx);
    expectMagic(artifact, proof.artifact);
    await proof.assert(artifact, ctx);
    const declared = await proof.control(ctx);
    const controls = Array.isArray(declared) ? declared : [declared];
    expect(controls.length).toBeGreaterThan(0);
    for (const index of controls.keys())
      await expectControlRejected(proof.slug, proof, controls, index, ctx);
    expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  });
}
