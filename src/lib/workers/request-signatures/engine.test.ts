import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  REQUEST_SIGNATURES_ENGINE,
  runSignatureRequest,
  type PdfGeometry,
  type PlacedField,
  type SignatureRequestDeps,
} from "./engine";
import type { SignatureRequestOptions } from "@/lib/jobs/request-signatures";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

function geometry(pageCount = 1): PdfGeometry {
  return {
    pageCount,
    pageSizes: Array.from({ length: pageCount }, () => ({ width: 612, height: 792 })),
  };
}

function options(over: Partial<SignatureRequestOptions> = {}): SignatureRequestOptions {
  return {
    signers: [
      { name: "Ada Lovelace", email: "ada@example.com" },
      { name: "Alan Turing", email: "alan@example.com" },
    ],
    fields: [
      { signer: 0, page: 1, type: "signature", x: 0.1, y: 0.1, width: 0.35, height: 0.06, required: true },
      { signer: 1, page: 1, type: "date", x: 0.55, y: 0.1, width: 0.2, height: 0.05, required: true },
    ],
    routing: "sequential",
    deliver: false,
    ...over,
  };
}

/** Deterministic deps: a fake inspector, a placer that records what it was asked to add. */
function deps(over: Partial<SignatureRequestDeps> = {}): {
  deps: SignatureRequestDeps;
  placed: PlacedField[];
} {
  const placed: PlacedField[] = [];
  const base: SignatureRequestDeps = {
    inspect: vi.fn(async () => geometry()),
    place: vi.fn(async (_bytes: Uint8Array, fields: PlacedField[]) => {
      placed.push(...fields);
      return new Uint8Array([1, 2, 3, 4]);
    }),
    digest: vi.fn(async () => "a".repeat(64)),
    now: () => "2026-07-15T00:00:00.000Z",
    ...over,
  };
  return { deps: base, placed };
}

describe("runSignatureRequest", () => {
  it("fails honestly when no preparer is wired", async () => {
    const run = await runSignatureRequest(PDF, options(), {});
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("unsupported");
  });

  it("builds a real signature-request package with prepared PDF + manifest", async () => {
    const { deps: d, placed } = deps();
    const run = await runSignatureRequest(PDF, options(), d);
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    expect(run.contentType).toBe("application/zip");
    expect(run.filenameExt).toBe("zip");
    expect(run.meta).toMatchObject({
      engine: REQUEST_SIGNATURES_ENGINE,
      tool: "request-signatures",
      signerCount: 2,
      fieldCount: 2,
      pageCount: 1,
    });

    // Two real, uniquely-named fields were placed at converted POINT coordinates.
    expect(placed).toHaveLength(2);
    const names = placed.map((f) => f.name);
    expect(new Set(names).size).toBe(2);
    // 0.1 * 612 = 61.2, 0.1 * 792 = 79.2 — real conversion, not fractional passthrough.
    expect(placed[0]!.x).toBeCloseTo(61.2, 1);
    expect(placed[0]!.y).toBeCloseTo(79.2, 1);
    expect(placed[0]!.width).toBeCloseTo(214.2, 1);

    const zip = await JSZip.loadAsync(run.output);
    // Prepared PDF is the placer's real output.
    expect(await zip.file("prepared.pdf")!.async("uint8array")).toEqual(new Uint8Array([1, 2, 3, 4]));

    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.tool).toBe("request-signatures");
    expect(manifest.status).toBe("prepared");
    expect(manifest.document.sha256).toBe("a".repeat(64));
    expect(manifest.document.pageCount).toBe(1);
    expect(manifest.signers).toHaveLength(2);
    expect(manifest.signers[0].order).toBe(1);
    expect(manifest.signers[0].email).toBe("ada@example.com");
    // Each signer gets a stable, deterministic token (not a secret, just a reference).
    expect(typeof manifest.signers[0].token).toBe("string");
    expect(manifest.signers[0].token.length).toBeGreaterThan(0);
    // Honest: never claims the document was signed/completed.
    expect(JSON.stringify(manifest)).not.toMatch(/"signed"|"completed"/);
    expect(manifest.delivery.mode).toBe("manual");

    // A human-readable README and a seed audit trail with a single real event.
    expect(await zip.file("README.txt")!.async("string")).toMatch(/signature request/i);
    const audit = JSON.parse(await zip.file("audit-trail.json")!.async("string"));
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0].type).toBe("request.prepared");
  });

  it("rejects a field whose page exceeds the document", async () => {
    const { deps: d } = deps();
    const run = await runSignatureRequest(
      PDF,
      options({
        fields: [{ signer: 0, page: 3, type: "signature", x: 0.1, y: 0.1, width: 0.2, height: 0.05, required: true }],
      }),
      d,
    );
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("invalid_request");
  });

  it("rejects oversized input before touching the preparer", async () => {
    const inspect = vi.fn(async () => geometry());
    const run = await runSignatureRequest(PDF, options(), {
      inspect,
      place: async () => PDF,
      limits: { maxInputBytes: 4 },
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("too_large");
    expect(inspect).not.toHaveBeenCalled();
  });

  it("fails honestly when external delivery is requested but no provider is configured", async () => {
    const { deps: d } = deps();
    const run = await runSignatureRequest(PDF, options({ deliver: true }), d);
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("delivery_unconfigured");
  });

  it("records the provider in the manifest when a delivery provider IS configured", async () => {
    const { deps: d } = deps({ delivery: { id: "example-esign" } });
    const run = await runSignatureRequest(PDF, options({ deliver: true }), d);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const zip = await JSZip.loadAsync(run.output);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.delivery.mode).toBe("provider");
    expect(manifest.delivery.provider).toBe("example-esign");
    // Still honest: handed off, never "completed"/"signed".
    expect(manifest.status).toBe("prepared");
  });

  it("maps a preparer crash to a retryable failure", async () => {
    const run = await runSignatureRequest(PDF, options(), {
      inspect: async () => geometry(),
      place: async () => {
        throw new Error("pdf-lib blew up");
      },
      digest: async () => "b".repeat(64),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });
});
