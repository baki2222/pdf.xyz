import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  createRequestSignaturesProcessor,
  requestSignaturesOutputName,
} from "./request-signatures";
import type { PdfGeometry, PlacedField } from "../request-signatures/engine";
import { PdfEngineError } from "@/lib/pdf/engine";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);

function geometry(): PdfGeometry {
  return { pageCount: 1, pageSizes: [{ width: 612, height: 792 }] };
}

function readyDeps() {
  return {
    inspect: vi.fn(async () => geometry()),
    place: vi.fn(
      async (_b: Uint8Array, _f: PlacedField[]) => new Uint8Array([9, 9, 9]),
    ),
    digest: vi.fn(async () => "c".repeat(64)),
    now: () => "2026-07-15T00:00:00.000Z",
  };
}

const goodOptions = {
  signers: [{ name: "Ada", email: "ada@example.com" }],
  fields: [
    {
      signer: 0,
      page: 1,
      type: "signature",
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.05,
    },
  ],
};

function input(options: Record<string, unknown>, filename = "contract.pdf") {
  return {
    tool: "request-signatures",
    options,
    inputs: [
      { fileId: "f", filename, contentType: "application/pdf", bytes: PDF },
    ],
  };
}

describe("request-signatures processor", () => {
  it("owns request-signatures and reports readiness", () => {
    const processor = createRequestSignaturesProcessor(readyDeps());
    expect(processor.tools).toEqual(["request-signatures"]);
    expect(processor.supports("request-signatures")).toBe(true);
    expect(processor.capability()).toMatchObject({
      id: "request-signatures",
      ready: true,
    });
  });

  it("fails honestly without a preparer", async () => {
    const result = await createRequestSignaturesProcessor({}).process(
      input(goodOptions),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_implemented");
  });

  it("builds a signature-request package for a valid request", async () => {
    const result = await createRequestSignaturesProcessor(readyDeps()).process(
      input(goodOptions, "annual.report.pdf"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifacts[0]).toMatchObject({
        filename: "annual.report-signature-request.zip",
        contentType: "application/zip",
      });
      expect(result.meta).toMatchObject({
        tool: "request-signatures",
        signerCount: 1,
        fieldCount: 1,
      });
      const zip = await JSZip.loadAsync(result.artifacts[0]!.bytes);
      expect(zip.file("prepared.pdf")).not.toBeNull();
      expect(zip.file("manifest.json")).not.toBeNull();
    }
  });

  it("rejects an invalid options bag with the contract's invalid_request code", async () => {
    const result = await createRequestSignaturesProcessor(readyDeps()).process(
      input({ signers: [], fields: [] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("maps an engine-level bad request (field off the document) to unprocessable_entity", async () => {
    const result = await createRequestSignaturesProcessor(readyDeps()).process(
      input({
        signers: [{ name: "Ada", email: "ada@example.com" }],
        fields: [
          {
            signer: 0,
            page: 9,
            type: "signature",
            x: 0.1,
            y: 0.1,
            width: 0.3,
            height: 0.05,
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
  });

  it("fails a password-protected PDF once, terminally, with the loader's reason", async () => {
    const reason =
      "This PDF is password-protected. Unlock it first, then try again.";
    const result = await createRequestSignaturesProcessor({
      ...readyDeps(),
      inspect: vi.fn(async () => {
        throw new PdfEngineError(reason);
      }),
    }).process(input(goodOptions));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: "unprocessable_entity",
      message: reason,
      retryable: false,
    });
  });

  it("surfaces the honest delivery-not-configured failure as not_implemented", async () => {
    const result = await createRequestSignaturesProcessor(readyDeps()).process(
      input({ ...goodOptions, deliver: true }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_implemented");
  });

  it("rejects a malformed input count", async () => {
    const result = await createRequestSignaturesProcessor(readyDeps()).process({
      tool: "request-signatures",
      options: goodOptions,
      inputs: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
  });

  it("builds deterministic output names", () => {
    expect(requestSignaturesOutputName("contract.pdf")).toBe(
      "contract-signature-request.zip",
    );
  });
});
