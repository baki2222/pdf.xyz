// @vitest-environment node
/**
 * A page that quotes a drop zone's label quotes one a panel renders.
 *
 * `<Dropzone title="…, or" />` (runner-kit.tsx) renders its title followed by
 * a "browse" control, and the tool pages tell readers to look for that text:
 * "drop one PDF onto the area that reads "Add a password-protected PDF, or
 * browse"". Unlock PDF's panel titles its zone "Add a locked PDF, or", so the
 * quoted label was on no screen (verifier, 028d3a10), and nothing tied the
 * quote to the component.
 *
 * The corpus is what pages SERVE: every quoted "…, or browse" in every served
 * field of every tool. The labels are DISCOVERED: every `"…, or"` string
 * literal under src/components (comments removed), which is where every
 * Dropzone title and the component's own default live.
 *
 * WHAT THIS DOES NOT SEE: a quote of a label that exists in ANOTHER tool's
 * panel. The set is every component's, not the quoting tool's runner — wide
 * enough to catch a label nobody renders, which is the defect that shipped.
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

/**
 * Every `"…, or"` literal a component can render as a drop zone title, and
 * every `` `…, or` `` template (`Drop ${label} images here, or`), whose
 * `${…}` becomes one word.
 */
const RENDERED: readonly RegExp[] = sourceFiles("src/components").flatMap(
  (file) => {
    const code = withoutComments(readFileSync(path.join(ROOT, file), "utf8"));
    return [
      ...[...code.matchAll(/"([^"\n]{3,80}, or)"/g)].map(
        (m) => new RegExp(`^${escape(m[1]!)}$`),
      ),
      ...[...code.matchAll(/`([^`\n]{3,80}, or)`/g)].map(
        (m) =>
          new RegExp(
            `^${m[1]!
              .split(/\$\{[^}]*\}/)
              .map(escape)
              .join("\\S+")}$`,
          ),
      ),
    ];
  },
);

const rendered = (label: string) => RENDERED.some((r) => r.test(label));

function servedFields(tool: Tool): string[] {
  return [
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
  ];
}

/** The labels a field quotes as "<title> browse", straight or curly quotes. */
function quotedLabels(field: string): string[] {
  return [...field.matchAll(/["“]([^"“”]{3,80}, or) browse["”]/g)].map(
    (m) => m[1]!,
  );
}

const unrendered = (field: string) =>
  quotedLabels(field).filter((label) => !rendered(label));

describe("a page that quotes a drop zone's label quotes a rendered one", () => {
  it("health check: the labels are discovered from the components, and pages quote them", () => {
    expect(RENDERED.length).toBeGreaterThan(8);
    expect(RENDERED.length).toBeLessThan(60);
    // The component's own default, an expression-chosen title and a template
    // title are seen.
    expect(rendered("Drop your PDF here, or")).toBe(true);
    expect(rendered("Add a locked PDF, or")).toBe(true);
    expect(rendered("Drop JPG images here, or")).toBe(true);
    // A wildcard is one word, not anything.
    expect(rendered("Drop JPG or PNG images here, or")).toBe(false);
    const quotes = tools.flatMap((t) => servedFields(t).flatMap(quotedLabels));
    expect(quotes.length).toBeGreaterThan(10);
  });

  it("the predicate catches the quote that shipped, and not the fixed one", () => {
    const shipped =
      'Once the badge reads Secure worker, drop one PDF onto the area that reads "Add a password-protected PDF, or browse"; clicking that area opens a file picker instead.';
    expect(unrendered(shipped)).toEqual(["Add a password-protected PDF, or"]);
    expect(
      unrendered(shipped.replace("a password-protected PDF", "a locked PDF")),
    ).toEqual([]);
  });

  it("no served field quotes a drop zone label no panel renders", () => {
    const offenders = tools.flatMap((tool) =>
      servedFields(tool).flatMap((field) =>
        unrendered(field).map((label) => `${tool.slug}: "${label} browse"`),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
