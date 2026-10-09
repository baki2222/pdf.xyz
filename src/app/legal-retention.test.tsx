// @vitest-environment jsdom
/**
 * What the policy pages TELL A READER about how long their file lives — read
 * from the rendered pages, not from their source.
 *
 * WHY THIS FILE EXISTS (2026-09-27). Both policy pages bounded an upload's life
 * by the input TTL: privacy §2 said the upload is deleted "in any case within
 * 60 minutes", terms §3 licensed the file for "up to 60 minutes", and privacy
 * §10 told a reader not to bother asking about their data because we "delete
 * files within an hour". None of it was enforced by anything. The only code
 * that deletes an upload is the executor's `wipeInputs`, which runs for a job a
 * worker CLAIMED. An upload that never becomes one — the tab closed after the
 * upload, the AI allowance or spend ceiling refused the job after the file
 * arrived, the job was cancelled before a claim — is erased by the bucket's
 * lifecycle rule, whose granularity is days. `legal-pages.test.ts` banned the
 * spelling "60 minutes"; the page said "an hour", and the page that did say 60
 * said it through `{inputWindow}`, which is derived and therefore invisible to
 * a literal ban. Derived is not the same as true.
 *
 * WHAT IT PINS — a relationship, not a string: **no sentence about an upload
 * may state an upper bound on its life that is not longer than the bound the
 * code enforces for EVERY upload.** Today that is the lifecycle rule's age,
 * `RETENTION_WINDOW_MINUTES.inputStorageRule`, from the same
 * `buildLifecyclePolicy` the ops CLI emits — and a bound equal to it is still
 * false, because the rule runs on a daily cycle: at that age an upload is
 * merely due.
 *
 * EXIT CONDITION — the PROPERTY, not the mechanism (house rule 2). The
 * enforced bound may drop to the input TTL only when every `inputs/` object
 * older than the input TTL is deleted by code RUNNING IN PRODUCTION: the
 * sweeper published in the worker heartbeat, and one observed orphan upload
 * gone after the window. A sweeper existing in source is the mechanism; the
 * worker image is built by hand, and merging is not shipping (rule 5).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import {
  RETENTION_WINDOWS,
  RETENTION_WINDOW_MINUTES,
} from "@/lib/retention-windows";
import PrivacyPage, { metadata as privacyMetadata } from "./privacy/page";
import TermsPage from "./terms/page";

afterEach(cleanup);

/* ------------------------------------------------------------------ *
 *  Reading the page the way a reader does
 * ------------------------------------------------------------------ */

const BLOCKS = "p, li, h1, h2, div, header, address, span.block";

/**
 * The rendered page as sentences. Block elements are separated first:
 * `textContent` runs adjacent list items together ("…uploaded.The result…"),
 * which would weld a sentence about the result onto one about the upload.
 */
function sentencesOf(node: HTMLElement): string[] {
  for (const el of Array.from(node.querySelectorAll(BLOCKS))) {
    el.append(document.createTextNode("\n"));
  }
  return (node.textContent ?? "")
    .split(/\n+/)
    .flatMap((block) =>
      block
        .replace(/\s+/g, " ")
        .trim()
        .split(/(?<=[.!?])\s+(?=[A-Z])/),
    )
    .filter((s) => s.length > 0);
}

function renderedSentences(page: () => React.ReactElement): string[] {
  const { container } = render(page());
  return sentencesOf(container);
}

/* ------------------------------------------------------------------ *
 *  The predicate
 * ------------------------------------------------------------------ */

/** A sentence about the uploaded file itself. */
const UPLOAD_SUBJECT = /\b(?:upload(?:ed|s)?|inputs?|files?|documents?)\b/i;

/**
 * An UPPER BOUND on a duration: "within 60 minutes", "up to an hour", "no
 * longer than a day". `after` is deliberately absent — "erased after it is 1
 * day old" is a lower bound on when erasure is due, which is the honest shape.
 * Every gap is `\s+`, so a JSX wrap cannot open a hole.
 */
const BOUND =
  /\b(?:within|up\s+to|no\s+(?:longer|more)\s+than|at\s+most)\s+(?:about\s+|~\s*)?(\d+|an?|one)\s+(minutes?|hours?|days?)\b/gi;

const UNIT_MINUTES: Record<string, number> = {
  minute: 1,
  hour: 60,
  day: 24 * 60,
};

function minutesOf(count: string, unit: string): number {
  const n = /^\d+$/.test(count) ? Number(count) : 1; // "an", "a", "one"
  const per = UNIT_MINUTES[unit.toLowerCase().replace(/s$/, "")];
  if (per === undefined) throw new Error(`unknown unit ${unit}`);
  return n * per;
}

/** The bound the code enforces for every upload, jobs or no jobs. */
const ENFORCED_INPUT_BOUND_MINUTES = RETENTION_WINDOW_MINUTES.inputStorageRule;

/** Sentences promising an upload is gone sooner than anything guarantees. */
function unenforcedUploadBounds(sentences: string[]): string[] {
  const out: string[] = [];
  for (const sentence of sentences) {
    if (!UPLOAD_SUBJECT.test(sentence)) continue;
    for (const m of sentence.matchAll(BOUND)) {
      const [, count, unit] = m;
      if (!count || !unit) continue;
      if (minutesOf(count, unit) <= ENFORCED_INPUT_BOUND_MINUTES) {
        out.push(`"${m[0]}" in: ${sentence}`);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  The corpus, in both directions (house rule 1)
 * ------------------------------------------------------------------ */

/**
 * The three sentences that shipped, as a reader received them (the derived
 * window substituted exactly as the page rendered it). INVERTED, not deleted:
 * each was true on the page until 2026-09-27, and each must be caught.
 */
const SHIPPED_FALSE = [
  `The uploaded file is actively deleted as soon as the job reaches an end — success or failure — and in any case within ${DEFAULT_RETENTION.inputTtlMinutes} minutes.`,
  `Specifically, for the tools that upload, you grant us a non-exclusive, worldwide, royalty-free licence to store, transmit and process that file solely to produce the output you requested, and only for as long as the file exists on our systems — under our retention policy that is up to ${DEFAULT_RETENTION.inputTtlMinutes} minutes.`,
  "Please be aware of a practical limit: because we hold no accounts and delete files within an hour, a request about a document you processed is usually a request about data that no longer exists.",
];

describe("the upload-bound predicate reads what it claims to read", () => {
  it("catches every sentence that shipped the false bound", () => {
    for (const sentence of SHIPPED_FALSE) {
      expect(
        unenforcedUploadBounds([sentence]),
        `the predicate no longer sees: ${sentence}`,
      ).toHaveLength(1);
    }
  });

  it("does not flag the honest shapes it must leave alone", () => {
    // Each is a true sentence the policy needs to be able to say.
    expect(
      unenforcedUploadBounds([
        // a download window is not a statement about the upload's life
        `The remaining 21 can send your file to a processing worker, which deletes it when the job ends and stops serving the result after ${RETENTION_WINDOWS.outputLink}.`,
        // a lower bound on when erasure is due
        `It is erased instead by a storage rule that runs on a daily cycle and removes uploads after they are ${RETENTION_WINDOWS.inputStorageRule} old.`,
        // a bound about something that is not the upload
        "That cache lasts minutes, not days, and holds text within 5 minutes.",
        // an upload bound LONGER than the enforced one: the comparison's
        // direction, which a flipped operator would get wrong silently
        `Uploads are erased within ${(ENFORCED_INPUT_BOUND_MINUTES / (24 * 60)) * 8} days.`,
      ]),
    ).toEqual([]);
  });

  it("the enforced bound is the lifecycle rule, and it is not the input TTL", () => {
    // Health check: were these equal, the predicate would pass a restored
    // "in any case within {inputTtl}" and this whole file would be vacuous.
    expect(ENFORCED_INPUT_BOUND_MINUTES).toBeGreaterThan(
      DEFAULT_RETENTION.inputTtlMinutes,
    );
  });
});

/* ------------------------------------------------------------------ *
 *  The pages, as rendered
 * ------------------------------------------------------------------ */

const PAGES = [
  ["privacy", () => <PrivacyPage />],
  ["terms", () => <TermsPage />],
] as const;

describe("the policy pages do not promise an upload is gone sooner than it is", () => {
  it.each(PAGES)(
    "/%s states no upload bound the code does not enforce",
    (name, page) => {
      const sentences = renderedSentences(page);
      // Health: a page that failed to render would have no sentences to flag.
      expect(
        sentences.length,
        `${name} rendered implausibly little`,
      ).toBeGreaterThanOrEqual(25);
      const found = unenforcedUploadBounds(sentences);
      expect(
        found,
        `${name} bounds an upload's life by a window nothing enforces for an upload that never becomes a job:\n  ${found.join("\n  ")}`,
      ).toEqual([]);
    },
  );

  it("the privacy page's search-result description makes the same promise nowhere", () => {
    const description = String(privacyMetadata.description ?? "");
    expect(description.length).toBeGreaterThan(40);
    expect(unenforcedUploadBounds([description])).toEqual([]);
  });

  it.each(PAGES)(
    "/%s tells a reader how an upload that never ran is erased",
    (name, page) => {
      // The positive half: removing the false bound is not enough if the
      // page then says nothing about the path that needed it. The age must be
      // the one the lifecycle generator emits, in a sentence about uploads.
      const sentences = renderedSentences(page);
      const orphan = sentences.filter(
        (s) =>
          UPLOAD_SUBJECT.test(s) &&
          /\bdaily\b/i.test(s) &&
          s.includes(RETENTION_WINDOWS.inputStorageRule),
      );
      expect(
        orphan,
        `${name} never states the daily storage rule's ${RETENTION_WINDOWS.inputStorageRule} for uploads`,
      ).not.toEqual([]);
    },
  );
});

describe("the privacy page states each clock from its owner", () => {
  it("the stored result outlives the link by the lifecycle rule, and says so", () => {
    // WAS "the bytes typically survive a few hours longer than the link does"
    // — with a 60-minute link and a 1-day rule that runs daily, the bytes
    // outlive the link by the better part of a day at least. An understatement
    // in the direction that flatters the product.
    const sentences = renderedSentences(() => <PrivacyPage />);
    const stored = sentences.filter((s) => /\bstored copy\b/i.test(s));
    expect(stored, "no sentence about the stored copy").not.toEqual([]);
    expect(
      stored.some((s) => s.includes(RETENTION_WINDOWS.outputStorageRule)),
      `the stored-copy sentence does not state the rule's ${RETENTION_WINDOWS.outputStorageRule}:\n  ${stored.join("\n  ")}`,
    ).toBe(true);
    expect(stored.join(" ")).not.toMatch(/\ba\s+few\s+hours\b/i);
  });

  it("the job record's lifetime is the queue TTL, wherever it is stated", () => {
    const sentences = renderedSentences(() => <PrivacyPage />);
    const record = sentences.filter((s) =>
      /\b(?:job record|record of the job)\b/i.test(s),
    );
    // Health: the filename bullet and the password paragraph, at least.
    expect(record.length).toBeGreaterThanOrEqual(2);
    expect(
      record.some((s) => s.includes(RETENTION_WINDOWS.jobRecord)),
      `no job-record sentence states the queue TTL, ${RETENTION_WINDOWS.jobRecord}`,
    ).toBe(true);
    for (const s of record) {
      const durations = [
        ...s.matchAll(/(\d+|an?|one)\s+(minutes?|hours?|days?)\b/gi),
      ].map((m) => m[0]);
      for (const d of durations) {
        expect(
          [
            RETENTION_WINDOWS.jobRecord,
            RETENTION_WINDOWS.outputLink,
            RETENTION_WINDOWS.inputStorageRule,
            RETENTION_WINDOWS.outputStorageRule,
          ],
          `"${d}" in a job-record sentence is not a window the code owns:\n  ${s}`,
        ).toContain(d);
      }
    }
  });
});
