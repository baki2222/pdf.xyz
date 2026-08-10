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

## Recording the result

Note the browser, screen reader, and version, and for each of the five: heard /
not heard / heard but wrong. A partial pass is a finding, not a failure — write
down what was actually said, because the wording is the deliverable.

If something fails, the relevant code is `useOutcomeFocus` and `ResultCard` in
`src/components/tools/runner/runner-kit.tsx`, and `LiveRegion` in
`src/components/a11y/live-region.tsx`. Each carries a docblock explaining what it
is protecting against, which is usually faster than reading the logic.

---

## What this pass does not cover

Colour contrast (`text-slate-500` fails AA in 209 places — a known, separate
gap), the sticky header covering keyboard-focused controls, and forms beyond the
run button. Those are visual and structural, and are better found with an
automated audit than with your ears.
