// @vitest-environment node
/**
 * No-leak privacy proof for the release evidence handoff acknowledgement receipt (Phase 58).
 *
 * The receipt ingests an UNTRUSTED `pdfxyz.release-publish-pack/1`. Even a recognized pack may be hostile — an
 * operator could point us at a hand-edited file whose prose / extra fields have been stuffed with reviewer identities,
 * paths, buckets, URLs, object keys, env values, raw provider logs / errors, or OCR / document text. This suite stuffs
 * every such token into every string-bearing corner of the pack (and adds a purely-hostile raw blob) and asserts NONE
 * of it survives into the rendered JSON or text — because the trust boundary reduces the pack to bounded enums / small
 * ints / booleans and NEVER copies a free-text field. It also proves the reviewer / note inputs can only ever be
 * bounded classes (a raw identity is rejected at the arg layer, so it can never enter the receipt).
 */

import { describe, expect, it } from "vitest";
import { renderReleaseAck } from "./render";
import { makeAck, publishablePack } from "./fixtures";
import { parseReleaseAckArgs } from "./args";

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

/** Deep-stuff every hostile token into a cloned pack's prose / extra fields (never a load-bearing enum field). */
function stuff<T>(doc: T): T {
  const clone = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  clone.__hostile = [...HOSTILE];
  clone.note = HOSTILE.join(" | ");
  clone.generatedBy = HOSTILE.join(" ");
  if (Array.isArray(clone.caveats)) clone.caveats = [...HOSTILE];
  if (Array.isArray(clone.guidance)) clone.guidance = [...HOSTILE];
  // Stuff each reduced source's authored `detail` string (dropped by the ack's reconstruction).
  if (Array.isArray(clone.sources)) {
    clone.sources = (clone.sources as Array<Record<string, unknown>>).map((s) => ({ ...s, detail: HOSTILE.join(" ") }));
  }
  return clone as unknown as T;
}

/** A purely hostile blob that is not a recognized pack (⇒ unreadable, nothing extracted). */
const RAW_LOG_BLOB = {
  schema: "not-a-pdfxyz-document/1",
  log: HOSTILE.join("\n"),
  stack: HOSTILE,
  ocrText: "Patient: Jane Roe, DOB 1980-01-01, MRN 123456",
};

describe("release-ack — no-leak over a hostile pack", () => {
  it("a stuffed but still self-consistent pack stays usable, and no token leaks into JSON or text", () => {
    const result = makeAck(stuff(publishablePack()), { decision: "accepted", reviewer: "external-reviewer", note: "security-review" });
    // The stuffed prose is dropped, so the pack still re-derives ⇒ acknowledged-with-followup (a note was set).
    expect(result.ack.verdict).toBe("acknowledged-with-followup");
    expect(result.source.state).toBe("usable");

    const json = renderReleaseAck(result, "json");
    const text = renderReleaseAck(result, "text");
    for (const token of HOSTILE) {
      expect(json, `json leaked ${token}`).not.toContain(token);
      expect(text, `text leaked ${token}`).not.toContain(token);
    }
  });

  it("a purely-hostile raw blob is unreadable and never echoed (invalid, no leak)", () => {
    const result = makeAck(RAW_LOG_BLOB, { decision: "accepted" });
    expect(result.ack.verdict).toBe("invalid");
    expect(result.source.state).toBe("unreadable");
    const json = renderReleaseAck(result, "json");
    const text = renderReleaseAck(result, "text");
    for (const token of [...HOSTILE, "Jane Roe", "MRN 123456", "not-a-pdfxyz-document"]) {
      expect(json, `json leaked ${token}`).not.toContain(token);
      expect(text, `text leaked ${token}`).not.toContain(token);
    }
  });

  it("a hostile string in the load-bearing pack verdict is off-enum ⇒ tampered, never surfaced", () => {
    const doc = JSON.parse(JSON.stringify(publishablePack())) as { pack: { verdict: string } };
    doc.pack.verdict = "s3://leak/verdict"; // off-enum ⇒ tampered, claim not surfaced
    const result = makeAck(doc, { decision: "accepted" });
    expect(result.ack.verdict).toBe("invalid");
    expect(renderReleaseAck(result, "json")).not.toContain("s3://leak/verdict");
  });

  it("a raw reviewer identity / free-text note is rejected at the arg layer (never enters the receipt)", () => {
    for (const hostile of HOSTILE) {
      expect(parseReleaseAckArgs(["--publish-pack=p.json", "--decision=accepted", `--reviewer=${hostile}`]).ok).toBe(false);
      expect(parseReleaseAckArgs(["--publish-pack=p.json", "--decision=accepted", `--note=${hostile}`]).ok).toBe(false);
    }
  });

  it("the whole receipt serializes to bounded values only (no hostile token)", () => {
    const serialized = JSON.stringify(makeAck(stuff(publishablePack()), { decision: "accepted-with-notes" }));
    for (const token of HOSTILE) expect(serialized).not.toContain(token);
  });
});
