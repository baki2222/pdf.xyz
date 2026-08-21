# pdf.xyz — Project Context

## Roles

- Hermes is acting as CEO/Product Manager/Engineering Manager.
- Claude Code is the primary developer and implementation agent.
- Build production-grade, world-class software. Do not make toy demos.

## Product Mission

Build `pdf.xyz`: a modern, fast, beautiful, privacy-first PDF platform that combines and improves on pdf.net, PDF24, and iLovePDF.

## Competitive Baseline

- pdf.net: modern online PDF editor positioning; strong upload-first flow; editing, signing, annotation, sharing, signature requests, conversion, AI tools.
- PDF24: broad free utility coverage; merge, split, compress, edit, sign, convert, images, extract, protect/unlock, rotate/remove/extract/rearrange pages, webpage to PDF, OCR, watermark, page numbers, overlay, compare, optimize, redact, create PDF.
- iLovePDF: very polished tool-grid UX and category filtering; merge/split/compress/convert/edit/security/OCR/compare/redact/crop/forms/AI summarizer/translate.

## Product Direction

- Start with a production-grade web app foundation and an excellent UX.
- Prioritize a complete tool catalog, upload/workspace flow, tool pages, client-side processing where feasible, and robust server API boundaries for future heavy PDF tasks.
- Keep design premium, fast, trustworthy, and conversion-oriented.

## Technical Expectations

- Prefer Next.js App Router + TypeScript + Tailwind CSS for a high-quality SaaS frontend.
- Include tests, linting, strict TypeScript, accessible components, SEO metadata, and a clean architecture.
- Use modular feature definitions so adding real PDF engines/API workers later is straightforward.
- Never commit secrets. Do not read or expose `.env` values.

## Guards — house style

This product's most-repeated defect is a claim that was true when written and went
stale underneath. The guards that catch those claims have their own failure modes,
and these two rules are the ones that have been paid for.

**1. A ban list needs a corpus, in both directions.** Every sentence the product
has shipped must be caught by some pattern, **and every pattern must catch some
shipped sentence**. A pattern nothing exercises is decoration; an example nothing
catches is a hole. Without the first half, a synonym walks straight past — a list
banning `you've used your` was cleared by shipping `you have used your`. Without
the second, patterns accumulate that do not match what their names claim.

Written this way the corpus catches the guard's author too: the rewrite that
replaced those phrases with shapes failed its own corpus on the first run, on
`"You may have already used them."`

**2. A guard's exit condition must name the PROPERTY, not the MECHANISM.** The
mechanism arrives first and looks like permission. A copy guard was allowed to
retire "the moment identity keys on a real per-client address"; that happened, the
ban lifted, and the replacement copy was false in a new way — because the property
was _"the moment the counter can identify a person"_, and an address is not a
person. **A guard that can license a defect is worse than no guard**, since the
defect ships with a written argument for why it was safe.

Corollaries in the same family, each from a real miss:

- Pin **relationships**, not strings. Prefer a check that DISCOVERS its subjects
  (walk the tree, scan for the definition) over one that names files: a named list
  cannot see a file it does not name.
- Give every predicate a **health check** and a **positive control**. `[] ⊆ X` is
  vacuously true, so a blind predicate reports the strongest possible pass.
- Verify the **composed chain**, not the units. Two boundaries can each pass their
  own tests while the path through them drops everything.
- A **comment is not a guard**. A docblock asserting an invariant nothing tests is
  the defect this file exists to prevent, in the one place no test can fail.
- Tests that pinned a defect get **inverted, not deleted**, with the history kept
  in the file.

**3. Failure paths get the minimal type, and money is spent on the way to both.**
Success shapes accumulate rich metadata; failure shapes stay lean, because they
are written while thinking about _what went wrong_ and never about _what it
cost_. So the omission is invisible at authoring time and unidirectional toward
free at runtime. One feature hit it at **three** layers in a row — the provider's
failure shape, four engines' failure arms, and `ProcessorResult` — each dropping
the token counts of `incomplete_output`, the outcome that is non-retryable
_precisely because_ it burned the maximum budget.

Two tells, both cheap to check:

- **The capability exists everywhere except where it costs money.** Grep the file
  for the concept: 10, 10, 10 and 19 mentions across four engines, and zero on
  the failure branch. A count that high is not an oversight, it is a shape.
- **Structural defences cannot see a wrong number.** Every rule above binds
  statements to each other — one definition spread N ways, a hook above the fork,
  `[] ⊆ X` health checks. **A constant has no relationships to constrain**, and
  neither does an env var or a deployment topology. The same feature was made
  decorative three times that way: a token figure nothing could check, a price
  nobody had recorded, and a spend hook running in a process with no limiter.
  Only a **second, independent bound** sees them — our ceiling against the
  provider's dollar cap, our price against the published rate card — so write
  that comparison as a test rather than as a paragraph.
- **When the type is fine, the ORDER does the same work.** `usageFrom(body)` was
  correct, tested, and ran on every successful call — it simply sat _below_ the
  branch that needed it. A statement can be right and still be in the wrong
  place, and no test of that statement can tell you; only a test of the branch
  that needed it can. Reviewers ask _is this correct_, never _is this early
  enough_, and a diff shows neither.

**4. A right command over the wrong set is the most convincing way to be wrong.**
Rules 1–3 all assume the question was asked of the right things. Seven times in
one day it was not — and **not once was the command wrong**. Every one returned a
correct, confident answer to a question nobody meant to ask:

| the set that was searched               | what it silently excluded                           |
| --------------------------------------- | --------------------------------------------------- |
| a checked-out tree 86 commits stale     | every claim made since                              |
| `grep -c` piped through `head -1`       | every file but the first                            |
| a count of the WORD                     | every other spelling of the shape                   |
| `git grep -- src`                       | the worker's entry point, in `scripts/`             |
| a guard naming 2 of 16 `worker:*` files | the fourteen it did not name                        |
| an import walk following `import type`  | nothing — it ADDED edges that are erased at runtime |
| a module graph read as a call graph     | nothing — it ADDED functions nobody calls           |

**A corpus has no relationships to constrain**, exactly like the constant in
rule 3. Every structural defence here binds statements to each other — one
definition spread N ways, a hook above the fork, `[] ⊆ X` — and all of them run
happily over a set that is missing half the world. The predicate can be perfect
and the answer still false.

Three things follow, each bought:

- **Derive the set from something that must already be true.** Never type it.
  The worker's entry point is not `/worker-daemon/`; it is
  `Dockerfile CMD → package.json script → file` — three artifacts a deployment
  already depends on, so renaming the file or repointing the script moves the
  guard with it. Prefer the import graph over a directory, the route-handler
  convention over a list of routes, the manifest over a filename.
- **Bound the corpus's own size, and make a broken link FATAL.** `[] ⊆ X` is
  vacuously true, so a corpus that quietly shrinks reports the strongest
  possible pass. The mirror is worse-tempered and just as useless: a BFS bug
  collapsed one call graph to _two_ entries, and every assertion would then have
  failed **for the wrong reason** — and a red guard nobody can explain gets
  deleted. Neither direction was visible to any assertion; only
  `"the graph is implausibly small"` saw both.
- **Widening the set is a defect too.** Five of the seven above lost members;
  two GAINED them. Following an `import type` edge, or counting a function that
  is loaded but never called, are not oversights — they are the set quietly
  answering an easier question. **Loading a module is not running a function**,
  and a guard that conflates them proves reachability while selling execution.

**5. Every guard above verifies the AUTHOR'S artifact. The defects that
survive are found at the POINT OF CONSUMPTION.**

Rules 1–4 are about making a check honest. This one is about where the check
stands. On 2026-08-21 the expensive instruments — derived corpora, mutation
controls, AST walks, a call-graph reachability guard — all earned their place,
and all of them certified as fine two features that were **not** fine:

| certified green by every structural guard | what the reader actually got                |
| ----------------------------------------- | ------------------------------------------- |
| the FAQ describing chunked translation    | a worker nine days old that refused the job |
| a build fingerprint computed in 65 ms     | a publisher that discarded it, silently     |

Both were caught by exactly two instruments, neither of them clever: **reading
the wire** (the heartbeat as published, not as serialised) and **running a real
job** (a 12-page document through production, not 500 generated plans).

The developer's formulation, and it is the sharpest sentence this programme has
produced:

> A correct value, computed cheaply, with a good reason for every choice, that
> reaches nobody, is worth exactly as much as no value at all.
> **I checked the thing I had built, not the thing a reader receives.**

That names _which_ adjacent thing the easy measurement always is. It is not
random adjacency — it is **the author's own artifact instead of the consumer's**,
every time. `writeSpendProbe` (written, never read), `ready:true` (wired, never
run), a FAQ true of `main` and false of the running image, a fingerprint correct
at computation and absent at the wire.

- **Merging is not shipping** for anything the worker does. The web tier
  auto-deploys; the worker image is built by hand. Verify at the tier that
  serves the claim, and remember it may not be the tier that ships the code.
- **A DERIVED corpus can still be the WRONG corpus.** Deriving a key set from a
  value rather than typing it is necessary and not sufficient — ask _which_
  value. A heartbeat guard derived its keys from the capabilities sub-object and
  so never asked about a single top-level field: `fingerprint` appears **zero**
  times in it, so a dropped top-level field was invisible at _every_ hop, not
  merely at uncovered ones. Rule 4 nested inside a rule-3-style guard, and the
  derivation is what made it feel safe. TypeScript could not help either —
  excess-property checking does not fire on conditional spreads, which is the
  idiom used for every optional field.
- **The mutation needs its own health check.** Four times in one day a
  neutering landed on the wrong line, the wrong file, or died on its own
  `ReferenceError`. The symptom is _a green that should have been red_, and
  from outside, "the guard is thin" and "my mutation never landed" are
  indistinguishable. Grep the mutated line back before trusting the result.
- **Find the test by its assertion string**, not by where you assume it lives.

## Commands

- Install: `pnpm install`
- Dev: `pnpm dev`
- Build: `pnpm build`
- Lint: `pnpm lint`
- Test: `pnpm test` if configured
