// @vitest-environment node
/**
 * The `translateReadingOrder` probe on a REAL poppler `pdftotext`, gated like
 * `pdf-office-export/engine.poppler.test.ts`: it skips VISIBLY (the suite
 * label says so) where no poppler is on PATH. The shipped binary is checked
 * by `scripts/worker-translate-reading-order-proof.ts` inside the built
 * worker image (`.github/workflows/container.yml`), which is what makes the
 * heartbeat key true of the image rather than of this host.
 *
 * THE DESIGN'S POSITIVE CONTROL: the same probe wired to the shared resolver
 * every other AI tool reads (`resolveNativePdfTextExtractor`) must be false
 * FOR THE ORDER CHECKS — `failed` includes "order_sent" and
 * "order_delivered". A false that came only from "source" would be a control
 * that never looked at order.
 */
import { describe, expect, it } from "vitest";
import { findPopplerPdfToText } from "@/tests/pdf-office-fixtures";
import { resolveNativePdfTextExtractor } from "../pdf-text/native";
import { translateDeps } from "./native";
import {
  probeTranslateReadingOrder,
  provesTranslateReadingOrder,
} from "./reading-order-capability";

const POPPLER = findPopplerPdfToText();
const suite = describe.skipIf(!POPPLER);
const label = POPPLER
  ? "translateReadingOrder on real poppler"
  : "translateReadingOrder on real poppler (SKIPPED: no poppler pdftotext found on PATH)";

suite(label, () => {
  const env = { PDFXYZ_PDF_TEXT_BIN: POPPLER! };

  it("provesTranslateReadingOrder is true, with every check passing", async () => {
    const verdict = await probeTranslateReadingOrder({
      extract: translateDeps(env).extract,
      env,
    });
    expect(verdict).toEqual({ ok: true, failed: [] });
    await expect(provesTranslateReadingOrder(env)).resolves.toBe(true);
  });

  it("POSITIVE CONTROL: the shared resolver fails the ORDER checks on the same page", async () => {
    const verdict = await probeTranslateReadingOrder({
      extract: resolveNativePdfTextExtractor(env),
      env,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toContain("order_sent");
    expect(verdict.failed).toContain("order_delivered");
    // The page DID interleave under -layout here, so the control was real.
    expect(verdict.failed).not.toContain("control");
  });
});
