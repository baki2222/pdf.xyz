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

## Commands

- Install: `pnpm install`
- Dev: `pnpm dev`
- Build: `pnpm build`
- Lint: `pnpm lint`
- Test: `pnpm test` if configured
