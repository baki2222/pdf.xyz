/**
 * Upload-intake guardrails — the small, deterministic validation layer at the
 * public upload boundary.
 *
 * Import from `@/lib/uploads/intake` for the configurable {@link IntakePolicy},
 * the coarse family allowlist, the bounded PDF structural sniff, and the pure
 * evaluators the routes run before any storage or queue work. Everything here is
 * content-free by construction and Node-free (safe to import from any runtime).
 *
 * This layer is deliberately distinct from — and complementary to — three others:
 *  - the per-tool contract validation in `@/lib/jobs` (exact MIME + typed shapes),
 *  - the worker-side malware/soundness scan (ClamAV, Phase 22), and
 *  - edge/WAF protections and the abuse guard in `@/lib/ratelimit`.
 * See docs/SECURITY.md → "Upload intake guardrails" for how the layers compose.
 */

export {
  UPLOAD_INTAKE_ENV,
  INTAKE_BOUNDS,
  DEFAULT_INTAKE_POLICY,
  resolveIntakePolicy,
  type IntakePolicy,
} from "./policy";

export {
  UPLOAD_FAMILIES,
  classifyDeclaredType,
  familyForMime,
  familyForExtension,
  extensionOf,
  normalizeContentType,
  type UploadFamily,
  type ClassifyResult,
} from "./families";

export {
  sniffPdf,
  type PdfSniff,
  type PdfSniffReason,
  type PdfSniffWindows,
} from "./pdf";

export {
  evaluateUploadDescriptors,
  evaluateUploadedBytes,
  evaluateJobInputCount,
  intakeErrorResult,
  type IntakeDecision,
  type IntakeRejection,
  type IntakeRejectionCode,
  type IntakeTelemetry,
} from "./evaluate";
