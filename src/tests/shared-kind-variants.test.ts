// @vitest-environment node
/**
 * The source reader behind `src/deploy/variant-panels.test.ts`, held without
 * a build: on the tree as it is (the relationships the build guard relies
 * on), and on runners written to a temporary directory in the shapes that
 * guard must not be fooled by.
 *
 * The case it was rewritten for (review of 6376d6da, 2026-11-14): Booklet's
 * arm written INLINE, `<SinglePdfRunner …>{… <BookletEditor />}` with a
 * static `import { BookletEditor }`. The old reader took the arm's host from
 * its first capitalised tag — `single-pdf-runner.tsx` — and that module's
 * unrelated `import("../replace-boxes")` passed for Booklet's lazy editor;
 * the built Multiple Pages per Sheet page carried the booklet editor and the
 * sibling-editor assertion was green. Reproduced on this branch's build
 * before the fix (1 failed | 3 passed, the failure the positive control on
 * replace-boxes.tsx's single marker; the main assertion green).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { SRC, ownPanelModules, rel } from "./tool-panel-modules";
import { readVariants, type VariantShape } from "./shared-kind-variants";

const RUNNER_DIR = path.join(SRC, "components", "tools", "runner");
const BOOKLET_EDITOR = path.join(RUNNER_DIR, "n-up", "booklet-editor.tsx");
const N_UP_EDITOR = path.join(RUNNER_DIR, "n-up", "n-up-editor.tsx");
const BOOKLET_ENGINE = path.join(SRC, "lib", "pdf", "booklet.ts");
const SLUGS = ["n-up-pdf", "booklet-pdf"];

const HEAD = `"use client";
import { SinglePdfRunner } from "@/components/tools/runner/single-pdf-runner";
import { lazyPanel } from "@/components/tools/runner/lazy-panel";
import { useToolRun } from "@/components/tools/runner/tool-context";
`;
const N_UP_PANEL = `
const nUp = lazyPanel(
  () => import("@/components/tools/runner/n-up/n-up-editor").then(({ NUpEditor }) => NUpEditor),
  "Opening…",
);
`;
const DEFAULT_ARM = `
  return (
    <SinglePdfRunner hint="h" handoffSlug="n-up-pdf" toolName="t" prepare={nUp.prepare}>
      {(pdf, reset) => <nUp.Panel pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
`;
const LAZY_HOST = `"use client";
import { SinglePdfRunner } from "@/components/tools/runner/single-pdf-runner";
import { lazyPanel } from "@/components/tools/runner/lazy-panel";
const booklet = lazyPanel(
  () => import("@/components/tools/runner/n-up/booklet-editor").then(({ BookletEditor }) => BookletEditor),
  "Opening…",
);
export function BookletHost() {
  return (
    <SinglePdfRunner hint="h" handoffSlug="booklet-pdf" toolName="t" prepare={booklet.prepare}>
      {(pdf, reset) => <booklet.Panel pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}
`;

/** Write `files` to a fresh directory; returns the runner's path. */
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "shared-kind-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return path.join(dir, "runner.tsx");
}

const variant = (vs: VariantShape[], slug: string): VariantShape =>
  vs.find((v) => v.slugs.includes(slug))!;

describe("the variants of a shared runner kind, read from each branch's own code", () => {
  it("on the tree: every multi-variant kind's variants own disjoint modules, each with a lazy editor", () => {
    const byKind = new Map<string, string[]>();
    for (const slug of supportedToolSlugs) {
      const kind = getRunnerKind(slug)!;
      byKind.set(kind, [...(byKind.get(kind) ?? []), slug]);
    }
    const { bySlug } = ownPanelModules();
    const multi: VariantShape[] = [];
    for (const [kind, slugs] of byKind) {
      if (slugs.length < 2) continue;
      const vs = readVariants(kind, slugs, bySlug.get(slugs[0]!)!.file);
      expect(vs.flatMap((v) => v.slugs).sort()).toEqual([...slugs].sort());
      if (vs.length > 1) multi.push(...vs);
    }
    // 2026-11-14: n-up (2 variants) and metadata (3). A floor, so a reader
    // gone blind cannot pass on nothing.
    expect(multi.length).toBeGreaterThanOrEqual(5);
    for (const v of multi) {
      expect(v.editors.length, v.slugs.join()).toBeGreaterThan(0);
      for (const e of v.editors) expect(v.modules).toContain(e);
      if (v.host) expect(v.modules).not.toContain(v.host);
      for (const w of multi)
        if (w !== v && w.kind === v.kind)
          expect(v.modules.filter((m) => w.modules.includes(m))).toEqual([]);
    }
    const booklet = variant(multi, "booklet-pdf");
    expect(booklet.modules).toEqual(
      expect.arrayContaining([BOOKLET_EDITOR, BOOKLET_ENGINE]),
    );
    expect(rel(booklet.host!)).toBe(
      "src/components/tools/runner/n-up/booklet-host.tsx",
    );
    expect(variant(multi, "n-up-pdf").modules).toContain(N_UP_EDITOR);
  });

  it("control: the shipped shape — a host arm and a lazy default", () => {
    const runner = fixture({
      "runner.tsx": `${HEAD}import { BookletHost } from "./host";
${N_UP_PANEL}
export function Runner() {
  const slug = useToolRun()?.slug;
  if (slug === "booklet-pdf") return <BookletHost />;
${DEFAULT_ARM}}
`,
      "host.tsx": LAZY_HOST,
    });
    const vs = readVariants("n-up", SLUGS, runner);
    const booklet = variant(vs, "booklet-pdf");
    expect(booklet.host).toBe(path.join(path.dirname(runner), "host.tsx"));
    expect(booklet.editors).toEqual([BOOKLET_EDITOR]);
    expect(booklet.modules).toEqual(
      expect.arrayContaining([BOOKLET_EDITOR, BOOKLET_ENGINE]),
    );
    expect(variant(vs, "n-up-pdf").editors).toEqual([N_UP_EDITOR]);
    expect(variant(vs, "n-up-pdf").host).toBeNull();
  });

  it("an inline arm drawing a STATICALLY imported editor is FATAL: the variant has no lazy editor", () => {
    const runner = fixture({
      "runner.tsx": `${HEAD}import { BookletEditor } from "@/components/tools/runner/n-up/booklet-editor";
${N_UP_PANEL}
export function Runner() {
  const slug = useToolRun()?.slug;
  if (slug === "booklet-pdf")
    return (
      <SinglePdfRunner hint="h" handoffSlug="booklet-pdf" toolName="t">
        {(pdf, reset) => <BookletEditor pdf={pdf} onReset={reset} />}
      </SinglePdfRunner>
    );
${DEFAULT_ARM}}
`,
    });
    expect(() => readVariants("n-up", SLUGS, runner)).toThrow(
      /draws booklet-pdf with no lazily loaded editor/,
    );
  });

  it("an inline arm that ALSO loads its editor lazily still owns the static editor — no host excuses it", () => {
    const runner = fixture({
      "runner.tsx": `${HEAD}import { BookletEditor } from "@/components/tools/runner/n-up/booklet-editor";
${N_UP_PANEL}
const booklet = lazyPanel(
  () => import("@/components/tools/runner/n-up/booklet-editor").then(({ BookletEditor }) => BookletEditor),
  "Opening…",
);
export function Runner() {
  const slug = useToolRun()?.slug;
  if (slug === "booklet-pdf")
    return (
      <SinglePdfRunner hint="h" handoffSlug="booklet-pdf" toolName="t" prepare={booklet.prepare}>
        {(pdf, reset) => <BookletEditor pdf={pdf} onReset={reset} />}
      </SinglePdfRunner>
    );
${DEFAULT_ARM}}
`,
    });
    const vs = readVariants("n-up", SLUGS, runner);
    const booklet = variant(vs, "booklet-pdf");
    // The OLD reader's host for this arm: single-pdf-runner.tsx. Here it is
    // shared, so it is nobody's, and the editor is Booklet's.
    expect(booklet.host).toBeNull();
    expect(booklet.modules).toContain(BOOKLET_EDITOR);
    expect(variant(vs, "n-up-pdf").modules).not.toContain(BOOKLET_EDITOR);
    expect(vs.flatMap((v) => v.modules).map(rel)).not.toContain(
      "src/components/tools/replace-boxes.tsx",
    );
  });

  it("a host that imports its editor statically does not excuse the editor", () => {
    const runner = fixture({
      "runner.tsx": `${HEAD}import { BookletHost } from "./host";
${N_UP_PANEL}
export function Runner() {
  const slug = useToolRun()?.slug;
  if (slug === "booklet-pdf") return <BookletHost />;
${DEFAULT_ARM}}
`,
      "host.tsx": LAZY_HOST.replace(
        `import { lazyPanel }`,
        `import { BookletEditor } from "@/components/tools/runner/n-up/booklet-editor";
export const STATIC_EDITOR = BookletEditor;
import { lazyPanel }`,
      ),
    });
    const booklet = variant(readVariants("n-up", SLUGS, runner), "booklet-pdf");
    expect(booklet.host).not.toBeNull();
    expect(booklet.modules).not.toContain(booklet.host);
    expect(booklet.modules).toContain(BOOKLET_EDITOR);
  });

  it("a helper component in the runner is read through: its static editor is the variant's", () => {
    const runner = fixture({
      "runner.tsx": `${HEAD}import { BookletEditor } from "@/components/tools/runner/n-up/booklet-editor";
${N_UP_PANEL}
const booklet = lazyPanel(
  () => import("@/components/tools/runner/n-up/booklet-editor").then(({ BookletEditor }) => BookletEditor),
  "Opening…",
);
function Booklet() {
  return (
    <SinglePdfRunner hint="h" handoffSlug="booklet-pdf" toolName="t" prepare={booklet.prepare}>
      {(pdf, reset) => <BookletEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}
export function Runner() {
  const slug = useToolRun()?.slug;
  if (slug === "booklet-pdf") return <Booklet />;
${DEFAULT_ARM}}
`,
    });
    const vs = readVariants("n-up", SLUGS, runner);
    expect(variant(vs, "booklet-pdf").host).toBeNull();
    expect(variant(vs, "booklet-pdf").modules).toContain(BOOKLET_EDITOR);
    expect(variant(vs, "n-up-pdf").modules).not.toContain(BOOKLET_EDITOR);
  });

  it.each([
    [
      "a top-level statement no variant owns",
      `${HEAD}import { BookletHost } from "./host";
${N_UP_PANEL}
void BookletHost;
export function Runner() {
  const slug = useToolRun()?.slug;
  if (slug === "booklet-pdf") return <BookletHost />;
${DEFAULT_ARM}}
`,
      /a top-level statement this reader cannot attribute/,
    ],
    [
      "a side-effect import",
      `${HEAD}import "./host";
import { BookletHost } from "./host";
${N_UP_PANEL}
export function Runner() {
  const slug = useToolRun()?.slug;
  if (slug === "booklet-pdf") return <BookletHost />;
${DEFAULT_ARM}}
`,
      /a side-effect import/,
    ],
    [
      "a statement between the slug's read and the last arm",
      `${HEAD}import { BookletHost } from "./host";
${N_UP_PANEL}
export function Runner() {
  const slug = useToolRun()?.slug;
  const Host = BookletHost;
  if (slug === "booklet-pdf") return <Host />;
${DEFAULT_ARM}}
`,
      /runs for every variant/,
    ],
    [
      "an arm with an else",
      `${HEAD}import { BookletHost } from "./host";
${N_UP_PANEL}
export function Runner() {
  const slug = useToolRun()?.slug;
  if (slug === "booklet-pdf") return <BookletHost />;
  else {
${DEFAULT_ARM}}
}
`,
      /an arm with an `else`/,
    ],
    [
      "a comparison that is not an arm",
      `${HEAD}import { BookletHost } from "./host";
${N_UP_PANEL}
export function Runner() {
  const slug = useToolRun()?.slug;
  return slug === "booklet-pdf" ? <BookletHost /> : null;
}
`,
      /a comparison with the page's slug this reader cannot follow/,
    ],
  ])("FATAL: %s", (_, text, message) => {
    const runner = fixture({ "runner.tsx": text, "host.tsx": LAZY_HOST });
    expect(() => readVariants("n-up", SLUGS, runner)).toThrow(message);
  });
});
