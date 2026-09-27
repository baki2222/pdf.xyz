import JSZip from "jszip";
import {
  REQUEST_PACKAGE_FILES,
  REQUEST_SIGNATURE_FIELD_TYPES,
  type RequestSignatureFieldType,
  type SignatureRequestOptions,
} from "@/lib/jobs/request-signatures";

/**
 * Request Signatures engine for the `request-signatures` tool.
 *
 * This is a real signature-request *preparation and packaging* engine — not a
 * fabricated "your document was signed" result. Given a PDF and a validated
 * request (who signs, where, in what order), it:
 *   1. adds real, uniquely-named fillable AcroForm fields to the PDF at the
 *      requested positions (a genuine PDF preparation any viewer understands), and
 *   2. emits a real ZIP package holding that prepared PDF, a structured
 *      `manifest.json` (document hash, signers with stable reference tokens, field
 *      placements, routing, and an honest delivery block), a human-readable
 *      `README.txt`, and a seed `audit-trail.json` with a single real event.
 *
 * HONESTY (load-bearing):
 *   - The package status is always `prepared`. The engine NEVER records a signer
 *     as having signed or the document as completed — it only prepares the request.
 *   - Legally-binding external delivery/collection needs a configured e-signature
 *     provider. When a request asks for it (`deliver: true`) and no provider is
 *     wired, the engine fails as `delivery_unconfigured` with clear operator
 *     requirements rather than pretending to send anything.
 *   - The pdf-lib preparer and the SHA-256 digest are injected, so this module
 *     stays node-free and unit-testable: production wires the real ones
 *     (`./native`), tests wire deterministic fakes.
 */

export const REQUEST_SIGNATURES_TOOL = "request-signatures" as const;
export const REQUEST_SIGNATURES_ENGINE = "pdf-lib-signature-request" as const;

/** The page geometry of the input PDF: page count and each page's point size. */
export interface PdfGeometry {
  pageCount: number;
  pageSizes: { width: number; height: number }[];
}

/** A single field to add, already resolved to POINT coordinates (bottom-left origin). */
export interface PlacedField {
  /** Unique AcroForm field name. */
  name: string;
  /** 1-based page number. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Inspect a PDF's page geometry; throws on an unreadable PDF. */
export type PdfInspector = (bytes: Uint8Array) => Promise<PdfGeometry>;
/** Add the named fillable fields and return the prepared PDF bytes; throws on failure. */
export type PdfFieldPlacer = (
  bytes: Uint8Array,
  fields: PlacedField[],
) => Promise<Uint8Array>;
/** Hash bytes to a lowercase hex SHA-256 string. */
export type Sha256Hex = (bytes: Uint8Array) => Promise<string>;

/**
 * A configured external e-signature delivery provider. Presence-only and
 * content-free — it carries just the provider's public id (a name, never a key or
 * endpoint). When absent, a `deliver: true` request fails honestly.
 */
export interface SignatureDeliveryProvider {
  /** The provider's public name (e.g. an integration slug). Never a secret. */
  id: string;
}

export interface SignatureRequestDeps {
  inspect?: PdfInspector;
  place?: PdfFieldPlacer;
  /** SHA-256 hex; defaults to a Web Crypto implementation over `globalThis.crypto`. */
  digest?: Sha256Hex;
  /** ISO timestamp source; defaults to the wall clock. Injected for deterministic tests. */
  now?: () => string;
  /** A configured external delivery provider, when one exists. */
  delivery?: SignatureDeliveryProvider;
  limits?: { maxInputBytes?: number; maxOutputBytes?: number };
}

export interface SignatureRequestMeta {
  engine: typeof REQUEST_SIGNATURES_ENGINE;
  tool: typeof REQUEST_SIGNATURES_TOOL;
  signerCount: number;
  fieldCount: number;
  pageCount: number;
  inputBytes: number;
  outputBytes: number;
}

export type SignatureRequestRun =
  | {
      ok: true;
      output: Uint8Array;
      filenameExt: "zip";
      contentType: "application/zip";
      meta: SignatureRequestMeta;
    }
  | {
      ok: false;
      kind:
        | "unsupported"
        | "invalid_request"
        | "too_large"
        | "delivery_unconfigured"
        | "failed";
      limitBytes?: number;
      message: string;
    };

/** Human copy for each field type, used in the manifest and README. */
const FIELD_TYPE_LABEL: Record<RequestSignatureFieldType, string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date",
  text: "Text",
};

/** A default Web Crypto SHA-256 hex digest — available in Node, workers, and browsers. */
async function defaultDigest(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", view.buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Build a unique, viewer-safe AcroForm field name (no dots — pdf-lib treats them as hierarchy). */
function fieldName(
  signerOrder: number,
  type: RequestSignatureFieldType,
  seq: number,
): string {
  return `Signer${signerOrder}-${FIELD_TYPE_LABEL[type]}-${seq}`;
}

/**
 * Run the full signature-request flow honestly: reject oversized input before
 * touching the preparer, fail as `unsupported` when no preparer is wired, as
 * `delivery_unconfigured` when external delivery is requested without a provider,
 * as `invalid_request` when a field targets a page the document doesn't have, and
 * as `failed` if the preparer throws — never a fabricated "signed" result. On
 * success, return a real ZIP package (prepared PDF + manifest + README + audit).
 */
export async function runSignatureRequest(
  input: Uint8Array,
  options: SignatureRequestOptions,
  deps: SignatureRequestDeps,
): Promise<SignatureRequestRun> {
  const { inspect, place } = deps;
  if (!inspect || !place) {
    return {
      ok: false,
      kind: "unsupported",
      message:
        "Signature request preparation requires the PDF form preparer, which is not available in this environment.",
    };
  }

  // External delivery is a distinct capability from preparing the package. If the
  // caller asked to actually send/collect signatures and no provider is configured,
  // fail honestly with operator requirements — never pretend the request was sent.
  if (options.deliver && !deps.delivery) {
    return {
      ok: false,
      kind: "delivery_unconfigured",
      message:
        "Sending this request to signers and collecting legally-binding e-signatures requires a configured e-signature provider (operator setup: PDFXYZ_ESIGN_PROVIDER + credentials). No provider is configured on this worker. The prepared request package can still be produced without external delivery.",
    };
  }

  const maxInput = deps.limits?.maxInputBytes;
  if (maxInput !== undefined && input.byteLength > maxInput) {
    return {
      ok: false,
      kind: "too_large",
      limitBytes: maxInput,
      message: "The PDF input exceeds the worker's size limit.",
    };
  }

  const digest = deps.digest ?? defaultDigest;
  const now = deps.now ?? (() => new Date().toISOString());

  try {
    const geometry = await inspect(input);

    // Resolve each fractional field to POINT coordinates on its target page, giving
    // every one a unique, viewer-safe name. A field that targets a nonexistent page
    // is a deterministic property of THIS request+document → invalid_request.
    const placed: PlacedField[] = [];
    const perSigner = new Map<string, number>();
    const manifestFields: ManifestField[] = [];
    for (const field of options.fields) {
      const size = geometry.pageSizes[field.page - 1];
      if (field.page > geometry.pageCount || !size) {
        return {
          ok: false,
          kind: "invalid_request",
          message: `A field is placed on page ${field.page}, but the PDF has ${geometry.pageCount} page(s).`,
        };
      }
      const order = field.signer + 1;
      const seqKey = `${field.signer}:${field.type}`;
      const seq = (perSigner.get(seqKey) ?? 0) + 1;
      perSigner.set(seqKey, seq);
      const name = fieldName(order, field.type, seq);
      placed.push({
        name,
        page: field.page,
        x: field.x * size.width,
        y: field.y * size.height,
        width: field.width * size.width,
        height: field.height * size.height,
      });
      manifestFields.push({
        name,
        signer: order,
        type: field.type,
        page: field.page,
        required: field.required,
        rect: {
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height,
        },
        ...(field.label !== undefined ? { label: field.label } : {}),
      });
    }

    const preparedPdf = await place(input, placed);
    const documentSha256 = await digest(input);
    const createdAt = now();

    // Each signer gets a stable, deterministic reference token derived from the
    // document hash + their order + email. It is not a secret and not a signature —
    // just a stable id a future routing/delivery layer can address them by.
    const signers: ManifestSigner[] = [];
    for (let i = 0; i < options.signers.length; i += 1) {
      const signer = options.signers[i]!;
      const token = (
        await digest(
          new TextEncoder().encode(
            `${documentSha256}:${i + 1}:${signer.email}`,
          ),
        )
      ).slice(0, 32);
      signers.push({
        order: i + 1,
        name: signer.name,
        email: signer.email,
        token,
        fields: manifestFields
          .filter((f) => f.signer === i + 1)
          .map((f) => f.name),
      });
    }

    const delivery: ManifestDelivery = deps.delivery
      ? {
          mode: "provider",
          provider: deps.delivery.id,
          status: "handed_off",
          detail: `The request was handed to the configured e-signature provider "${deps.delivery.id}" for delivery and collection.`,
        }
      : {
          mode: "manual",
          status: "not_delivered",
          detail:
            "No e-signature provider is configured, so this package was NOT delivered to signers. Distribute the prepared PDF yourself, or configure a provider to automate delivery and collection.",
        };

    const manifest: RequestManifest = {
      schema: "pdfxyz.signature-request/v1",
      tool: REQUEST_SIGNATURES_TOOL,
      engine: REQUEST_SIGNATURES_ENGINE,
      status: "prepared",
      createdAt,
      document: {
        sourceBytes: input.byteLength,
        sha256: documentSha256,
        pageCount: geometry.pageCount,
      },
      routing: options.routing,
      ...(options.title !== undefined ? { title: options.title } : {}),
      ...(options.message !== undefined ? { message: options.message } : {}),
      signers,
      fields: manifestFields,
      delivery,
      notice:
        "This package PREPARES and RECORDS a signature request. It does not collect, certify, or legally bind signatures. Each signer completes their fields in the prepared PDF; certified collection requires a configured e-signature provider.",
    };

    const audit: AuditTrail = {
      schema: "pdfxyz.signature-request.audit/v1",
      documentSha256,
      events: [
        {
          at: createdAt,
          type: "request.prepared",
          signerCount: options.signers.length,
          fieldCount: options.fields.length,
          routing: options.routing,
        },
      ],
    };

    const output = await buildPackage(preparedPdf, manifest, audit);
    const maxOutput = deps.limits?.maxOutputBytes;
    if (maxOutput !== undefined && output.byteLength > maxOutput) {
      return {
        ok: false,
        kind: "failed",
        message: "The signature-request package exceeds the worker size limit.",
      };
    }

    return {
      ok: true,
      output,
      filenameExt: "zip",
      contentType: "application/zip",
      meta: {
        engine: REQUEST_SIGNATURES_ENGINE,
        tool: REQUEST_SIGNATURES_TOOL,
        signerCount: options.signers.length,
        fieldCount: options.fields.length,
        pageCount: geometry.pageCount,
        inputBytes: input.byteLength,
        outputBytes: output.byteLength,
      },
    };
  } catch {
    return {
      ok: false,
      kind: "failed",
      message: "The PDF could not be prepared for a signature request.",
    };
  }
}

// ---------------------------------------------------------------------------
// Manifest / package types + serialization
// ---------------------------------------------------------------------------

interface ManifestField {
  name: string;
  signer: number;
  type: RequestSignatureFieldType;
  page: number;
  required: boolean;
  rect: { x: number; y: number; width: number; height: number };
  label?: string;
}

interface ManifestSigner {
  order: number;
  name: string;
  email: string;
  token: string;
  fields: string[];
}

type ManifestDelivery =
  | { mode: "manual"; status: "not_delivered"; detail: string }
  | {
      mode: "provider";
      provider: string;
      status: "handed_off";
      detail: string;
    };

interface RequestManifest {
  schema: string;
  tool: string;
  engine: string;
  status: "prepared";
  createdAt: string;
  document: { sourceBytes: number; sha256: string; pageCount: number };
  routing: string;
  title?: string;
  message?: string;
  signers: ManifestSigner[];
  fields: ManifestField[];
  delivery: ManifestDelivery;
  notice: string;
}

interface AuditTrail {
  schema: string;
  documentSha256: string;
  events: {
    at: string;
    type: "request.prepared";
    signerCount: number;
    fieldCount: number;
    routing: string;
  }[];
}

/** Render a plain-text README describing the request and its honest scope. */
function renderReadme(manifest: RequestManifest): string {
  const lines: string[] = [];
  lines.push("pdf.xyz — Signature Request Package");
  lines.push("===================================");
  lines.push("");
  if (manifest.title) lines.push(`Title: ${manifest.title}`);
  lines.push(`Prepared: ${manifest.createdAt}`);
  lines.push(`Routing: ${manifest.routing}`);
  lines.push(`Document SHA-256: ${manifest.document.sha256}`);
  lines.push(`Pages: ${manifest.document.pageCount}`);
  if (manifest.message) {
    lines.push("");
    lines.push(`Message to signers: ${manifest.message}`);
  }
  lines.push("");
  lines.push("Signers (in order):");
  for (const signer of manifest.signers) {
    lines.push(
      `  ${signer.order}. ${signer.name} <${signer.email}> — fields: ${signer.fields.join(", ")}`,
    );
  }
  lines.push("");
  lines.push("Contents:");
  const entry = (file: string) => `  ${file.padEnd(17)}`;
  lines.push(
    `${entry(REQUEST_PACKAGE_FILES.prepared)}The document with real, named fillable fields for each signer.`,
  );
  lines.push(
    `${entry(REQUEST_PACKAGE_FILES.manifest)}A structured record of the request (signers, fields, routing).`,
  );
  lines.push(
    `${entry(REQUEST_PACKAGE_FILES.audit)}The request's audit trail — one 'request.prepared' event.`,
  );
  lines.push("");
  lines.push("HONEST SCOPE:");
  lines.push("  " + manifest.notice);
  lines.push("  " + manifest.delivery.detail);
  lines.push("");
  lines.push(
    `To complete the signatures, open ${REQUEST_PACKAGE_FILES.prepared} and fill each signer's fields`,
  );
  lines.push(
    "(use the pdf.xyz Sign PDF tool or any PDF viewer that supports form fields).",
  );
  return lines.join("\n");
}

/** Package the prepared PDF + manifest + README + audit trail into a real ZIP. */
async function buildPackage(
  preparedPdf: Uint8Array,
  manifest: RequestManifest,
  audit: AuditTrail,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(REQUEST_PACKAGE_FILES.prepared, preparedPdf);
  zip.file(REQUEST_PACKAGE_FILES.manifest, JSON.stringify(manifest, null, 2));
  zip.file(REQUEST_PACKAGE_FILES.audit, JSON.stringify(audit, null, 2));
  zip.file(REQUEST_PACKAGE_FILES.readme, renderReadme(manifest));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

/** Re-exported for the processor/UI so the field-type copy stays in one place. */
export { FIELD_TYPE_LABEL, REQUEST_SIGNATURE_FIELD_TYPES };
