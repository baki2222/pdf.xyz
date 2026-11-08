// @native-canvas
/**
 * SIB-06 adversarial verification: does classifyPdfAccess ever settle on an
 * owner-only file whose /Encrypt says /Length 1000000000, and how long does a
 * smaller hostile /Length take? Positive control: the same file at /Length 128.
 *
 * SLOW: the 1e9 cell is bounded at 300 s on purpose (it measures whether the
 * "hang" is finite). Measured 2026-11-08: 128 -> restricted 14 ms; 8e6 ->
 * password-required 578 ms; 8e7 -> 6.2 s; 1e9 -> password-required 75.9 s.
 * Linear in /Length: finite, CPU-bound, and the verdict is wrong.
 */
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyPdfAccess } from "@/lib/pdf/encryption";
import { ONE_PAGE, ownerOnlyEncrypted } from "./security-in-browser.fixtures";

const requireHere = createRequire(`${process.cwd()}/package.json`);
async function pdfjsLegacy() {
  return import(
    pathToFileURL(requireHere.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href
  );
}

function fixture(length: number): Uint8Array {
  return ownerOnlyEncrypted(ONE_PAGE, {
    encryptDict: (d) => d.replace("/Length 128", `/Length ${length}`),
  });
}

async function timed(length: number, boundMs: number) {
  const bytes = fixture(length);
  const text = new TextDecoder("latin1").decode(bytes);
  expect(text).toContain(`/Length ${length}`); // mutation landed
  const pdfjs = await pdfjsLegacy();
  const t0 = performance.now();
  const result = await Promise.race([
    classifyPdfAccess(bytes, pdfjs),
    new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), boundMs)),
  ]);
  const ms = Math.round(performance.now() - t0);
  appendFileSync("sib06.log", `SIB06 /Length ${length}: ${JSON.stringify(result)} in ${ms} ms
`);
  return { result, ms };
}

describe("SIB-06 verify", () => {
  it("positive control: /Length 128 classifies quickly", async () => {
    const { result } = await timed(128, 15_000);
    expect(result).not.toBe("TIMEOUT");
  }, 20_000);

  it("/Length 8000000 (1 MB key) scale point", async () => {
    await timed(8_000_000, 60_000);
  }, 70_000);

  it("/Length 80000000 (10 MB key) scale point", async () => {
    await timed(80_000_000, 120_000);
  }, 130_000);

  it("/Length 1000000000 within 300 s?", async () => {
    await timed(1_000_000_000, 300_000);
  }, 310_000);
});
