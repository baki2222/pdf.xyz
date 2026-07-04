// @vitest-environment node
/**
 * No-leak privacy proof for the release decision record ledger (Phase 59).
 *
 * The record ingests TWO untrusted documents — a `pdfxyz.release-publish-pack/1` and a `pdfxyz.release-ack/1`. Even a
 * recognized document may be hostile: an operator could point us at hand-edited files whose prose / extra fields have
 * been stuffed with reviewer identities, paths, buckets, URLs, object keys, env values, raw provider logs / errors, or
 * OCR / document text. This suite stuffs every such token into every string-bearing corner of BOTH documents (and adds
 * purely-hostile raw blobs) and asserts NONE of it survives into the rendered JSON or text — because the two trust
 * boundaries reduce each document to bounded enums / small ints / booleans and NEVER copy a free-text field.
 */

import { describe, expect, it } from "vitest";
import { renderReleaseDecision } from "./render";
import {
  ackFor,
  acknowledgedAck,
  makeDecision,
  publishablePack,
} from "./fixtures";

/** Locator / identity / secret / log / document-text tokens no output may ever contain. */
const HOSTILE = [
  "s3://pdfxyz-prod-secret/objects/job-42/input.pdf",
  "https://acme.s3.us-east-1.amazonaws.com/key/abc",
  "AKIAIOSFODNN7EXAMPLE",
  "Bearer sk-live-abcdef0123456789abcdef",
  "/tmp/pdfxyz/worker/job-42/output.pdf",
  "PDFXYZ_STORAGE_SECRET_ACCESS_KEY=supersecretvalue",
  "ERROR provider timeout at 10.0.0.5:9000 reading bucket acme-prod",
  "Invoice 4471 John Doe 4111 1111 1111 1111 exp 04/29",
  "redis://user:hunter2@10.0.0.1:6379",
  "object-key-9f8e7d6c-customer-ssn-078-05-1120",
  "reviewer: Jane Approver <jane.approver@example.com>",
];

/** Deep-stuff every hostile token into a cloned document's prose / extra fields (never a load-bearing enum field). */
function stuff<T>(doc: T): T {
  const clone = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  clone.__hostile = [...HOSTILE];
  clone.note = HOSTILE.join(" | ");
  clone.generatedBy = HOSTILE.join(" ");
  if (Array.isArray(clone.caveats)) clone.caveats = [...HOSTILE];
  if (Array.isArray(clone.guidance)) clone.guidance = [...HOSTILE];
  // Stuff each reduced source's authored `detail` string (dropped by reconstruction).
  if (Array.isArray(clone.sources)) {
    clone.sources = (clone.sources as Array<Record<string, unknown>>).map(
      (s) => ({ ...s, detail: HOSTILE.join(" ") }),
    );
  }
  if (Array.isArray(clone.reasons)) {
    clone.reasons = (clone.reasons as Array<Record<string, unknown>>).map(
      (r) => ({ ...r, detail: HOSTILE.join(" ") }),
    );
  }
  // Stuff the nested source-summary detail on an acknowledgement (dropped by reconstruction).
  if (clone.source && typeof clone.source === "object") {
    clone.source = {
      ...(clone.source as Record<string, unknown>),
      detail: HOSTILE.join(" "),
    };
  }
  return clone as unknown as T;
}

/** A purely hostile blob that is not a recognized document (⇒ unreadable, nothing extracted). */
const RAW_LOG_BLOB = {
  schema: "not-a-pdfxyz-document/1",
  log: HOSTILE.join("\n"),
  stack: HOSTILE,
  ocrText: "Patient: Jane Roe, DOB 1980-01-01, MRN 123456",
};

function assertNoLeak(
  json: string,
  text: string,
  tokens: readonly string[],
): void {
  for (const token of tokens) {
    expect(json, `json leaked ${token}`).not.toContain(token);
    expect(text, `text leaked ${token}`).not.toContain(token);
  }
}

describe("release-decision — no-leak over a hostile pair", () => {
  it("stuffed-but-self-consistent documents stay usable, and no token leaks into JSON or text", () => {
    const result = makeDecision(
      stuff(publishablePack()),
      stuff(acknowledgedAck()),
    );
    // The stuffed prose is dropped, so both documents still re-derive ⇒ a coherent proceed.
    expect(result.decision.decision).toBe("proceed");
    expect(result.publishPack.state).toBe("usable");
    expect(result.acknowledgement.state).toBe("usable");
    assertNoLeak(
      renderReleaseDecision(result, "json"),
      renderReleaseDecision(result, "text"),
      HOSTILE,
    );
  });

  it("purely-hostile raw blobs are unreadable and never echoed (invalid, no leak)", () => {
    const result = makeDecision(RAW_LOG_BLOB, RAW_LOG_BLOB);
    expect(result.decision.decision).toBe("invalid");
    expect(result.publishPack.state).toBe("unreadable");
    expect(result.acknowledgement.state).toBe("unreadable");
    assertNoLeak(
      renderReleaseDecision(result, "json"),
      renderReleaseDecision(result, "text"),
      [...HOSTILE, "Jane Roe", "MRN 123456", "not-a-pdfxyz-document"],
    );
  });

  it("a hostile string in the load-bearing pack verdict is off-enum ⇒ tampered, never surfaced", () => {
    const doc = JSON.parse(JSON.stringify(publishablePack())) as {
      pack: { verdict: string };
    };
    doc.pack.verdict = "s3://leak/verdict"; // off-enum ⇒ tampered, claim not surfaced
    const result = makeDecision(doc, acknowledgedAck());
    expect(result.decision.decision).toBe("invalid");
    expect(renderReleaseDecision(result, "json")).not.toContain(
      "s3://leak/verdict",
    );
  });

  it("a hostile string in the load-bearing ack decision is off-enum ⇒ tampered, never surfaced", () => {
    const doc = JSON.parse(JSON.stringify(acknowledgedAck())) as {
      acknowledgement: { decision: string };
    };
    doc.acknowledgement.decision = "reviewer: Jane <jane@example.com>"; // off-enum ⇒ unreadable/tampered
    const result = makeDecision(publishablePack(), doc);
    expect(result.decision.decision).toBe("invalid");
    expect(renderReleaseDecision(result, "json")).not.toContain(
      "jane@example.com",
    );
  });

  it("the whole record serializes to bounded values only (no hostile token)", () => {
    const serialized = JSON.stringify(
      makeDecision(
        stuff(publishablePack()),
        stuff(ackFor(publishablePack(), { decision: "accepted-with-notes" })),
      ),
    );
    for (const token of HOSTILE) expect(serialized).not.toContain(token);
  });
});
