// @vitest-environment node
/**
 * THE PROPERTY: the site does not sell a workflow feature the workspace does
 * not have.
 *
 * The homepage's workspace section (served on pdf.xyz at the audit) promised
 * "line up steps once and run them as a single pipeline", "save a workflow as
 * a preset you can rerun on the next batch in a click" and "chain tools into
 * repeatable pipelines", under "Build workflows, not one-off tasks" and an
 * arrowed "Example pipeline" strip. The workspace stages files and hands them
 * to ONE tool at a time. There is no chaining, no preset and no rerun.
 *
 * `unshipped-claims.test.ts` could not see this: it reads Markdown only, and
 * it checks the opposite direction (a line calling something unshipped that
 * the code proves exists).
 *
 * EXIT CONDITION (the property, not a mechanism): a pattern lifts only when a
 * user can run an ordered sequence of two or more tools over one batch, or
 * save such a sequence and rerun it on new files. A "preset" or "pipeline"
 * identifier appearing in workspace code does NOT lift it.
 *
 * Corpus in both directions (CLAUDE.md rule 1).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkflowSection } from "@/components/sections/workflow-section";
import { handoffCapabilityFor } from "@/lib/handoff/capability";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "./copy-surface";
import { tools } from "./index";

const ROOT = process.cwd();
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");

/** Workflow-feature claims, as shapes. */
const PATTERNS: readonly RegExp[] = [
  /\b(?:save|saved|store)\w*\s+(?:a\s+|your\s+)?(?:workflow|pipeline|sequence)s?\s+as\s+(?:a\s+)?preset/i,
  /\b(?:chain|line up|string together)\w*\s+(?:tools|steps)\b[^.]{0,80}\b(?:pipelines?|single run|one run)\b/i,
  /\b(?:repeatable|reusable)\s+(?:pipelines?|workflows?)\b/i,
  /\brerun\b[^.]{0,40}\bnext batch\b/i,
  /\bsingle pipeline\b/i,
  /\bbuild workflows\b/i,
  /\bexample pipeline\b/i,
];

/** What shipped (homepage, audit at 67e8d0f). */
const SHIPPED: readonly string[] = [
  "Merge, then compress, then stamp and sign — line up steps once and run them as a single pipeline.",
  "Download instantly, or save a workflow as a preset you can rerun on the next batch in a click.",
  "Most PDF sites make you repeat yourself. pdf.xyz keeps your files in a single workspace so you can chain tools into repeatable pipelines.",
  "Build workflows, not one-off tasks",
  "Example pipeline",
];

/** True sentences that must survive, so this is not a ban on words. */
const MUST_SURVIVE: readonly string[] = [
  "Add page numbers right in your browser — preset or custom number formats, with position, starting value, and typography.",
  "Presets “Page 1 of N”, “1 / N”, “1”, or “– 1 –” — or write your own template using {n} and {total}.",
  "Production pipeline",
  "Most PDF sites make you upload the same file again for every tool. pdf.xyz stages your files once, and the in-browser tools open with them already loaded.",
];

const hits = (text: string) => PATTERNS.filter((p) => p.test(text));

describe("workflow-feature claims — the ban list and its corpus", () => {
  it("every shipped sentence is caught", () => {
    for (const s of SHIPPED) expect(hits(s), s).not.toEqual([]);
  });

  it("every pattern catches a shipped sentence", () => {
    for (const p of PATTERNS) {
      expect(
        SHIPPED.some((s) => p.test(s)),
        `${p} catches nothing that shipped`,
      ).toBe(true);
    }
  });

  it("true sentences survive", () => {
    for (const s of MUST_SURVIVE) expect(hits(s), s).toEqual([]);
  });
});

describe("no surface sells chaining, presets or reruns", () => {
  const files = copyFiles();

  it("health: the walk reaches the homepage's workspace section", () => {
    expect(files.map(rel)).toContain(
      "src/components/sections/workflow-section.tsx",
    );
  });

  it("finds no claim in the source a visitor reads", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = flattenForPhraseSearch(
        withoutComments(readFileSync(file, "utf8")),
      );
      for (const p of PATTERNS) {
        const m = text.match(p);
        if (m) offenders.push(`${rel(file)}: "${m[0]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds no claim in the RENDERED section either", () => {
    const html = renderToStaticMarkup(createElement(WorkflowSection));
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text.length).toBeGreaterThan(200);
    expect(hits(text)).toEqual([]);
  });
});

describe("the tools the section shows really open staged files", () => {
  it("every chip in the strip names a tool with an in-browser handoff", () => {
    const html = renderToStaticMarkup(createElement(WorkflowSection));
    const strip = html.split("Tools that open your staged files")[1] ?? "";
    const labels = [...strip.matchAll(/text-\[13px\]">([^<]+)<\/span>/g)].map(
      (m) => m[1]!,
    );
    // Health: the strip is found and is not empty.
    expect(labels.length).toBeGreaterThanOrEqual(3);
    for (const label of labels) {
      const candidates = tools.filter((t) =>
        t.name.toLowerCase().split(/\s+/).includes(label.toLowerCase()),
      );
      expect(
        candidates.some((t) => handoffCapabilityFor(t.slug).supported),
        `"${label}" is shown as a tool that opens staged files, but no tool named so has a handoff`,
      ).toBe(true);
    }
  });
});
