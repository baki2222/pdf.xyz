// @vitest-environment node
/**
 * The unsupported-encryption fixture's SHAPE, checked where qpdf is absent —
 * which is everywhere but the worker image. The real-qpdf suite and the
 * production proof both rest on this file being (a) admitted by the engine's
 * preflight, so qpdf is reached at all, and (b) encrypted with a handler that
 * is not the Standard password one. If either quietly stopped being true, the
 * qpdf-side tests would pass or fail for the wrong reason.
 */
import { describe, expect, it } from "vitest";
import { looksLikePdf } from "@/lib/workers/compression/engine";
import { unsupportedEncryptionPdf } from "./unsupported-encryption";

describe("unsupportedEncryptionPdf", () => {
  it("passes the engine's preflight, so a real run reaches qpdf", async () => {
    expect(looksLikePdf(await unsupportedEncryptionPdf())).toBe(true);
  });

  it("carries an /Encrypt trailer entry whose handler is not /Standard", async () => {
    const text = Buffer.from(await unsupportedEncryptionPdf()).toString(
      "latin1",
    );
    const trailer = text.slice(text.lastIndexOf("trailer"));
    const ref = /\/Encrypt\s+(\d+)\s+(\d+)\s+R/.exec(trailer);
    expect(ref, "no /Encrypt reference in the trailer").toBeTruthy();
    const object = new RegExp(
      String.raw`(?:^|\n)${ref![1]}\s+${ref![2]}\s+obj\s*<<([\s\S]*?)>>\s*endobj`,
    ).exec(text);
    expect(object, "the /Encrypt object is missing").toBeTruthy();
    const filter = /\/Filter\s*\/([^\s/<>]+)/.exec(object![1]!)?.[1];
    // Positive control on the extraction: a filter was found at all …
    expect(filter).toBeTruthy();
    // … and it is the one no password can open.
    expect(filter).not.toBe("Standard");
    expect(filter).toBe("Adobe.PubSec");
  });
});
