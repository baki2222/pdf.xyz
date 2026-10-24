"use client";

import Link from "next/link";
import { Info, Layers, Lock, ShieldCheck } from "lucide-react";
import { getToolBySlug } from "@/lib/tools";
import { editedOutputName } from "@/lib/pdf/edit";
import { PrivacyLine } from "./stamp-controls";
import { EditorRunner } from "./editor/editor-session";

/**
 * Edit PDF — the WYSIWYG editor (`./editor/`): every page drawn by pdf.js,
 * objects placed by clicking on the page, moved and resized by hand, and
 * written into the file where they were drawn (`@/lib/pdf/editor-export`).
 * Annotate PDF and Sign PDF mount the same editor (`./editor/editor-session`).
 *
 * HISTORY. Until 2026-10-24 this file was a FORM: X and Y typed in points
 * from the bottom-left, a blank 180 px box for a preview, nothing movable
 * after it was added, no undo. Its scope note said so — "no drag handles,
 * and no click-to-place canvas" — and that sentence, true of the form, would
 * have been false of this editor the day it shipped; the note below says
 * what the editor does now and, as before, what it does NOT (it still cannot
 * change the words already in the file).
 */
export function EditRunner() {
  return (
    <EditorRunner
      slug="edit-pdf"
      toolName="Edit PDF"
      hint="One PDF · edited locally in your browser"
      initialTool="select"
      resultTitle="Edited PDF ready"
      downloadLabel="Download edited PDF"
      outputName={editedOutputName}
      footer={<EditorFooter />}
    />
  );
}

/** What sits under the editor while it is open: what it does, and does not. */
function EditorFooter() {
  return (
    <div className="flex flex-col gap-5">
      <HonestScopeNote />
      <div className="grid gap-3 sm:grid-cols-3">
        <InfoTile
          icon={Layers}
          title="Edits the page itself"
          body="Retyped lines replace the old words in the page content. Text, pictures, signatures, shapes, highlights, drawings and notes are written in as real text, vector and image content — the page is kept, not turned into a picture."
        />
        <InfoTile
          icon={Lock}
          title="Flattened on export"
          body="What you add becomes part of the page, not a comment layer. Whiteout covers what is under it and the covered content stays in the file; Redact removes the text and picture pixels under its box."
        />
        <InfoTile
          icon={ShieldCheck}
          title="Local only"
          body="Pages are drawn and the file is written in your browser — your PDF and pictures are never uploaded."
        />
      </div>
      <PrivacyLine>
        Edits are applied on your device — your PDF never leaves the browser.
      </PrivacyLine>
    </div>
  );
}

/**
 * A link to the tool that does what this one cannot, named as the catalogue
 * names it — a typed "Redact" stayed plain text on the page for months, and a
 * reader told to go elsewhere was given no way to get there.
 */
function ToolLink({ slug }: { slug: string }) {
  const tool = getToolBySlug(slug);
  if (!tool) throw new Error(`edit-runner links unknown tool "${slug}"`);
  return (
    <Link href={`/tools/${tool.slug}`} className="font-semibold underline">
      {tool.name}
    </Link>
  );
}

/**
 * The load-bearing honesty of this tool: what Edit text can and cannot
 * change, and that Whiteout covers while Redact removes. Exported so
 * `tool-page-content.test.ts` can render it and read the links a reader
 * actually receives.
 *
 * HISTORY. Until 2026-10-24 (Phase 2) this note said the editor does "not"
 * change, move or delete the words already in the PDF — true then, false
 * once Edit text removed the original glyphs from the content stream
 * (`editor/content-edit.ts`).
 */
export function HonestScopeNote() {
  return (
    <div className="border-info/40 bg-info/10 text-info rounded-panel flex items-start gap-3 border px-4 py-3.5 text-sm">
      <Info className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="leading-relaxed">
        <span className="font-semibold">Edit text</span> retypes a line of the
        PDF&apos;s own text in place: the old words are removed from the file. A
        scanned page has no text to edit — run <ToolLink slug="ocr-pdf" /> first
        — and text inside some embedded objects is refused. To rework whole
        paragraphs, convert the file with <ToolLink slug="pdf-to-word" />.
        Whiteout only covers what is under it; Redact removes it.
      </p>
    </div>
  );
}

function InfoTile({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
}) {
  return (
    <div className="border-line bg-wash rounded-panel border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
