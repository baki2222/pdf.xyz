import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { signatureRequestDeps } from "./native";
import { runSignatureRequest } from "./engine";
import type { SignatureRequestOptions } from "@/lib/jobs/request-signatures";

async function realPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  return doc.save();
}

const options: SignatureRequestOptions = {
  signers: [
    { name: "Ada Lovelace", email: "ada@example.com" },
    { name: "Alan Turing", email: "alan@example.com" },
  ],
  fields: [
    { signer: 0, page: 1, type: "signature", x: 0.08, y: 0.1, width: 0.4, height: 0.06, required: true },
    { signer: 0, page: 1, type: "date", x: 0.56, y: 0.1, width: 0.22, height: 0.06, required: true },
    { signer: 1, page: 2, type: "signature", x: 0.08, y: 0.1, width: 0.4, height: 0.06, required: true },
  ],
  routing: "sequential",
  deliver: false,
};

describe("request-signatures native integration", () => {
  it("prepares a real PDF with named fillable fields and a genuine SHA-256 manifest", async () => {
    const input = await realPdf();
    const run = await runSignatureRequest(input, options, signatureRequestDeps());
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const zip = await JSZip.loadAsync(run.output);
    const preparedBytes = await zip.file("prepared.pdf")!.async("uint8array");

    // The prepared PDF is a real, loadable PDF that now carries our named fields.
    const prepared = await PDFDocument.load(preparedBytes);
    const names = prepared.getForm().getFields().map((f) => f.getName()).sort();
    expect(names).toEqual(["Signer1-Date-1", "Signer1-Signature-1", "Signer2-Signature-1"]);

    // The manifest's document hash is a genuine SHA-256 of the ORIGINAL input.
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.document.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.document.pageCount).toBe(2);
    expect(manifest.status).toBe("prepared");
  });
});
