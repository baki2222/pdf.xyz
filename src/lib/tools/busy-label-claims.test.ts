// @vitest-environment node
/**
 * A page that names a worker button's busy label names the stages around it.
 *
 * Every worker panel labels its run button through `jobBusyLabel(job.phase,
 * working)` (worker-job.tsx): "Uploading your file…" while the file uploads,
 * "Waiting for the worker…" while the job is queued, the panel's own WORKING
 * label while it runs, and "Downloading the result…" while the result comes
 * back. The pages were written before that function existed, when the button
 * read one label for the whole round trip, and they kept saying so:
 *
 *   chat-with-pdf  "The button reads Answering… until the answer package is
 *                  back in the page."
 *   excel-to-pdf   "The button reads "Converting PDF…" while the spreadsheet
 *                  uploads, LibreOffice renders it and the finished PDF comes
 *                  back."
 *   ai-extract     "Extracting… while the PDF uploads" (fixed d3263ff7)
 *
 * and a dozen more, each found one page at a time by a verifier at 028d3a10.
 * Nothing tied the copy to the function. This does, over what each page
 * SERVES: a served field that names any panel's working label must also name
 * the queued and downloading labels — the two stages every worker job passes
 * through (a URL job has no upload, so the upload label is not required).
 *
 * The working labels are DISCOVERED from every `jobBusyLabel(` call under
 * src/components, never typed: a literal is taken as written, a template's
 * `${…}` becomes a wildcard, and any other expression (`COPY[mode].running`)
 * takes every `running: "…"` literal in that file. An argument of no known
 * shape is fatal, not skipped.
 *
 * WHAT THIS DOES NOT SEE: a page that describes the button without quoting
 * the working label ("the button shows a spinner"), and a field that names
 * all three labels in the wrong order.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "./catalog";
import type { Tool } from "./types";
import { withoutComments } from "./copy-surface";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";
import { jobBusyLabel } from "@/components/tools/worker-job";

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(rel);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [rel]
        : [];
    },
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface CallSite {
  file: string;
  labels: RegExp[];
}

/** Every `jobBusyLabel(phase, working)` call and the labels `working` can be. */
function callSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of sourceFiles("src/components")) {
    const code = withoutComments(readFileSync(path.join(ROOT, file), "utf8"));
    for (const m of code.matchAll(/\bjobBusyLabel\(\s*[\w.]+\s*,\s*/g)) {
      const rest = code.slice(m.index! + m[0].length);
      let labels: RegExp[];
      const literal = /^"([^"]+)"\s*\)/.exec(rest);
      const template = /^`([^`]+)`\s*\)/.exec(rest);
      const expression = /^[\w[\].]+\.running\s*\)/.exec(rest);
      if (literal) labels = [new RegExp(escape(literal[1]!))];
      else if (template)
        labels = [
          new RegExp(
            template[1]!
              .split(/\$\{[^}]*\}/)
              .map(escape)
              .join("\\S+"),
          ),
        ];
      else if (expression) {
        const running = [...code.matchAll(/\brunning:\s*"([^"]+)"/g)].map(
          (r) => new RegExp(escape(r[1]!)),
        );
        if (running.length === 0)
          throw new Error(`${file}: ${expression[0]} has no running: "…"`);
        labels = running;
      } else
        throw new Error(
          `${file}: jobBusyLabel's working label has an unknown shape: ${rest.slice(0, 60)}`,
        );
      sites.push({ file, labels });
    }
  }
  return sites;
}

/** Every string the page serves, one field each. */
function servedFields(tool: Tool): string[] {
  return [
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
  ];
}

const QUEUED = jobBusyLabel("queued", "");
const DOWNLOADING = jobBusyLabel("downloading", "");

const SITES = callSites();
const WORKING = SITES.flatMap((s) => s.labels);

/** A field that names a working label without the stages around it. */
function oneLabelClaim(field: string): boolean {
  return (
    WORKING.some((label) => label.test(field)) &&
    !(field.includes(QUEUED) && field.includes(DOWNLOADING))
  );
}

function offenders(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const tool of tools) {
    const hit = servedFields(tool).filter(oneLabelClaim);
    if (hit.length > 0) out.set(tool.slug, hit);
  }
  return out;
}

/**
 * Pages that still served a one-label sentence when this guard landed
 * (2026-10-07). A RATCHET, not an exemption: the last test fails as soon as a
 * page here stops offending, so each entry is deleted by the change that fixes
 * its page, and a page not listed here may never start.
 */
const KNOWN_STALE: ReadonlySet<string> = new Set([
  // Verifier findings at 028d3a10, each queued for its own fix. html-to-pdf
  // left on 2026-10-07 when its step named all four labels; optimize-web,
  // pdf-to-pdfa, pdf-to-powerpoint and powerpoint-to-pdf the same day.
  "summarize-pdf",
  "translate-pdf",
  "unlock-pdf",
  "word-to-pdf",
  // Found by this guard on landing; in no verifier's list. "reads Preparing
  // request… while it works", "reads Repairing on the worker… until the
  // repaired copy has been fetched". pdf-to-word ("shows Exporting DOCX…
  // while the job runs" beside "Your file goes up") left on 2026-10-07 when
  // its step named all four labels.
  "request-signatures",
  "repair-pdf",
]);

describe("a page that names a busy label names the stages around it", () => {
  it("health check: the labels are discovered from every worker panel, and the phase labels from the function", () => {
    // Every panel that runs a worker job labels its button through
    // jobBusyLabel — the relationship, so a new panel cannot be missed.
    const usesJob = sourceFiles("src/components").filter(
      (f) =>
        !f.endsWith("/worker-job.tsx") &&
        /\buseWorkerJob\b\s*(?:<[^>]*>)?\s*\(/.test(
          withoutComments(readFileSync(path.join(ROOT, f), "utf8")),
        ),
    );
    const labelled = new Set(SITES.map((s) => s.file));
    expect(usesJob.length).toBeGreaterThan(10);
    expect(usesJob.filter((f) => !labelled.has(f))).toEqual([]);
    expect(SITES.length).toBeGreaterThanOrEqual(usesJob.length);
    expect(WORKING.length).toBeGreaterThan(SITES.length);
    expect(WORKING.length).toBeLessThan(40);
    expect(QUEUED).toBe("Waiting for the worker…");
    expect(DOWNLOADING).toBe("Downloading the result…");
    // The expression and template shapes resolved to real labels.
    expect(WORKING.some((l) => l.test("Unlocking on the worker…"))).toBe(true);
    expect(WORKING.some((l) => l.test("Exporting PPTX…"))).toBe(true);
  });

  it("the predicate catches every one-label sentence that shipped, and not the fixed ones", () => {
    for (const shipped of [
      "Type your question. Write it in the Your question box in plain language, up to 2,000 characters, and press Ask the PDF. The button reads Answering… until the answer package is back in the page.",
      'Start the conversion. With the file in place, go straight to Convert to PDF; nothing needs setting beforehand. The button reads "Converting PDF…" while the spreadsheet uploads, LibreOffice renders it and the finished PDF comes back.',
      "Press Extract data. The button reads Extracting… while the PDF uploads and the job runs.",
    ])
      expect(oneLabelClaim(shipped), shipped).toBe(true);
    expect(
      oneLabelClaim(
        "While it runs, the button says where the job is (Uploading your file…, Waiting for the worker…, Answering…, Downloading the result…) until the answer package is back in the page.",
      ),
    ).toBe(false);
    // A field naming no working label is not this guard's business.
    expect(oneLabelClaim("Press Convert to PDF.")).toBe(false);
  });

  it("no page outside the ratchet serves a one-label sentence", () => {
    const found = offenders();
    const unexpected = [...found]
      .filter(([slug]) => !KNOWN_STALE.has(slug))
      .map(([slug, fields]) => `${slug}: ${fields.join(" | ")}`);
    expect(unexpected).toEqual([]);
  });

  it("every page in the ratchet still offends (delete its entry when it is fixed)", () => {
    const found = offenders();
    expect([...KNOWN_STALE].filter((slug) => !found.has(slug))).toEqual([]);
  });
});

/*
 * The same panels share one more surface: what a page says happens when the
 * browser stops polling a job that is still running. Before useWorkerJob the
 * client ended the run with "Stopped waiting for the worker — the job may
 * still finish." and the job id; html-to-pdf's FAQ said exactly that at
 * 028d3a10 ("ends instead with a note that the job may still finish, and the
 * job's id"). WorkerJobStatus now shows a still-running note with a Keep
 * waiting button that polls the SAME job, keeps the id as data and never
 * prints it. So a served field that talks about the page stopping waiting,
 * the job still finishing or the job's id must name the Keep waiting control
 * (its label read from WorkerJobStatus) and must not promise the id.
 */
const WORKER_JOB_SOURCE = readFileSync(
  path.join(ROOT, "src/components/tools/worker-job.tsx"),
  "utf8",
);
const KEEP_WAITING =
  /onClick=\{job\.resume\}[\s\S]*?\/>\s*([^<{]+?)\s*<\/button>/.exec(
    WORKER_JOB_SOURCE,
  )?.[1];
const STOPS_WAITING =
  /\b(?:stops|stopped) waiting\b|\bmay still (?:finish|be running)\b|\bjob'?s? id\b/i;
const PRINTS_ID = /\bjob'?s? id\b/i;

function staleStillRunning(field: string): boolean {
  return (
    STOPS_WAITING.test(field) &&
    (!field.includes(KEEP_WAITING ?? "\u0000") || PRINTS_ID.test(field))
  );
}

function stillRunningOffenders(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const tool of tools) {
    const hit = servedFields(tool).filter(staleStillRunning);
    if (hit.length > 0) out.set(tool.slug, hit);
  }
  return out;
}

/** Same ratchet rule as KNOWN_STALE: delete an entry with its page's fix. */
const STILL_RUNNING_STALE: ReadonlySet<string> = new Set([
  // Found by this guard on landing (2026-10-07). repair-pdf: the button
  // reads one label until "the page stops waiting and says the job may still
  // finish". powerpoint-to-pdf ("the panel then shows the job's id") left
  // the same day when its FAQ named Keep waiting.
  "repair-pdf",
]);

describe("a page that says the browser stops waiting names Keep waiting", () => {
  it("health check: every worker panel's still-running UI is WorkerJobStatus, which offers Keep waiting and prints no id", () => {
    expect(KEEP_WAITING).toBe("Keep waiting");
    const status = WORKER_JOB_SOURCE.slice(
      WORKER_JOB_SOURCE.indexOf("export function WorkerJobStatus"),
    );
    expect(status).toContain("failure.stillRunning");
    expect(status).not.toMatch(/\{\s*(?:failure|outcome)\.jobId\s*\}/);
    const usesJob = sourceFiles("src/components").filter(
      (f) =>
        !f.endsWith("/worker-job.tsx") &&
        /\buseWorkerJob\b\s*(?:<[^>]*>)?\s*\(/.test(
          withoutComments(readFileSync(path.join(ROOT, f), "utf8")),
        ),
    );
    expect(usesJob.length).toBeGreaterThan(10);
    expect(
      usesJob.filter(
        (f) =>
          !/<WorkerJobStatus\b/.test(
            withoutComments(readFileSync(path.join(ROOT, f), "utf8")),
          ),
      ),
    ).toEqual([]);
  });

  it("the predicate catches the shipped still-running sentences, and not the fixed ones", () => {
    for (const shipped of [
      "A render still running when the page stops waiting ends instead with a note that the job may still finish, and the job's id.",
      "Each of those failures is retried automatically before the job is marked failed, so a slow deck can outlast the page's wait, and the panel then shows the job's id instead of a result.",
    ])
      expect(staleStillRunning(shipped), shipped).toBe(true);
    expect(
      staleStillRunning(
        "If the page stops waiting while the render is still going, a note says the worker is still on the job and offers Keep waiting, which picks up the same job rather than uploading the file again or starting a new one, or Cancel the job.",
      ),
    ).toBe(false);
  });

  it("no page outside the ratchet serves a stale still-running sentence", () => {
    const unexpected = [...stillRunningOffenders()]
      .filter(([slug]) => !STILL_RUNNING_STALE.has(slug))
      .map(([slug, fields]) => `${slug}: ${fields.join(" | ")}`);
    expect(unexpected).toEqual([]);
  });

  it("every page in the still-running ratchet still offends", () => {
    const found = stillRunningOffenders();
    expect([...STILL_RUNNING_STALE].filter((slug) => !found.has(slug))).toEqual(
      [],
    );
  });
});
