import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STICKY_LABEL, STICKY_STAYS_COMMENT } from "@/lib/pdf/editor/sticky";
import { getToolBySlug } from "@/lib/tools";
import {
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "@/lib/tools/page-copy";
import { toolFacts } from "@/lib/tools/tool-facts";
import {
  flattenForPhraseSearch,
  withoutComments,
} from "@/lib/tools/copy-surface";

/**
 * Wherever a page says flattening draws notes or markups into the page, it
 * names the exception: a Comment (sticky note) is always written as a PDF
 * comment, even in flatten mode, because a popup cannot be drawn into a
 * page (`editor-export.ts`, `savedAsComment`).
 *
 * WHAT SHIPPED (review of 62aa1808, 2026-11-08). The Comment tool joined
 * the shared editor's Mark up group — on Annotate PDF, Edit PDF and Sign
 * PDF alike — and only Annotate PDF's intro was told. Annotate's derived
 * FAQ still answered "Not by default. Flatten into the page … draws … notes
 * into the page itself", its footer said "Flattened, the default,
 * highlights, drawings, notes and shapes are drawn as page content", and
 * Edit PDF's intro said "Your additions are written into the page content
 * itself, except … notes … when you choose Save markups as comments". Each
 * was true the day before.
 *
 * The surfaces are DISCOVERED: every runner that mounts the editor
 * (`<EditorRunner slug=…>`), each page's served copy (intro, use cases,
 * steps, FAQ, facts) and the paragraphs of the runner and editor sources.
 */

const RUNNER_DIR = path.join(process.cwd(), "src/components/tools/runner");

/** The tools whose runner mounts the shared editor, read off the runners. */
const editorRunners = readdirSync(RUNNER_DIR)
  .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
  .map((f) => ({
    file: f,
    source: readFileSync(path.join(RUNNER_DIR, f), "utf8"),
  }))
  .filter((r) => /<EditorRunner\b/.test(r.source))
  .map((r) => ({
    ...r,
    slug: /<EditorRunner\b[\s\S]*?\bslug="([^"]+)"/.exec(r.source)?.[1],
  }));

/**
 * The words of each JSX paragraph in a source file, with the sticky
 * constants a paragraph renders put back as the words a reader sees.
 */
function paragraphs(source: string): string[] {
  const flat = flattenForPhraseSearch(withoutComments(source));
  return [...flat.matchAll(/<p\b[^>]*>(.*?)<\/p>/g)].map((m) =>
    m[1]!
      .replace(/\{STICKY_STAYS_COMMENT\}/g, STICKY_STAYS_COMMENT)
      .replace(/\{STICKY_LABEL\}/g, STICKY_LABEL)
      .replace(/\{"\s*"\}/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

interface Unit {
  where: string;
  text: string;
}

function units(): Unit[] {
  const out: Unit[] = [];
  for (const r of editorRunners) {
    const tool = r.slug ? getToolBySlug(r.slug) : undefined;
    if (!tool) continue;
    pageIntro(tool).forEach((text, i) =>
      out.push({ where: `${tool.slug} intro[${i}]`, text }),
    );
    for (const u of pageUseCases(tool))
      out.push({ where: `${tool.slug} use case "${u.title}"`, text: u.body });
    for (const s of pageSteps(tool))
      out.push({ where: `${tool.slug} step`, text: stepText(s) });
    for (const f of pageFaq(tool))
      out.push({ where: `${tool.slug} FAQ "${f.question}"`, text: f.answer });
    for (const f of toolFacts(tool.slug))
      out.push({ where: `${tool.slug} fact ${f.label}`, text: f.value });
    for (const p of paragraphs(r.source))
      out.push({ where: `${r.file} paragraph`, text: p });
  }
  const session = readFileSync(
    path.join(RUNNER_DIR, "editor/editor-session.tsx"),
    "utf8",
  );
  for (const p of paragraphs(session))
    out.push({ where: "editor-session.tsx paragraph", text: p });
  return out;
}

/**
 * Says flattening (or the default) draws notes or markups into the page.
 * A sentence about the restricted case ("always saved as comments, never
 * flattened") does not: there every markup, a Comment among them, is a
 * comment.
 */
export function saysNotesAreDrawn(text: string): boolean {
  // "marks" the noun ("the marks are part of the page"), not the verb ("a
  // click marks a single word", Edit PDF's strikethrough answer).
  // The control's label, "Save markups as comments", names no markup
  // being drawn (Edit PDF's strikethrough answer quotes it).
  const aboutNotes = /\bnotes?\b|\bmarkups?\b|\bthe marks\b/i.test(
    text.replace(/Save markups as comments/gi, ""),
  );
  const drawn =
    /\b(draws?|drawn|written|writes)\b[^.]*\b(into the page|in the page|page content|the page itself|part of the page)\b/i.test(
      text,
    ) || /\bflattened\b[^.]*\bpart of the page\b/i.test(text);
  return aboutNotes && drawn;
}

/** Names the exception: a Comment is always saved as a comment. */
export function namesStickyException(text: string): boolean {
  return new RegExp(
    `\\b${STICKY_LABEL}\\b[^.]*\\balways\\b[^.]*\\bcomment`,
    "i",
  ).test(text);
}

describe("flattening copy names the Comment exception", () => {
  const all = units();
  const claims = all.filter((u) => saysNotesAreDrawn(u.text));

  it("health: the editor's runners and their claims were found", () => {
    // Annotate PDF, Edit PDF and Sign PDF mount the editor today.
    expect(editorRunners.map((r) => r.slug).sort()).toEqual(
      expect.arrayContaining(["annotate-pdf", "edit-pdf", "sign-pdf"]),
    );
    for (const r of editorRunners)
      expect(getToolBySlug(r.slug ?? ""), r.file).toBeDefined();
    // Hundreds of units; a handful means the walk broke.
    expect(all.length).toBeGreaterThan(40);
    // At least the three surfaces the review named make the claim.
    expect(claims.length).toBeGreaterThanOrEqual(3);
  });

  it("every sentence saying notes or markups are drawn into the page names the Comment exception", () => {
    expect(
      claims
        .filter((u) => !namesStickyException(u.text))
        .map((u) => `${u.where}: ${u.text}`),
    ).toEqual([]);
  });

  it("CONTROL: the shipped sentences are claims, and none named the exception", () => {
    const shipped = [
      // Annotate PDF's derived FAQ, until 2026-11-08.
      "Not by default. Flatten into the page, the default beside Apply & download, draws Annotate PDF's highlights, freehand drawing and notes into the page itself, so a reader shows them as part of the page, not as comments.",
      // AnnotateFooter, until 2026-11-08.
      "Choose beside Apply & download. Flattened, the default, highlights, drawings, notes and shapes are drawn as page content where you place them.",
      // Edit PDF's intro, until 2026-11-08.
      "Your additions are written into the page content itself, except links and form fields, which are saved as real links and fillable fields, and highlights, drawings, notes, shapes and lines when you choose Save markups as comments beside Apply & download.",
    ];
    for (const s of shipped) {
      expect(saysNotesAreDrawn(s), s).toBe(true);
      expect(namesStickyException(s), s).toBe(false);
    }
    // Not a claim: the restricted case, where everything is a comment.
    expect(
      saysNotesAreDrawn(
        "If the author allows comments, highlights, drawings, notes, shapes and lines are always saved as comments, never flattened.",
      ),
    ).toBe(false);
    // And the exception, written as Annotate's intro writes it, is seen.
    expect(
      namesStickyException(
        `A ${STICKY_LABEL} is the reverse: it is always saved as a PDF comment, even when you flatten the rest.`,
      ),
    ).toBe(true);
  });
});
