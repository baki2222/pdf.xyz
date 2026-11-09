// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supportedToolSlugs, getRunnerKind } from "@/lib/pdf/registry";
import { getToolBySlug, tools } from "@/lib/tools";
import { toolContent } from "./content";
import { withoutComments } from "./copy-surface";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageTitle,
  pageUseCases,
  stepText,
} from "./page-copy";
import { toolFacts } from "./tool-facts";

/**
 * Two tools share the `metadata` runner kind: Edit PDF Metadata, and Remove
 * Annotations, which `metadata-runner.tsx` mounts for its slug. So the
 * prose-to-UI label guard (`tool-page-ui-labels.test.ts`), which reads every
 * string reachable from a kind's panel module, reads BOTH tools' controls
 * for either page: Edit PDF Metadata's page could tell a reader to press
 * "Annotations to remove" and that guard would find the words on "its"
 * panel. This closes that hole: a tool's page quotes none of the labels
 * only a sibling variant draws.
 *
 * DISCOVERED, both sides: the tools are every slug the registry maps to
 * `metadata`; each one's module is the component `MetadataRunner` returns
 * for its slug (read from the switch), or `metadata-runner.tsx` itself for
 * the slug it does not switch on. A variant's labels are the capital-led
 * words-only strings its module renders (JSX text and string literals) AND
 * those of every project module it reaches by value imports (not entering
 * a sibling variant's panel), where its label tables live (Edit PDF Metadata's field names, Remove
 * Annotations' group labels); a label both variants reach ("Download PDF")
 * belongs to neither, and a tool's own NAME is not a control label.
 *
 * Widened 2026-11-10 (review round 1). The corpus was `toolContent` alone
 * and labels needed two words: an injected "Press Remove all metadata" in
 * the catalogue's steps, the description, the tagline or the facts went
 * unseen, and so did a sibling's one-word controls ("Title", "Kept"). The
 * corpus is now every accessor the page renders through (`page-copy.ts`,
 * `toolFacts`, the catalogue row); a one-word label counts only when QUOTED,
 * the way steps quote a control, since "Kept" is also a plain word.
 */

const ROOT = process.cwd();
const RUNNER_DIR = "src/components/tools/runner";
const read = (rel: string) =>
  withoutComments(readFileSync(path.join(ROOT, rel), "utf8"));

const METADATA_SLUGS = supportedToolSlugs.filter(
  (slug) => getRunnerKind(slug) === "metadata",
);

/** The module each metadata-kind slug's panel is defined in. */
function moduleFor(slug: string): string {
  const host = read(`${RUNNER_DIR}/metadata-runner.tsx`);
  const arm = new RegExp(
    `slug\\s*===\\s*"${slug}"\\s*\\)\\s*\\{\\s*return\\s*<(\\w+)`,
  ).exec(host);
  if (!arm) return `${RUNNER_DIR}/metadata-runner.tsx`;
  const from = new RegExp(
    `import\\s*\\{[^}]*\\b${arm[1]}\\b[^}]*\\}\\s*from\\s*"\\./([^"]+)"`,
  ).exec(host)?.[1];
  if (!from) throw new Error(`no import for ${arm[1]}`);
  return `${RUNNER_DIR}/${from}.tsx`;
}

const LABEL_SHAPE = /^[A-Z][a-z]+(?: [A-Za-z&]+){0,5}$/;

/** Tool names are links between pages, not control labels. */
const TOOL_NAMES = new Set(tools.map((t) => t.name));

/**
 * The project modules a source reaches by VALUE imports and re-exports,
 * transitively (`import type` and `export type` are erased at runtime and
 * not followed), never entering `stop`. Static imports only: a lazily
 * imported engine draws no control.
 */
function reachable(rel: string, stop: ReadonlySet<string>): string[] {
  const seen = new Set<string>([rel]);
  const queue = [rel];
  while (queue.length) {
    const file = queue.pop()!;
    const source = readFileSync(path.join(ROOT, file), "utf8");
    const dir = path.posix.dirname(file);
    for (const m of source.matchAll(
      /^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gms,
    )) {
      const spec = m[1]!;
      const base = spec.startsWith("@/")
        ? `src/${spec.slice(2)}`
        : spec.startsWith(".")
          ? path.posix.join(dir, spec)
          : null;
      if (!base) continue;
      const found = [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
      ].find((f) => existsSync(path.join(ROOT, f)));
      if (!found || seen.has(found) || stop.has(found)) continue;
      seen.add(found);
      queue.push(found);
    }
  }
  return [...seen];
}

function labelsIn(source: string): Set<string> {
  const found = new Set<string>();
  const add = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (LABEL_SHAPE.test(t) && !TOOL_NAMES.has(t)) found.add(t);
  };
  for (const m of source.matchAll(/"([^"\n]+)"/g)) add(m[1]!);
  for (const m of source.matchAll(/>([^<>{}]+)</g)) add(m[1]!);
  return found;
}

function variantLabels(slug: string): Set<string> {
  const own = moduleFor(slug);
  // The host imports its siblings' panels; a sibling's module is that
  // sibling's, not the host's.
  const siblings = new Set(
    METADATA_SLUGS.filter((s) => s !== slug).map(moduleFor),
  );
  const labels = new Set<string>();
  for (const rel of reachable(own, siblings))
    for (const label of labelsIn(read(rel))) labels.add(label);
  return labels;
}

/** Every string a content value holds, walked. */
function prose(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(prose);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(prose);
  return [];
}

/** Everything the tool's page says, through the accessors it renders with. */
function servedCopy(slug: string): string[] {
  const tool = getToolBySlug(slug);
  if (!tool) throw new Error(`no catalogue row for ${slug}`);
  return [
    tool.name,
    tool.tagline,
    tool.description,
    pageTitle(tool),
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
    ...toolFacts(slug).flatMap((f) => [f.label, f.value]),
    ...prose(toolContent[slug]),
  ];
}

/** A one-word label as a step quotes a control: in quotation marks. */
const QUOTES: readonly (readonly [string, string])[] = [
  ["“", "”"],
  ['"', '"'],
  ["‘", "’"],
];

function exclusive(): Map<string, Set<string>> {
  const all = new Map(METADATA_SLUGS.map((s) => [s, variantLabels(s)]));
  const out = new Map<string, Set<string>>();
  for (const [slug, labels] of all) {
    const others = new Set(
      [...all].filter(([s]) => s !== slug).flatMap(([, l]) => [...l]),
    );
    out.set(slug, new Set([...labels].filter((l) => !others.has(l))));
  }
  return out;
}

function crossQuotes(slug: string, texts: readonly string[]): string[] {
  const hits: string[] = [];
  for (const [other, labels] of exclusive()) {
    if (other === slug) continue;
    for (const label of labels) {
      const one = !label.includes(" ");
      const said = (t: string) =>
        one
          ? QUOTES.some(([o, c]) => t.includes(`${o}${label}${c}`))
          : t.includes(label);
      if (texts.some(said)) hits.push(`${other}: ${label}`);
    }
  }
  return hits;
}

describe("tools sharing the metadata runner quote only their own labels", () => {
  it("discovers both tools and a plausible label set for each (health check)", () => {
    expect(METADATA_SLUGS).toEqual(
      expect.arrayContaining(["edit-pdf-metadata", "remove-annotations"]),
    );
    const modules = new Set(METADATA_SLUGS.map(moduleFor));
    expect(modules.size).toBe(METADATA_SLUGS.length);
    for (const [slug, labels] of exclusive()) {
      expect(
        labels.size,
        `${slug}: ${[...labels].join(" | ")}`,
      ).toBeGreaterThanOrEqual(5);
    }
    expect(exclusive().get("edit-pdf-metadata")).toContain(
      "Remove all metadata",
    );
    expect(exclusive().get("remove-annotations")).toContain(
      "Annotations to remove",
    );
    // The import walk is neither collapsed nor runaway, and never enters a
    // sibling's panel.
    for (const slug of METADATA_SLUGS) {
      const others = new Set(
        METADATA_SLUGS.filter((s) => s !== slug).map(moduleFor),
      );
      const walked = reachable(moduleFor(slug), others);
      expect(walked.length, slug).toBeGreaterThan(5);
      expect(walked.length, slug).toBeLessThan(600);
      expect(walked.filter((f) => others.has(f))).toEqual([]);
    }
    // The label tables reached through imports, and one-word labels, are in
    // the sets.
    expect(exclusive().get("edit-pdf-metadata")).toContain("Title");
    expect(exclusive().get("remove-annotations")).toContain(
      "Comments and notes",
    );
    expect(exclusive().get("remove-annotations")).toContain("Kept");
    // The served corpus reaches past the content module.
    for (const slug of METADATA_SLUGS) {
      const tool = getToolBySlug(slug)!;
      const corpus = servedCopy(slug);
      expect(corpus).toContain(tool.tagline);
      expect(corpus.length, slug).toBeGreaterThan(15);
    }
  });

  it("no tool's page quotes a sibling variant's label", () => {
    const offenders = METADATA_SLUGS.flatMap((slug) =>
      crossQuotes(slug, servedCopy(slug)).map((h) => `${slug} quotes ${h}`),
    );
    expect(offenders).toEqual([]);
  });

  it("positive control: a cross label outside the content module, and a quoted one-word label, are caught", () => {
    // Served copy the content module does not hold: a catalogue step, the
    // tagline, a facts row.
    expect(
      crossQuotes("remove-annotations", [
        ...servedCopy("remove-annotations"),
        "Press Remove all metadata and download the copy.",
      ]),
    ).toEqual(["edit-pdf-metadata: Remove all metadata"]);
    expect(
      crossQuotes("edit-pdf-metadata", [
        ...servedCopy("edit-pdf-metadata"),
        "The table lists each kind under “Kept”.",
      ]),
    ).toEqual(["remove-annotations: Kept"]);
    expect(
      crossQuotes("remove-annotations", [
        ...servedCopy("remove-annotations"),
        "Type the new name under “Title”.",
      ]),
    ).toEqual(["edit-pdf-metadata: Title"]);
    // An unquoted plain word is not a quoted control.
    expect(
      crossQuotes("edit-pdf-metadata", [
        ...servedCopy("edit-pdf-metadata"),
        "Kept files stay on your device.",
      ]),
    ).toEqual([]);
  });

  it("positive control: one injected cross label, either way, is caught", () => {
    const meta = prose(toolContent["edit-pdf-metadata"]);
    expect(
      crossQuotes("edit-pdf-metadata", [
        ...meta,
        "Press Annotations to remove.",
      ]),
    ).toEqual(["remove-annotations: Annotations to remove"]);
    const annots = prose(toolContent["remove-annotations"]);
    expect(
      crossQuotes("remove-annotations", [
        ...annots,
        "Choose Remove all metadata.",
      ]),
    ).toEqual(["edit-pdf-metadata: Remove all metadata"]);
  });
});
