# Screen reader pass — 10 minutes, once per release that touches a result surface

PR #42 made a finished run announce itself and take focus. Every assertion behind
it is a machine reading a DOM: `getByRole("group", { name })` computes an
accessible name with `dom-accessibility-api`, and `toHaveFocus()` compares
`document.activeElement`. Both can be exactly right while a real screen reader
says nothing useful — this codebase's own history is that a completed job is not
a correct one.

This is the part only a person can do. It is short on purpose.

---

## Setup

Pick one. Both are free and neither needs the other.

|             |                                                       |
| ----------- | ----------------------------------------------------- |
| **Windows** | NVDA (<https://www.nvaccess.org/download/>) + Firefox |
| **macOS**   | VoiceOver (`Cmd+F5`) + Safari                         |

Keys you need:

- **NVDA**: `Insert` is the NVDA key. `Insert+Down` reads from here. `Ctrl` stops speech.
- **VoiceOver**: `Ctrl+Option` is VO. `VO+A` reads from here. `Ctrl` stops speech.

Turn the screen off, or look away. The whole point is what you _hear_.

---

## 1. A finished run — the flow the product exists for

<https://pdf.xyz/tools/merge-pdf>

1. `Tab` to the file input. Add two PDFs.
2. `Tab` to **Merge 2 PDFs**. Press `Enter`. **Do not touch the mouse.**

**Must hear:** the outcome — something like _"PDFs merged, 2 files combined into
one PDF, 12 pages"_ — spoken without any further keypress.

**Then press `Tab` once.** Must land on **Download merged PDF**. Press `Enter`;
the file must download.

**Fails if:** silence after the run; you have to hunt for the result; `Tab`
takes you to "Skip to content" (that means focus went to the top of the page);
or the outcome is read twice.

---

## 2. A run you walk away from

Same page, same steps — but after pressing `Enter` on Merge, immediately `Tab`
somewhere else, e.g. into the site navigation.

**Must hear:** the outcome announced, and **focus must stay where you put it.**

**Fails if:** focus is yanked back to the result. Moving someone's focus while
they are doing something else is its own accessibility failure, not a fix.

---

## 3. The same tool twice

<https://pdf.xyz/tools/rotate-pdf> — run it, then **Start over**, then run it
again with identical settings.

**Must hear:** the outcome **both** times.

**Fails if:** the second run is silent. Assistive tech reacts to a live region
_changing_; writing the identical string twice is not a change, which is why the
region is cleared before each message. This is the check that proves that works.

---

## 4. A failure still speaks

<https://pdf.xyz/tools/merge-pdf> — add a single file, or a corrupt PDF, and run.

**Must hear:** the error, promptly and without hunting. This path already worked
before #42 (`ErrorNote` carries `role="alert"`); the test is that success has not
broken it.

---

## 5. Chat, which deliberately behaves differently

<https://pdf.xyz/tools/chat-with-pdf> — ask a question, and **start typing a
follow-up while the answer is still coming.**

**Must hear:** the answer read out **without** your typing being interrupted and
without focus leaving the text box.

**Fails if:** focus jumps to the answer. The transcript is a `role="log"`
precisely so a conversation is never interrupted mid-sentence.

---

## 6. Searching the tools, and an answer that says no

<https://pdf.xyz/tools> — `Tab` to **Search tools** and type `flip`, then pause.

**Must hear:** after the pause, once, the count — _"1 tool for “flip”"_ or
similar. Not letter by letter while you type, and nothing at all when the page
first loads. Arrow down through the page: the first heading after the field
must be **Best matches for “flip”**, and the first tool under it **Rotate
PDF**.

Then clear the field and type `heic`.

**Must hear:** _"No tool here opens HEIC photos. …"_ at the start of the
announcement, and a heading with those words above a **JPG to PDF** link.

Then open <https://pdf.xyz/tools?accepts=docx>, type `merge` in the search
field and pause.

**Must hear:** _"No tools for “merge” take DOCX. The filter hides 1 match"_ —
the filter named, never a bare _"No tools match “merge”"_, because Merge PDF
does match. The heading above **Show the match** says the same.

Clear the field. `Tab` to the button **Takes DOCX, remove this filter** and
press `Enter`.

**Must hear:** the grid's new count. **Focus must land in the search field**,
not at the top of the page — the button you pressed is gone.

**Fails if:** the count is read while you are still typing; a "Closest matches"
list is announced as if it matched every word; the HEIC answer is not read; an
empty list blames the query when a filter emptied it; or removing the filter
drops focus to the document.

Reload <https://pdf.xyz/tools>. `Tab` past the search field to the **Where it
runs** group.

**Must hear:** the group's name, _"Where it runs"_, and the checked choice —
_"All, radio button, checked, 1 of 5"_. Press the right arrow once.

**Must hear:** _"Never uploads 29, radio button, checked, 2 of 5"_ (the number
is however many tools never upload today), then after the pause, once: _"29
tools always keep your files on your device"_. Arrow down into the grid to the
first card.

(It said _"29 tools work without uploading"_ until 2026-10-10: true of 30 tools,
because Compress PDF works without uploading too and only its optional worker
step uploads. With **Never uploads** still chosen, type `compress` and pause.
**Must hear:** _"No tools for “compress” always keep your files on your device.
The filter hides 2 matches"_ — never that no tool for "compress" works without
uploading, which denied Compress PDF what it does.)

**Must hear:** the tool's name, its description, _"Takes PDF; makes PDF."_ and
where it runs — the formats said as a sentence, never _"right arrow"_.

**Fails if:** the group has no name; the arrow keys move focus without changing
the choice (these must be radios, not buttons); the count is read before the
pause; a mode's shape (● ◐ ○ ◆) is read aloud; or a card reads _"PDF right
arrow PDF"_.

---

## 7. Suggestions for staged files, and files that arrive

<https://pdf.xyz/workspace> — add two PDFs with **Add files**, then wait a
moment without moving.

**Must hear:** once, after a short pause, _"3 suggestions for your files. Best
match: Merge PDF."_ Not before the files are listed, and not again when the
pages are counted.

Arrow to the list under **Suggested for your files**.

**Must hear:** the first link as _"Open Merge PDF with 2 files"_, then its
description: **2 PDFs**, the page count, and where it runs (**In-browser**).
Press `Enter` on it.

**Must hear:** Merge PDF's page, and near the top _"Loaded 2 files from your
workspace. Still in this browser; nothing was uploaded."_

Back in the workspace, clear the files and add a scanned PDF (pages that are
pictures). Find **OCR PDF** in the list.

**Must hear:** _"Open OCR PDF — you'll add the file there"_, then _"No
selectable text on page 1"_ and _"uploads only when you start it"_.

Then go to <https://pdf.xyz>, add two PDFs on the desk and press **Open in
workspace** on the ticket.

**Must hear:** the workspace, and _"Loaded 2 files you added. Still in this
browser; nothing was uploaded."_ — never _"from your workspace"_ for files that
came from the home page.

**Fails if:** the suggestion count is read more than once for the same files;
a link's name does not say what it carries; a worker tool's link implies the
file goes with it; or files from the home page are said to come from the
workspace.

---

## 8. The home desk, and the job ticket

<https://pdf.xyz> — `Tab` from the top of the page.

**Must hear:** after the header and the headline, _"Choose files, button"_ (or
_"file upload"_), described by what it takes: _"PDF up to 100 MB · Word,
Excel, PowerPoint up to 50 MB…"_. Keep tabbing.

**Must hear:** **Try a sample PDF**, then the six tasks as links, each saying
where its tool runs — _"Make a PDF smaller, Hybrid"_, _"Make a scan
searchable, Secure worker"_ (on a phone the word is read even though only its
shape is drawn).

Go back to **Choose files**, press `Space`, pick two PDFs.

**Must hear:** focus land on the ticket — _"What you can do with these files,
region"_ — and then, once, after the pages are counted, _"Checked 2 files. 3
suggestions. Best match: Merge PDF."_ Not before the files are listed, and not
again when nothing has changed.

Arrow through the ticket.

**Must hear:** the files' line (_"2 PDFs · 15 pages · …"_), each file with its
size and pages, then the first suggestion as _"Open Merge PDF with 2 files"_
and its description (_"2 PDFs · 15 pages · In-browser"_). A worker tool in
**More for these files** says _"you'll add the file there"_ and _"uploads only
when you start it"_. Press **Clear**.

**Must hear:** focus back on **Choose files**. The empty desk was never read
twice: while the ticket is up, the desk under it is not announced at all.

Press **Try a sample PDF**.

**Must hear:** the ticket, with **pdfxyz-sample.pdf** marked _"pdf.xyz's
sample"_ and **Fill Forms** first, because _"pdfxyz-sample.pdf has 2 form
fields"_.

Finally, drag a PDF from your file manager onto the page and drop it outside
the desk (on the headline, say).

**Must hear:** the same _"Checked 1 file…"_ announcement, and focus NOT moved —
a drop announces; only a pick moves focus.

**Fails if:** the desk's picker has no name or no description; a task link does
not say where its tool runs; the ticket is announced twice for one set of
files; the empty desk is read while the ticket covers it; a drop moves focus;
or the browser opens the dropped PDF in the tab.

---

## Recording the result

Note the browser, screen reader, and version, and for each of the eight: heard /
not heard / heard but wrong. A partial pass is a finding, not a failure — write
down what was actually said, because the wording is the deliverable.

If something fails, the relevant code is `useOutcomeFocus` and `ResultCard` in
`src/components/tools/runner/runner-kit.tsx`, and `LiveRegion` in
`src/components/a11y/live-region.tsx` — for check 6, `ToolsExplorer` and its
`resultAnnouncement` in `src/components/tools/tools-explorer.tsx`, and
`FormatsLine` in `src/components/tools/formats-line.tsx`; for check 7,
`FileSuggestions` in `src/app/workspace/file-suggestions.tsx` and
`HandoffLoadedBadge` in `src/components/tools/runner/handoff-notice.tsx`; for check
8, `HeroDesk` in `src/components/intent/hero-desk.tsx`, `TicketView` in
`src/components/intent/ticket-view.tsx` and `DropSheet` in
`src/components/upload/drop-sheet.tsx`. Each carries
a docblock explaining what it is protecting against, which is usually faster
than reading the logic.

---

## What this pass does not cover

Colour contrast (measured in a real browser by `pnpm a11y:contrast`, in both
colour schemes), the sticky header covering keyboard-focused controls, and forms
beyond the run button. Those are visual and structural, and are better found with an
automated audit than with your ears.
