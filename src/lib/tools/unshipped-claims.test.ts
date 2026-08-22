// @vitest-environment node
/**
 * No document may describe as UNSHIPPED something the code proves is shipped.
 *
 * WHAT SHIPPED WITHOUT THIS GUARD — three sentences, in three files, all false
 * on 2026-08-22:
 *
 *   README.md            | Secure-worker tools: Office ⇄ PDF, repair, PDF/A,
 *                          compare, … | 🔜 Planned (production) |
 *   README.md            | AI tools: chat, summarize, translate, extract
 *                          | 🔜 Planned |
 *   docs/SECURITY.md     **Planned AI tools:** chat with PDF, summarize,
 *                          translate, extract tables/data.
 *   docs/ENGINE_ROADMAP  ### Phase 7 — first real secure worker (in progress)
 *
 * Every worker-backed and AI tool named there resolves to a registered
 * processor, and production's own `/api/worker/status` reported a live worker
 * with a declared AI provider while the README told a reader none of it existed.
 *
 * THE THIRD ONE IS THE REASON THIS FILE WALKS THE TREE. The task that found the
 * first two named two documents. `docs/SECURITY.md` was not one of them, and it
 * carried the identical claim — found only by searching for the SHAPE of the
 * defect across every tracked markdown file instead of opening the files someone
 * had listed. A named list cannot see a file it does not name, so the corpus
 * here is DISCOVERED: every `.md` under the repo, minus build output.
 *
 * WHAT IT CHECKS, precisely, so nobody mistakes its silence for a broader
 * clearance: a line that carries an unshipped MARKER must not also name a
 * subject the code proves is implemented. Both halves are derived:
 *
 *   - a TOOL is implemented iff it has an in-browser runner (`isToolSupported`)
 *     or a worker processor claims its slug — the same two sources
 *     `catalog-coverage.test.ts` trusts, never a list typed here;
 *   - a CAPABILITY CLASS is implemented iff EVERY catalogue tool in it is. The
 *     class names come from `CAPABILITY_DESCRIPTORS`, so renaming a capability
 *     moves the guard with it.
 *
 * WHAT IT CANNOT SEE, in the same breath: a sentence can go false with no marker
 * in it at all ("the compare tool needs a worker"), and prose is not parsed here.
 * This is a marker-shaped tripwire over a discovered corpus, not a claim that the
 * documents are true. Its silence means "no MARKED line names an implemented
 * subject" — nothing wider.
 *
 * RULE 1, IN BOTH DIRECTIONS. Every marker pattern must catch a real shipped
 * sentence, and every real shipped sentence must be caught by some pattern —
 * otherwise a pattern is decoration or an example is a hole. The four sentences
 * above are kept in `SHIPPED_DEFECTS` as a positive-control corpus and both
 * directions are asserted against it. They are the tests that pinned the defect,
 * INVERTED rather than deleted: they used to be true of the repository, and they
 * now exist to prove the predicate can still fire. Delete them and the live-tree
 * assertion below becomes `[] ⊆ X` — vacuously, silently green.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tools, getAllToolSlugs } from "@/lib/tools";
import { isToolSupported } from "@/lib/pdf/registry";
import {
  CAPABILITY_DESCRIPTORS,
  capabilityForMode,
} from "@/lib/jobs/capabilities";
import { createProcessorRegistry } from "@/lib/workers/processor";
import type { ToolCapability } from "@/lib/jobs/types";

const ROOT = process.cwd();

/* ------------------------------------------------------------------ *
 *  1. The corpus: every markdown file in the tree. Walked, never named.
 * ------------------------------------------------------------------ */

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  "out",
  "build",
]);

function markdownFiles(dir = ROOT): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...markdownFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith(".md")) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 *  2. The subjects: what the code proves is implemented.
 * ------------------------------------------------------------------ */

/**
 * Registration is gated on a deps object being PASSED (which the daemon always
 * does), not on a native engine existing — so this is the full set of tools the
 * worker can ever route to, exactly as `catalog-coverage.test.ts` builds it.
 * Every dep is supplied and empty; each processor then reports `ready:false`
 * until its engine is present, which is a deployment question, not a shipped
 * question.
 */
function processorClaimedSlugs(): Set<string> {
  const registry = createProcessorRegistry({
    compression: { tools: { ghostscript: false, qpdf: false, mutool: false } },
    ocr: {},
    pdfSecurity: {},
    pdfStructure: {},
    pdfArchive: {},
    htmlRender: {},
    officeConversion: {},
    pdfOfficeExport: {},
    tableExtract: {},
    requestSignatures: {},
    summarize: {},
    translate: {},
    aiExtract: {},
    chatWithPdf: {},
  });
  return new Set(registry.list().flatMap((processor) => processor.tools));
}

/** A tool has shipped when something can actually run it. */
function implementedSlugs(): string[] {
  const claimed = processorClaimedSlugs();
  return getAllToolSlugs().filter(
    (slug) => isToolSupported(slug) || claimed.has(slug),
  );
}

/** A capability class has shipped when every tool the catalogue puts in it has. */
function implementedCapabilities(): ToolCapability[] {
  const implemented = new Set(implementedSlugs());
  const byClass = new Map<ToolCapability, string[]>();
  for (const tool of tools) {
    const capability = capabilityForMode(tool.processing);
    byClass.set(capability, [...(byClass.get(capability) ?? []), tool.slug]);
  }
  return [...byClass.entries()]
    .filter(
      ([, slugs]) =>
        slugs.length > 0 && slugs.every((slug) => implemented.has(slug)),
    )
    .map(([capability]) => capability);
}

/**
 * A regex naming one capability class, built from its own descriptor label so a
 * renamed capability moves the pattern with it.
 *
 * Hyphenation and spacing are SPELLINGS of the same shape, not different
 * subjects: the README wrote "Secure-worker tools" where the descriptor says
 * "Secure worker", and a literal comparison would have walked straight past it.
 * Case is a spelling too — except for a short all-caps label, where it is the
 * only thing separating the subject from ordinary prose. `/ai/i` matches
 * "available", "fail", and "maintain"; `/\bAI\b/` matches the claim.
 */
function classPattern(label: string): RegExp {
  const shape = label
    .split(/[\s\-–—]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .join("[\\s\\-–—]?");
  const caseSensitive = label.length <= 3 && label === label.toUpperCase();
  return new RegExp(`\\b${shape}\\b`, caseSensitive ? "u" : "iu");
}

/* ------------------------------------------------------------------ *
 *  3. The markers, and the sentences that pin each one.
 * ------------------------------------------------------------------ */

/**
 * The vocabulary these documents use to mark something as not-yet-shipped.
 * Each entry is exercised by `SHIPPED_DEFECTS` below — a pattern nothing
 * exercises is decoration, and the test that proves it fires is part of this
 * file rather than a comment claiming it does.
 */
const UNSHIPPED_MARKERS: Array<{ name: string; pattern: RegExp }> = [
  { name: "planned emoji", pattern: /🔜/u },
  { name: "the word planned", pattern: /\bplanned\b/iu },
  { name: "in-progress parenthetical", pattern: /\(\s*in\s+progress\s*\)/iu },
];

/**
 * The four real sentences this repository shipped, kept verbatim.
 *
 * Rule 7: a test that pinned a defect is inverted, not deleted. These were true
 * of `main` until this commit; they are retained as the positive control that
 * keeps the predicate honest once the tree is clean, because a clean tree makes
 * the live assertion vacuous and a vacuous assertion reports the strongest
 * possible pass.
 */
const SHIPPED_DEFECTS: Array<{ where: string; line: string }> = [
  {
    where: "README.md — project status table",
    line: "| Secure-worker tools: Office ⇄ PDF, repair, PDF/A, compare, deep compression, irreversible redaction, e-sign | 🔜 Planned (production) |",
  },
  {
    where: "README.md — project status table",
    line: "| AI tools: chat, summarize, translate, extract | 🔜 Planned |",
  },
  {
    where: "docs/SECURITY.md",
    line: "**Planned AI tools:** chat with PDF, summarize, translate, extract tables/data.",
  },
  {
    where: "docs/ENGINE_ROADMAP.md",
    line: "### Phase 7 — first real secure worker (in progress)",
  },
];

/** The implemented subjects a marked line names, or `[]` if it names none. */
function unshippedClaimsIn(line: string): string[] {
  if (!UNSHIPPED_MARKERS.some(({ pattern }) => pattern.test(line))) return [];

  const named: string[] = [];
  for (const capability of implementedCapabilities()) {
    const label = CAPABILITY_DESCRIPTORS[capability].label;
    if (classPattern(label).test(line)) {
      named.push(
        `capability class "${label}" (every tool in it is implemented)`,
      );
    }
  }
  for (const slug of implementedSlugs()) {
    if (new RegExp(`\\b${slug}\\b`, "u").test(line)) {
      named.push(`tool \`${slug}\``);
    }
  }
  return named;
}

describe("no document describes an implemented capability as unshipped", () => {
  it("the corpus and the subjects are big enough to mean something", () => {
    const docs = markdownFiles();
    const slugs = implementedSlugs();
    const classes = implementedCapabilities();

    // Print the MEMBERS, not a count: a zero from a walk is a claim, and it is
    // the claim that turns every assertion below into a vacuous pass.
    const names = docs.map((f) => path.relative(ROOT, f)).sort();
    expect(
      names.length,
      `markdown files walked: ${names.join(", ")}`,
    ).toBeGreaterThanOrEqual(10);
    expect(
      names.length,
      `markdown files walked: ${names.join(", ")}`,
    ).toBeLessThan(200);
    // The two documents the defect actually lived in must be inside the walk —
    // not because they are special, but because a walk that misses the root or
    // misses `docs/` would otherwise pass silently.
    expect(names).toContain("README.md");
    expect(names).toContain(path.join("docs", "ENGINE_ROADMAP.md"));
    expect(names).toContain(path.join("docs", "SECURITY.md"));

    // Every catalogue tool runs somewhere today. Bound it rather than pin it:
    // an unimplemented tool is allowed to exist, a catalogue that has gone
    // invisible to this guard is not.
    expect(slugs.length).toBeGreaterThanOrEqual(tools.length - 5);
    expect(
      classes.map(String).sort(),
      "no capability class is fully implemented — the subject set has gone empty",
    ).not.toEqual([]);
    expect(classes.length).toBeGreaterThanOrEqual(3);
  });

  it("every marker pattern catches a sentence this repository really shipped", () => {
    // Direction one of rule 1. A pattern no shipped sentence exercises is
    // decoration that accumulates until the list stops meaning anything.
    const unexercised = UNSHIPPED_MARKERS.filter(
      ({ pattern }) => !SHIPPED_DEFECTS.some((d) => pattern.test(d.line)),
    ).map((m) => m.name);
    expect(unexercised).toEqual([]);
  });

  it("every sentence this repository shipped is caught by some pattern", () => {
    // Direction two. An example nothing catches is a hole, and this is the
    // direction that fails first — it is how the "Secure-worker" vs "Secure
    // worker" hyphenation was found.
    const missed = SHIPPED_DEFECTS.filter(
      (d) => unshippedClaimsIn(d.line).length === 0,
    ).map((d) => `${d.where}: ${d.line.slice(0, 60)}…`);
    expect(missed).toEqual([]);
  });

  it("no line in the tree marks an implemented subject as unshipped", () => {
    const findings: string[] = [];
    for (const file of markdownFiles()) {
      if (statSync(file).isDirectory()) continue;
      const rel = path.relative(ROOT, file);
      // This file quotes all four defects verbatim, on purpose. A guard that
      // flagged its own fixtures would cry wolf, and a guard that cries wolf is
      // the one the next person weakens.
      if (rel === path.relative(ROOT, import.meta.filename)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const named of unshippedClaimsIn(line)) {
            findings.push(`${rel}:${i + 1} marks ${named} as unshipped`);
          }
        });
    }
    expect(findings).toEqual([]);
  });
});
