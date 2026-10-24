import type { ToolContent } from "./types";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import {
  DEFAULT_PDF_KEY_LENGTH,
  MAX_PDF_PASSWORD_BYTES,
  PDF_ENCRYPTION_LEVELS,
  describePdfKeyLength,
  protectedOutputName,
} from "@/lib/jobs/pdf-security";
import {
  ACCESSIBILITY_ALWAYS_ALLOWED,
  FORMS_FOLLOW_ANNOTATE,
  PDF_PERMISSIONS,
  PERMISSIONS_ARE_FLAGS,
} from "@/lib/jobs/pdf-permission-labels";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27:
 *  - src/components/tools/pdf-security-worker-panel.tsx — the controls as the
 *    visitor sees them: the "Add a PDF to password-protect" drop zone (one
 *    file, with a Remove button), the masked "New password" field with a
 *    show/hide toggle and a byte counter once the password is too long, the
 *    "Encryption strength" chips, the "Encrypt on the worker" button, the
 *    "Your PDF is protected and ready." result and a "Download <name>" button.
 *    CHANGED 2026-10-24: until then the panel sent ONLY `password` and
 *    `keyLength` and had no owner-password or permissions control. It now
 *    draws a "Permissions" group (PDF_PERMISSIONS, every box ticked), and
 *    once one is unticked an "Owner password" field that must differ from
 *    the open password; only then are `ownerPassword` and `permissions` sent.
 *  - src/lib/jobs/pdf-security.ts — the owner password defaults to the open
 *    password; the byte bound; control characters refused; AES-256 default;
 *    a restriction without a distinct owner password is refused, as are
 *    accessibility off and forms off while comments are on.
 *  - src/lib/workers/pdf-security/native.ts — `qpdf --encrypt <user> <owner>
 *    <bits> [restriction flags] --`, a flag only for each switch turned off
 *    (none by default, so qpdf's default: every permission allowed); AES
 *    forced for 128-bit, RC4 never offered.
 *  - src/lib/workers/pdf-security/engine.ts — on a restricted job the output's
 *    /P is read back (permission-bits.ts) and the job fails on any mismatch.
 *  - src/lib/workers/pdf-security/engine.ts — an already-encrypted input is
 *    refused ("Unlock it first, then protect it again."), and the output must
 *    re-inspect as encrypted or the run fails.
 *  - src/lib/workers/queue/redis.ts — the job options (which carry the
 *    password) sit in a TTL'd spec record, which the FINALIZE script in
 *    redis-scripts.ts DELetes on every terminal transition (complete, fail,
 *    cancel, expire). So this page promises no storage-free password; it
 *    states the deletion instead.
 *  - size: the upload session is refused above JOB_LIMITS.maxFileBytes
 *    (src/lib/jobs/validation.ts), read here through toolFileCeilingMb. The
 *    worker's own qpdf bound (PDF_SECURITY_INPUT_BYTES_BOUNDS.default,
 *    native-config.ts) is larger, so the upload limit is the one that binds.
 *  - the restrictions-only case in FAQ 3 rests on `qpdf --is-encrypted`, which
 *    exits 0 for ANY file with an encryption dictionary, including one with an
 *    empty open password (qpdf's --requires-password is the flag that tells
 *    those apart). Not yet confirmed by a real production job.
 * Every number is interpolated from the constant that owns it.
 */

const tool = getToolBySlug("protect-pdf");
if (!tool || capabilityForMode(tool.processing) !== "secure-worker") {
  throw new Error(
    "protect-pdf content says the file is uploaded to the worker, but the tool is not server-side",
  );
}
const CEILING_MB = toolFileCeilingMb(tool);
if (CEILING_MB === null) {
  throw new Error("protect-pdf content states a file ceiling it cannot find");
}

const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;
const STRONG = describePdfKeyLength(DEFAULT_PDF_KEY_LENGTH);
// The other strength the chips offer, read from the list they render rather
// than typed, so a changed level set cannot leave a stale name here.
const compatibleLevel = PDF_ENCRYPTION_LEVELS.find(
  (level) => level.keyLength !== DEFAULT_PDF_KEY_LENGTH,
);
if (!compatibleLevel) {
  throw new Error(
    "protect-pdf content names a second encryption strength it cannot find",
  );
}
const COMPATIBLE = compatibleLevel.label;
const EXAMPLE_INPUT = "contract.pdf";
const EXAMPLE_OUTPUT = protectedOutputName(EXAMPLE_INPUT);
const PW_BYTES = MAX_PDF_PASSWORD_BYTES;
// The switches the panel lets a reader turn off, read from the list it draws.
const restrictable = PDF_PERMISSIONS.filter((p) => !p.alwaysAllowed).map((p) =>
  p.label.toLowerCase(),
);
const RESTRICTABLE = `${restrictable.slice(0, -1).join(", ")} or ${restrictable.at(-1)}`;
const COPY_LABEL = PDF_PERMISSIONS.find((p) => p.key === "copy")?.label;
if (!COPY_LABEL)
  throw new Error("protect-pdf content names a copy switch it cannot find");

const content: ToolContent = {
  slug: "protect-pdf",

  seoTitle: `Protect PDF with a Password: ${STRONG} Encryption`,

  metaDescription: `Password-protect a PDF with ${STRONG} or ${COMPATIBLE} encryption applied by qpdf. One file up to ${CEILING_MB} MB, no account, link expires in ${OUTPUT_TTL} min.`,

  intro: [
    `Protect PDF puts an open password on a document. The result is encrypted with AES, so a PDF reader asks for the password before it will show a single page. Use it when a file travels by email, a shared drive or a USB stick. The encryption is applied by qpdf, and the worker re-inspects its own output: a file that does not come back encrypted fails the job instead of being handed over as if it were protected.`,
    `qpdf is a native program, so this tool does not run in your browser. Your PDF is uploaded over TLS to pdf.xyz's secure worker, and the password travels with the job request so the worker can encrypt that one file. The uploaded input is deleted when the job finishes, the link to the protected copy expires after ${OUTPUT_TTL} minutes, and a daily storage rule erases the stored copy after that. The panel holds a single PDF at a time, and the upload is refused above ${CEILING_MB} MB.`,
    `By default the same password becomes the owner password and every permission stays allowed, so whoever can open the file can also print it and copy its text. Under Permissions you can untick ${RESTRICTABLE}; the panel then asks for a separate owner password, and the worker reads the finished file's permission flags back and fails the job if one does not match what you chose. Filling in forms can be blocked only once comments are: ${FORMS_FOLLOW_ANNOTATE.charAt(0).toLowerCase()}${FORMS_FOLLOW_ANNOTATE.slice(1)} Text extraction for accessibility is ${ACCESSIBILITY_ALWAYS_ALLOWED.charAt(0).toLowerCase()}${ACCESSIBILITY_ALWAYS_ALLOWED.slice(1)} A PDF that is already encrypted is refused rather than wrapped twice.`,
  ],

  useCases: [
    {
      title: "Email a payslip or tax return to an accountant",
      body: "Attach the protected copy and send the password by a different route, such as a text message or a phone call, so one intercepted email does not expose both.",
    },
    {
      title: "Share a draft contract through a cloud link",
      body: "Anyone who opens a forwarded link meets the password prompt instead of the clauses, so pick a password that is hard to guess.",
    },
    {
      title: "Send to someone on older PDF software",
      body: `If an older reader on the other end cannot open the ${STRONG} copy, run the unprotected original through again and pick ${COMPATIBLE} under Encryption strength. It is still AES, just a shorter key.`,
    },
    {
      title: "Lock a document after removing sensitive details",
      body: "Run Redact PDF first to remove account numbers no reader should see, then protect the redacted copy.",
    },
  ],

  steps: [
    {
      title: "Add one PDF",
      body: "Drop a single PDF on the area labelled Add a PDF to password-protect, or browse for one. A Remove button beside the file name lets you swap it.",
    },
    {
      title: "Type the new password",
      body: `Enter it in the New password field. It is masked; the eye button reveals it so you can check for typos. It can be up to ${PW_BYTES} bytes long.`,
    },
    {
      title: "Choose the encryption strength",
      body: `Under Encryption strength, ${STRONG} is preselected. Switch to ${COMPATIBLE} only if the recipient's PDF software is old.`,
    },
    {
      title: "Optional: restrict permissions",
      body: `Every box under Permissions starts ticked. Untick what readers may not do, then type an Owner password that differs from the open password; it is the one that lifts the restrictions later.`,
    },
    {
      title: "Encrypt and download",
      body: `Press Encrypt on the worker once a file and a password are both in place. When "Your PDF is protected and ready." appears, use the button beneath it; for ${EXAMPLE_INPUT} it reads Download ${EXAMPLE_OUTPUT}. Open the saved file once to confirm it asks for the password.`,
    },
  ],

  faqs: [
    {
      q: `Should I pick ${STRONG} or ${COMPATIBLE}?`,
      a: `${STRONG} is the default and the stronger key; it uses the PDF 2.0 encryption scheme. ${COMPATIBLE} is also AES, never the older RC4 cipher, and is offered for readers that cannot open ${STRONG} files. Neither choice changes the pages themselves.`,
    },
    {
      q: "Can I stop people printing or copying text from the PDF?",
      // INVERTED 2026-10-24, history kept: this answered "Not with this tool.
      // It sets an open password only…" while the panel had no permissions
      // control. It has one now, and this says what it does and does not do.
      a: `Yes. Untick “Printing” or “${COPY_LABEL}” under Permissions and set an owner password that differs from the open password. ${PERMISSIONS_ARE_FLAGS} If a passage must not be readable at all, remove it with Redact PDF before protecting.`,
    },
    {
      q: "How do I change the password on a PDF that is already protected?",
      a: "An encrypted input is refused with a note to unlock it first. Run Unlock PDF with the current password, then protect that copy with the new one. A PDF that opens without a prompt but carries printing or copying restrictions is encrypted too, so it is refused as well.",
    },
    {
      q: "What if I forget the password?",
      a: "pdf.xyz cannot recover it: Unlock PDF removes a password you can type and never guesses one. Keep the unprotected original, or store the password in a password manager.",
    },
    {
      q: "What happens to my file and password on the worker?",
      a: `Both reach the worker over TLS, because qpdf needs the password to encrypt. The password sits in the job's queue record, which is deleted when the job ends, and reaches qpdf through a temporary argument file in a scratch folder that is removed after the run. It never appears in the output name or an error message. The input file is deleted when the job ends; the protected copy can be downloaded for ${OUTPUT_TTL} minutes, then a daily storage rule erases it. No account is needed.`,
    },
    {
      q: "Are there rules for the password itself?",
      a: `It cannot be empty, cannot contain control characters such as tabs or line breaks, and cannot exceed ${PW_BYTES} bytes. Accented and non-Latin characters take more than one byte each, so the hint under the field counts bytes once you pass the limit.`,
    },
  ],

  relatedGuides: ["how-to-password-protect-a-pdf"],
};

export default content;
