// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supportedToolSlugs, getRunnerKind } from "@/lib/pdf/registry";
import { ANNOTATION_GROUP_LABEL } from "@/lib/pdf/offered-kinds";
import { toolContent } from "./content";
import { withoutComments } from "./copy-surface";

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
 * words-only strings its module renders (JSX text and string literals),
 * plus, for Remove Annotations, its group labels; a label both modules
 * draw ("Download PDF") belongs to neither.
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

const LABEL_SHAPE = /^[A-Z][a-z]+(?: [A-Za-z&]+){1,5}$/;

function labelsIn(source: string): Set<string> {
  const found = new Set<string>();
  const add = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (LABEL_SHAPE.test(t)) found.add(t);
  };
  for (const m of source.matchAll(/"([^"\n]+)"/g)) add(m[1]!);
  for (const m of source.matchAll(/>([^<>{}]+)</g)) add(m[1]!);
  return found;
}

function variantLabels(slug: string): Set<string> {
  const labels = labelsIn(read(moduleFor(slug)));
  if (moduleFor(slug).endsWith("remove-annotations-editor.tsx")) {
    for (const label of Object.values(ANNOTATION_GROUP_LABEL))
      labels.add(label);
  }
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
      if (texts.some((t) => t.includes(label))) hits.push(`${other}: ${label}`);
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
  });

  it("no tool's page quotes a sibling variant's label", () => {
    const offenders = METADATA_SLUGS.flatMap((slug) =>
      crossQuotes(slug, prose(toolContent[slug])).map(
        (h) => `${slug} quotes ${h}`,
      ),
    );
    expect(offenders).toEqual([]);
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
