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

## Commands

- Install: `pnpm install`
- Dev: `pnpm dev`
- Build: `pnpm build`
- Lint: `pnpm lint`
- Test: `pnpm test` if configured
