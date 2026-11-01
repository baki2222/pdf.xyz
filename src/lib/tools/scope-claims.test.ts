// @vitest-environment node
/**
 * Copy may not promise a tool a scope its engine does not have.
 *
 * WHAT SHIPPED, in the category landing pages (`category-pages.ts`), caught in
 * review before merge:
 *
 *   sign      "…or request signatures from other people."
 *   sign      "…or ask other people to sign."
 *   security  "…or compare two versions to see exactly what changed."
 *
 * Request Signatures PREPARES a package: a PDF with a field per signer, a
 * manifest and an audit trail. It never sends anything. Asked to deliver, the
 * processor fails `not_implemented` because no e-signature provider is wired,
 * and its own panel tells the reader delivery "needs a configured e-signature
 * provider". Compare PDF diffs the selectable TEXT of two files (after
 * collapsing whitespace) and reports page count and size. Anything that is not
 * text (an image, a moved table, a scan) is outside what it can see.
 *
 * THE PROPERTY, NOT THE MECHANISM (CLAUDE.md rule 2). Each ban holds while the
 * property that makes the claim false holds, and that property is MEASURED by
 * running the shipped code, not read from a flag:
 *
 *  - delivery: the request-signatures processor, built from the deps the
 *    worker runtime defaults to, is asked to deliver. Today it refuses. The
 *    probe's positive control hands the same processor a provider and watches
 *    it succeed, so "refuses" is an observation the probe CAN get wrong.
 *  - exhaustive diff: two inputs that differ (size, spacing) but carry the
 *    same words go through `compareExtractedPdfText`. Today the result says
 *    the text is identical. The control feeds two different texts and watches
 *    the result say they differ.
 *
 * If a provider is ever wired, or compare learns to see what it cannot see
 * today, the corresponding ban lifts ITSELF, and the patterns stop applying.
 *
 * RULE 1, BOTH DIRECTIONS. Every pattern catches a sentence the product
 * shipped (`SHIPPED`, kept verbatim, the tests that pinned the defect
 * inverted into positive controls), and every shipped sentence is caught.
 *
 * PRE-EXISTING, RATCHETED. The same delivery claim was already on `main` in
 * two files this change may not edit: the catalogue entry (`tools/catalog.ts`,
 * owned by another lane) and the Sign PDF guide (`guides/catalog.ts`, which
 * repeats the catalogue description). They are counted, not exempted: the
 * count must match EXACTLY, so a new claim in either file fails, and so does a
 * fix, which must lower the number in the same change.
 */
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "./copy-surface";
import { createProcessorRegistry } from "@/lib/workers/processor";
import { signatureRequestDeps } from "@/lib/workers/request-signatures/native";
import { compareExtractedPdfText } from "@/lib/pdf/compare-pdf";
import type { ExtractedPdfText } from "@/lib/pdf/text";

const ROOT = process.cwd();
const rel = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join("/");

/* ------------------------------------------------------------------ *
 *  The shapes, and the sentences that shipped them.
 * ------------------------------------------------------------------ */

/** Copy that says the site sends a document to, or collects from, signers. */
const DELIVERY_CLAIMS: readonly RegExp[] = [
  /\brequest(?:ing)? signatures? from\b/gi,
  /\bask(?:ing)? (?:other people|others|someone(?: else)?|signers|recipients) to sign\b/gi,
  /\bcollect(?:s|ing)? (?:legally-binding |audited )?e-?signatures\b/gi,
  /\bcollect(?:s|ing)? signatures from\b/gi,
  /\bsends? (?:a |the )?(?:document|pdf|request)s? to (?:others|recipients|signers|other people)\b/gi,
  // Synonyms, added 2026-09-27 when review put "pdf.xyz emails the PDF to
  // each signer and tracks who has signed." through the full suite, green.
  // Delivery by another verb is still delivery, and tracking who has signed
  // is collection by another name.
  /\bemails? (?:it|them|(?:a |the )?(?:document|pdf|request|package)s?) to (?:each |every |all |the |your )?(?:signers?|recipients?|others|other people)\b/gi,
  /\btrack(?:s|ing)? (?:who has signed|who signed|(?:the |signing |signature )?status)\b/gi,
  // Added 2026-11-01: the Request Signatures drop zone's hint read "PDF to
  // send for signature" — on the tool's own page, the tool is the sender.
  /\bsend(?:s|ing)? (?:it |them |(?:a |the )?(?:document|pdf)s? )?for (?:signatures?|signing)\b/gi,
];

/** Copy that says compare finds every change. */
const EXHAUSTIVE_DIFF_CLAIMS: readonly RegExp[] = [
  /\b(?:exactly|precisely) what(?:'s| has)? changed\b/gi,
];

const SHIPPED = {
  delivery: [
    // category-pages.ts, this branch — the two sentences that were fixed.
    "or request signatures from other people.",
    "add form fields to a PDF that has none, or ask other people to sign.",
    // tools/catalog.ts and guides/catalog.ts, on main — still shipping.
    "Collect legally-binding e-signatures.",
    "Send a document to others, track status, and collect audited e-signatures in order.",
    "To collect signatures from others, use the Request Signatures tool, which sends a document to recipients",
    // Review of seo/content, 2026-09-27: the synonym that passed the suite.
    "pdf.xyz emails the PDF to each signer and tracks who has signed.",
    // request-signatures-worker-panel.tsx, the drop zone hint, until 2026-11-01.
    "PDF to send for signature",
  ],
  exhaustiveDiff: [
    "lock form fields into the page, or compare two versions to see exactly what changed.",
  ],
} as const;

/**
 * Sentences that must NOT trip the delivery ban: the corrected copy, which
 * names delivery only to deny it.
 */
const HONEST = [
  "or prepare signing fields for other people, ready for you to send.",
  "You send it to them yourself: pdf.xyz sets up the signing fields and does not deliver it or collect signatures.",
  "or compare the text, page count and file size of two versions.",
  "Email a payslip or tax return to an accountant",
];

function hits(text: string, patterns: readonly RegExp[]): string[] {
  const flat = flattenForPhraseSearch(text);
  return patterns.flatMap((p) => [...flat.matchAll(p)].map((m) => m[0]));
}

/**
 * Pre-existing claims on main, by file, counted. See the docblock: equality,
 * not a ceiling, so the number can only move in the change that moves it.
 */
const PENDING_DELIVERY: Record<string, number> = {
  // Raised 2026-09-27 by the "track status" pattern, not by new copy: the
  // same catalogue and guide sentences, now counted for the tracking claim
  // they already made (3 -> 4 and 6 -> 8).
  //
  // Shrunk to 1 and 1 at the seo/content merge (2026-09-28): wave1 rewrote the
  // Request Signatures catalogue and guide copy to say what the tool does
  // (prepare the package; you send it). What still counts is one denial each —
  // "pdf.xyz does not email it or track who has signed" and the FAQ question
  // "Can I collect signatures from other people?" — which the shapes cannot
  // tell from a claim, so they stay counted rather than exempted.
  //
  // MOVED 2026-10-24, same count: the denial is a How-it-works step, and the
  // steps left the client catalogue for `tools/catalog-how.ts`.
  "src/lib/tools/catalog-how.ts": 1,
  "src/lib/guides/catalog.ts": 1,
};

/* ------------------------------------------------------------------ *
 *  The properties, measured.
 * ------------------------------------------------------------------ */

async function onePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

const REQUEST = {
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
  deliver: true,
};

/**
 * Ask the processor to DELIVER, and report what it says it did. Success alone
 * is not delivery: a request that forgot `deliver: true` also succeeds, with
 * a `manual` package. Only the manifest's own `delivery.mode` of `provider`
 * counts, so a probe bug cannot read as a capability and lift the ban.
 */
async function deliveryOutcome(
  deps: ReturnType<typeof signatureRequestDeps>,
): Promise<{ delivered: boolean; code?: string }> {
  const processor = createProcessorRegistry({
    requestSignatures: deps,
  }).resolve("request-signatures");
  if (!processor) throw new Error("request-signatures is not registered");
  const result = await processor.process({
    tool: "request-signatures",
    options: REQUEST,
    inputs: [
      {
        fileId: "f",
        filename: "contract.pdf",
        contentType: "application/pdf",
        bytes: await onePagePdf(),
      },
    ],
  });
  if (!result.ok) return { delivered: false, code: result.error.code };
  const zip = await JSZip.loadAsync(result.artifacts[0]!.bytes);
  const manifest = JSON.parse(
    (await zip.file("manifest.json")?.async("string")) ?? "null",
  ) as { delivery?: { mode?: string } } | null;
  return { delivered: manifest?.delivery?.mode === "provider" };
}

function extracted(text: string): ExtractedPdfText {
  return {
    pageCount: 1,
    pages: [{ pageNumber: 1, text, characterCount: text.length }],
    text,
    characterCount: text.length,
    hasText: text.length > 0,
  };
}

/* ------------------------------------------------------------------ */

describe("scope claims: the patterns and the corpus", () => {
  it("every shipped sentence is caught (no holes)", () => {
    for (const s of SHIPPED.delivery)
      expect(hits(s, DELIVERY_CLAIMS), s).not.toEqual([]);
    for (const s of SHIPPED.exhaustiveDiff)
      expect(hits(s, EXHAUSTIVE_DIFF_CLAIMS), s).not.toEqual([]);
  });

  it("every pattern catches a shipped sentence (no decoration)", () => {
    for (const p of DELIVERY_CLAIMS)
      expect(
        SHIPPED.delivery.some((s) => hits(s, [p]).length > 0),
        String(p),
      ).toBe(true);
    for (const p of EXHAUSTIVE_DIFF_CLAIMS)
      expect(
        SHIPPED.exhaustiveDiff.some((s) => hits(s, [p]).length > 0),
        String(p),
      ).toBe(true);
  });

  it("the corrected copy is not caught", () => {
    for (const s of HONEST) {
      expect(hits(s, DELIVERY_CLAIMS), s).toEqual([]);
      expect(hits(s, EXHAUSTIVE_DIFF_CLAIMS), s).toEqual([]);
    }
  });

  it("a claim split across a line wrap is still caught", () => {
    expect(
      hits(
        '"…or request signatures " +\n  "from other people."',
        DELIVERY_CLAIMS,
      ),
    ).not.toEqual([]);
  });
});

describe("scope claims: the properties hold today", () => {
  it("the worker runtime defaults to the deps probed here", () => {
    // The probe below builds the processor from `signatureRequestDeps()`.
    // That is only the shipped configuration while the runtime defaults to it.
    const runtime = readFileSync(
      path.join(ROOT, "src", "lib", "workers", "daemon", "runtime.ts"),
      "utf8",
    );
    expect(runtime).toMatch(
      /deps\.requestSignatures\s*\?\?\s*signatureRequestDeps\(\)/,
    );
  });

  it("positive control: with a provider, the probe sees delivery succeed", async () => {
    const outcome = await deliveryOutcome({
      ...signatureRequestDeps(),
      delivery: { id: "example-esign" },
    });
    expect(outcome).toEqual({ delivered: true });
  });

  it("positive control: two different texts compare as different", () => {
    const result = compareExtractedPdfText(
      { name: "a.pdf", size: 100, extracted: extracted("Total due: 100") },
      { name: "b.pdf", size: 100, extracted: extracted("Total due: 900") },
    );
    expect(result.identicalText).toBe(false);
  });
});

describe("scope claims: no copy surface overclaims", () => {
  const files = copyFiles();
  const surfaces = files.map((file) => ({
    file: rel(file),
    text: withoutComments(readFileSync(file, "utf8")),
  }));

  it("the surface is the site's copy, including the category pages", () => {
    expect(files.length).toBeGreaterThan(100);
    const names = surfaces.map((s) => s.file);
    for (const expected of [
      "src/lib/tools/category-pages.ts",
      ...Object.keys(PENDING_DELIVERY),
    ])
      expect(names, expected).toContain(expected);
  });

  it("no surface claims signature delivery the worker cannot do", async () => {
    const outcome = await deliveryOutcome(signatureRequestDeps());
    if (outcome.delivered) return; // delivery exists: the claim is now true.
    expect(outcome.code).toBe("not_implemented");

    const offenders = surfaces
      .map(({ file, text }) => ({ file, found: hits(text, DELIVERY_CLAIMS) }))
      .filter(
        ({ file, found }) => found.length !== (PENDING_DELIVERY[file] ?? 0),
      )
      .map(
        ({ file, found }) => `${file}: ${found.length} × ${found.join(" | ")}`,
      );
    expect(offenders).toEqual([]);
  });

  it("no surface claims compare sees every change", () => {
    // Same words, different spacing and size: a real change compare cannot see.
    const blind = compareExtractedPdfText(
      { name: "a.pdf", size: 100, extracted: extracted("Total  due:\t100") },
      { name: "b.pdf", size: 900, extracted: extracted("Total due: 100") },
    ).identicalText;
    if (!blind) return; // compare saw it: the claim is no longer false.

    const offenders = surfaces
      .map(({ file, text }) => ({
        file,
        found: hits(text, EXHAUSTIVE_DIFF_CLAIMS),
      }))
      .filter(({ found }) => found.length > 0)
      .map(({ file, found }) => `${file}: ${found.join(" | ")}`);
    expect(offenders).toEqual([]);
  });
});
