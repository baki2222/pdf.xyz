// @vitest-environment node
// @native-canvas
/**
 * PS-11 verify: countPagesWithPdfjs returns /Count as declared (-1, 0) and a
 * cyclic tree with no page as 1. Records what it returns beside pdf-lib.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { countPagesWithPdfjs } from "@/lib/pdf/pdfjs-page-count";
import { rawPdf } from "./page-structure.raw";

const cat = "<< /Type /Catalog /Pages 2 0 R >>";
const page =
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>";
const content = "<< /Length 0 >>\nstream\n\nendstream";

function withCount(count: string): Uint8Array {
  return rawPdf({
    objects: [
      cat,
      `<< /Type /Pages /Kids [3 0 R] /Count ${count} >>`,
      page,
      content,
    ],
  });
}

async function outcome(bytes: Uint8Array): Promise<string> {
  const t = new Promise<string>((r) => setTimeout(() => r("TIMEOUT"), 15000));
  const run = countPagesWithPdfjs(bytes).then(
    (n) => `count=${n}`,
    (e: unknown) => `throw=${(e as Error)?.name}:${(e as Error)?.message}`,
  );
  return Promise.race([run, t]);
}

async function pdfLib(bytes: Uint8Array): Promise<string> {
  try {
    const d = await PDFDocument.load(bytes, { updateMetadata: false });
    return `pdflib=${d.getPageCount()}`;
  } catch (e) {
    return `pdflib-throw=${(e as Error).message}`;
  }
}

describe("PS-11", () => {
  for (const c of ["-1", "0", "1", "2147483647"]) {
    it(`/Count ${c}`, { timeout: 30000 }, async () => {
      const b = withCount(c);
      const got = await outcome(b);
      console.log(`PS11 /Count ${c}: ${got} ${await pdfLib(b)}`);
      expect(got).not.toBe("TIMEOUT");
    });
  }
  it("cycle declaring /Count 1", { timeout: 30000 }, async () => {
    // Pages node whose only kid is itself.
    const b = rawPdf({
      objects: [cat, "<< /Type /Pages /Kids [2 0 R] /Count 1 >>"],
    });
    const got = await outcome(b);
    console.log(`PS11 cycle: ${got} ${await pdfLib(b)}`);
    expect(got).not.toBe("TIMEOUT");
  });
});
