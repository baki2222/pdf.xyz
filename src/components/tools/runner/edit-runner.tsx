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
          title="Adds to the page"
          body="Text, pictures, signatures, shapes, highlights, drawings and notes are written into the page as real text, vector and image content — the page itself is kept, not turned into a picture."
        />
        <InfoTile
          icon={Lock}
          title="Flattened on export"
          body="What you add becomes part of the page, not a comment layer. Whiteout covers what is under it; the covered content stays in the file — use Redact PDF when it must be removed."
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
 * The load-bearing honesty of this tool: new content, placed by hand — not
 * editing of the text already there. Exported so `tool-page-content.test.ts`
 * can render it and read the links a reader actually receives.
 */
export function HonestScopeNote() {
  return (
    <div className="border-info/40 bg-info/10 text-info rounded-panel flex items-start gap-3 border px-4 py-3.5 text-sm">
      <Info className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="leading-relaxed">
        <span className="font-semibold">This adds new content.</span> Click on a
        page to place text, pictures, signatures, shapes, highlights, drawings
        and notes, then move and resize them. It does{" "}
        <span className="font-semibold">not</span> change, move or delete the
        words and pictures already in your PDF. To rework the existing text,
        convert the file with <ToolLink slug="pdf-to-word" />. Whiteout covers
        content but doesn&apos;t remove it — use <ToolLink slug="redact-pdf" />{" "}
        to delete data.
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
