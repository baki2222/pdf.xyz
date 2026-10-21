// @vitest-environment node
/**
 * What a reader of the HOMEPAGE is told about the job record's lifetime, read
 * from the rendered page rather than from the source that builds it.
 *
 * The job record holds the file's name, and it lives for the queue's key TTL,
 * `DEFAULT_JOB_TTL_SECONDS`. Until 2026-09-27 two homepage surfaces stated
 * that as words — "lasts about a day" (security card) and "is kept for about
 * a day" (FAQ, rendered twice: the visible accordion and the FAQPage JSON-LD
 * search engines read) — which the numbers census, matching digits only,
 * could not see. `numbers-honesty.test.ts` now reads word-spelled durations
 * and requires the copy to derive; this file checks the other end of the
 * chain: whatever the source does, the served page must state a window equal
 * to the TTL, in every sentence that names the job record.
 *
 * IT IS NOT A SECOND GUARD ON THE 2026-09-27 DEFECT. Restoring the original
 * "about a day" copy leaves this file GREEN (verified in review): one day is
 * 1,440 minutes, which is the TTL today, so the words were true and only
 * undeclared. The defect was that the copy did not DERIVE, and only
 * `numbers-honesty.test.ts` sees that. This file catches the other failure —
 * a served window that disagrees with the constant, e.g. after the TTL moves
 * and hand-typed words do not.
 *
 * The sentences are DISCOVERED (every sentence in the rendered markup that
 * mentions a job record), never listed, and there must be at least two of
 * them — the FAQ answer and its JSON-LD twin — so a page that stopped
 * rendering one cannot pass by saying less. WAS three until 2026-10-21: the
 * security card ("Auto-deleted on a schedule") retired with the privacy
 * grid in the plain redesign; /privacy states the window in full.
 *
 * DEFAULT, not the live value: production can override the TTL with
 * `PDFXYZ_QUEUE_JOB_TTL_SECONDS`, which a static page cannot read. The
 * deployment guide says to leave it unset for that reason, and
 * `deployment-docs-ttl` below keeps every documented default equal to this one.
 */
import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";
import { DEFAULT_JOB_TTL_SECONDS } from "@/lib/workers/queue/redis-config";

const MINUTES_PER: Record<string, number> = {
  minute: 1,
  hour: 60,
  day: 24 * 60,
  week: 7 * 24 * 60,
};

/** Visible text and JSON-LD strings of the rendered page, entity-decoded. */
function servedText(markup: string): string {
  return markup
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/g, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\u0026/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** Every sentence naming the job record. */
function jobRecordSentences(text: string): string[] {
  return (text.match(/[^.!?"]*\bjob record\b[^.!?"]*[.!?]?/gi) ?? []).map((s) =>
    s.trim(),
  );
}

/**
 * The duration a sentence states FOR THE JOB RECORD, in minutes, or undefined:
 * the first one after the words "job record", because the security card
 * states the download link's window earlier in the same sentence.
 */
function statedMinutes(sentence: string): number | undefined {
  const at = sentence.search(/\bjob record\b/i);
  const tail = at < 0 ? sentence : sentence.slice(at);
  const m =
    /\b(\d+|an?|one)\s+(minute|hour|day|week)s?\b/i.exec(tail) ?? undefined;
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : 1;
  return n * MINUTES_PER[m[2]!.toLowerCase()]!;
}

describe("the homepage states the job record's lifetime the queue enforces", () => {
  const text = servedText(renderToStaticMarkup(<HomePage />));
  const sentences = jobRecordSentences(text);

  it("finds the FAQ answer and its JSON-LD twin", () => {
    expect(
      sentences.length,
      `job-record sentences found:\n  ${sentences.join("\n  ")}`,
    ).toBeGreaterThanOrEqual(2);
  });

  it("every one of them states DEFAULT_JOB_TTL_SECONDS", () => {
    const wrong = sentences.filter(
      (s) => statedMinutes(s) !== DEFAULT_JOB_TTL_SECONDS / 60,
    );
    expect(
      wrong,
      `these sentences state a job-record window other than ${DEFAULT_JOB_TTL_SECONDS}s`,
    ).toEqual([]);
  });

  it("CONTROL: the predicate refuses a wrong window and a missing one", () => {
    const wrongHours = DEFAULT_JOB_TTL_SECONDS / 3600 + 1;
    const off = `a job record — the file's name — lasts about ${wrongHours} hours.`;
    expect(jobRecordSentences(off)).toHaveLength(1);
    expect(statedMinutes(off)).not.toBe(DEFAULT_JOB_TTL_SECONDS / 60);
    // The link's window, earlier in the sentence, is not the record's.
    expect(
      statedMinutes(
        "Downloads stop after 1440 minutes, and a job record lasts 12 hours.",
      ),
    ).toBe(12 * 60);
    expect(statedMinutes("a job record is kept for a while.")).toBeUndefined();
    // And it reads words, so a true "about a day" is not refused as a format.
    expect(statedMinutes("is kept for about a day.")).toBe(24 * 60);
  });
});

/** Operator-facing files: every markdown file under docs/, and the env examples. */
function operatorFiles(): string[] {
  const docs = (readdirSync("docs", { recursive: true }) as string[])
    .map((f) => `docs/${f.replace(/\\/g, "/")}`)
    .filter((f) => f.endsWith(".md"));
  const examples = readdirSync(".").filter((f) =>
    /^\.env(?:\.[\w-]+)*\.example$/.test(f),
  );
  return [...docs, ...examples];
}

/** Lines that recommend a value, or tell an operator to set the variable. */
function ttlOverrideAdvice(line: string): boolean {
  return (
    /\bset\s+`?PDFXYZ_QUEUE_JOB_TTL_SECONDS`?\s+(?:so|to)\b/i.test(line) ||
    (/PDFXYZ_QUEUE_JOB_TTL_SECONDS\s*=\s*\d/.test(line) &&
      !new RegExp(
        `PDFXYZ_QUEUE_JOB_TTL_SECONDS\\s*=\\s*${DEFAULT_JOB_TTL_SECONDS}\\b`,
      ).test(line))
  );
}

describe("deployment-docs-ttl: the operator docs keep the TTL the copy states", () => {
  const files = operatorFiles();
  const hits = files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.includes("PDFXYZ_QUEUE_JOB_TTL_SECONDS"))
      .map((line) => ({ file, line: line.trim() })),
  );
  const shown = hits.map((h) => `${h.file}: ${h.line}`).join("\n");

  it("finds the variable where operators read about it", () => {
    // Health check: the walk must see real docs, and the variable in at least
    // the deployment guide, the architecture doc and the worker env example.
    expect(files.length).toBeGreaterThan(10);
    expect(new Set(hits.map((h) => h.file)).size, shown).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("every stated default is the code's, and nothing tells an operator to change it", () => {
    // The homepage, the FAQ and /privacy state the DEFAULT, because a static
    // page cannot read the worker's environment. A doc that tells an operator
    // to set another value makes all three false in production, silently.
    for (const { file, line } of hits) {
      const stated = /default\s+(\d[\d_,]*)/i.exec(line)?.[1];
      if (stated)
        expect(Number(stated.replace(/[_,]/g, "")), `${file}: ${line}`).toBe(
          DEFAULT_JOB_TTL_SECONDS,
        );
    }
    expect(
      hits.filter((h) => ttlOverrideAdvice(h.line)).map((h) => h.file),
      shown,
    ).toEqual([]);
  });

  it("CONTROL: the advice predicate catches the sentence the guide shipped", () => {
    expect(
      ttlOverrideAdvice(
        "- Set `PDFXYZ_QUEUE_JOB_TTL_SECONDS` so every key auto-expires comfortably past the",
      ),
    ).toBe(true);
    expect(ttlOverrideAdvice("# PDFXYZ_QUEUE_JOB_TTL_SECONDS=3600")).toBe(true);
    expect(
      ttlOverrideAdvice(
        `# PDFXYZ_QUEUE_JOB_TTL_SECONDS=${DEFAULT_JOB_TTL_SECONDS}`,
      ),
    ).toBe(false);
    expect(
      ttlOverrideAdvice(
        "- Leave `PDFXYZ_QUEUE_JOB_TTL_SECONDS` unset: the pages state its default.",
      ),
    ).toBe(false);
  });
});
