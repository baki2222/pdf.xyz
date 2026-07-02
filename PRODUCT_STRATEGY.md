# pdf.xyz — Product Strategy

> Owner: Product (Claude Code) · Sponsor: Hermes (CEO / PM / EM)
> Status: Living document · Last revised: 2026-07-02
>
> All market sizes, prices, and timelines in this document are **illustrative
> planning estimates**, not audited figures. Competitor characterizations are
> directional, based on public positioning, not formal benchmarks.

---

## 1. Executive Summary

pdf.xyz is a modern, fast, privacy-first PDF platform that unifies the entire
document toolchain — organize, convert, edit, sign, secure, optimize, and
AI — into one calm, premium surface. The category is large, universally needed,
and served today by tools that are opaque about where your files go, cluttered
with dark patterns, and slow because they upload everything to a server before
doing anything.

Our wedge is **architecture, not marketing**: of our 50 tools, 26 run entirely
in the user's browser and never transmit a byte. We do not merely *promise*
privacy in a policy; we deliver it structurally, per tool, and we label it
honestly in the UI. That earns trust in a low-trust category, gives us an
inherent speed advantage (no upload/download round trip), and creates an SEO and
Core Web Vitals edge that server-first incumbents cannot easily match. On top of
that trusted base we layer document intelligence (chat, summarize, translate,
extract) and, later, a developer API — turning a beloved free utility into a
durable platform.

---

## 2. Vision & Mission

**Vision.** The default place the world does anything with a PDF — because it is
the fastest, the most trustworthy, and the most complete.

**Mission.** Give everyone professional-grade document tools that respect their
privacy by design, tell the truth about how they work, and never get in the way.

**Tagline (shipping).** *Every PDF tool. Private by design.*

**North star.** Weekly successfully-completed document tasks — real jobs finished,
on any device, without friction, upsell, or doubt about where the file went. Every
principle and roadmap item below ladders up to that number.

---

## 3. The Problem

PDFs are the universal business file format, yet the tools for handling them are
some of the worst-behaved software people touch regularly.

- **Forced uploads for trivial work.** Rotating a page or merging two files
  requires uploading sensitive documents to a stranger's server — a privacy
  exposure and a speed tax for operations a browser can do locally.
- **Opacity.** Incumbents rarely say, per tool, whether a file leaves the device,
  how long it is retained, or whether AI features train on your content. Users
  are asked to trust a blanket policy, not a clear per-action statement.
- **Dark patterns.** Fake progress bars, artificial delays that nudge toward a
  paid tier, hidden task/day caps, watermarked "free" output, and checkout flows
  that bury the real price. The category trained users to expect to be tricked.
- **Speed.** The upload → queue → process → download loop makes simple tasks feel
  heavy — most of it unnecessary for the operations users run most.
- **Fragmented UX.** Tools are one-shot and stateless: finish a task, lose the
  file, re-upload to the next tool. There is no workspace where a document flows
  through several operations.
- **Cost and lock-in at the top.** Adobe Acrobat is powerful but expensive,
  heavy, and account-bound — overkill for the quick, occasional tasks that are
  most of the demand.

Concretely: **pdf.net** is a polished, upload-first editor; **PDF24** offers
enormous free breadth but a utilitarian, ad-supported experience; **iLovePDF**
has an excellent tool grid but a freemium model with task limits and server-first
processing; **Adobe** is the professional standard at professional prices and
weight. None leads with verifiable, per-tool, on-device privacy.

---

## 4. Market & Opportunity

*(All figures illustrative; third-party estimates vary widely and are not
reproduced here as fact.)*

PDF-related workflows sit at the intersection of several large software markets —
document productivity, file conversion, e-signature, and, increasingly, document
AI / intelligent document processing. Collectively these are commonly estimated
in the **tens of billions of dollars of annual spend**, growing steadily, with a
very long tail of free/consumer usage that funnels into paid business use.

**Segments (directional):**

- **Consumer / prosumer free utility** — enormous, high-intent search volume for
  head terms ("merge pdf", "pdf to word", "compress pdf"); our stance is funnel to
  Pro, not ads.
- **SMB / team** — recurring document ops, forms, signatures, batch conversion;
  willing to pay modest per-seat subscriptions for reliability.
- **Regulated / high-sensitivity** — legal, healthcare, finance, HR, where privacy
  is a purchasing requirement and willingness to pay for provable non-transmission
  and audit trails is highest.
- **Developers / platforms** — teams needing PDF operations inside their own
  products via API; usage-based, high-margin, high-retention.

**Why now.**

- **Browser compute matured.** WebAssembly (SIMD, threads), the File System
  Access API, OPFS, Web Workers, and WebGPU make real PDF rendering, editing, and
  conversion feasible on-device — work that required a server a few years ago.
- **AI made documents legible.** Modern models make chat, summarization,
  translation, and structured extraction genuinely useful and affordable — a
  value layer above commodity conversion.
- **Privacy became a buying criterion.** GDPR/CCPA, sector rules (HIPAA,
  attorney-client privilege), and rising breach costs make "your file never
  leaves your device" a differentiated, verifiable proposition — not a nicety.
- **Distribution favors speed.** Search ranking and conversion both reward Core
  Web Vitals; a local-first app is structurally faster than an upload-first one.

The opportunity: be the **trusted, fast, complete default** — capturing free
top-of-funnel at scale and converting the segments that pay for compute, AI, and
collaboration.

---

## 5. Target Users & Jobs-to-be-Done

| Persona | Who they are | Primary jobs-to-be-done | Tools they reach for first |
|---|---|---|---|
| **Quick-task professional** | Knowledge worker fixing a document between meetings | "When I need to fix a PDF *right now*, let me finish without signing up, paying, or wondering where my file went." | Merge PDF, Split PDF, Compress PDF, PDF to Word, Sign PDF, Rotate PDF |
| **SMB operations lead** | Runs document workflows for a small business | "When I process invoices, contracts, and forms in volume, make it reliable and affordable without an enterprise contract." | Excel to PDF, PDF to Excel, Fill & Sign Forms, Create Fillable Forms, Request Signatures, AI Data Extraction |
| **Legal / compliance professional** | Handles sensitive, privileged, regulated documents | "When I redact, compare, and sign sensitive files, prove they never left my control and give me an audit trail." | Redact PDF, Compare PDF, Protect PDF, PDF to PDF/A, Flatten PDF, Request Signatures |
| **Student / researcher** | Reads dense material under time pressure | "When I'm buried in long documents, help me understand and extract what matters, cheaply." | Chat with PDF, Summarize PDF, Translate PDF, OCR PDF, PDF to Markdown, PDF to Text |
| **Developer / builder** *(Phase 5)* | Needs PDF operations inside their own product | "Give me a clean, honestly-documented API for PDF operations I can trust in production." | API access to conversion, compression, OCR, extraction, signing |

The through-line across every persona: **finish the job, fast, without a trust
tax.** Privacy-sensitive users are not a niche segment we bolt on — they are the
sharpest expression of what every user quietly wants.

---

## 6. Positioning & Differentiation

**One-liner.** *Every PDF tool. Private by design.*

**Positioning statement.** For anyone who works with PDFs, pdf.xyz is the
complete document toolkit that runs on your device by default — as fast as your
computer, as private as your desktop, and as intelligent as modern AI — without
the uploads, upsells, and dark patterns of the incumbents.

**Competitive matrix** *(directional; not audited benchmarks):*

| Axis | **pdf.xyz** | pdf.net | PDF24 | iLovePDF | Adobe Acrobat |
|---|---|---|---|---|---|
| **Privacy (does the file leave the device?)** | 26 of 50 tools never leave the browser; the rest run on encrypted, auto-deleting workers, labeled per tool | Upload-first | Upload-first (optional desktop app) | Upload-first | Cloud + desktop, account-bound |
| **Speed** | Instant for in-browser tools — no round trip | Server round trip | Varies | Server round trip | Heavy desktop / cloud |
| **Price** | Generous free forever; pay for compute, AI, collaboration | Freemium / subscription | Free, ad-supported | Freemium with task limits | Premium subscription |
| **Tool breadth** | 50 tools across 8 categories | Editor-centric plus tools | Very broad | Broad, polished | Very broad, pro-grade |
| **AI depth** | Chat, summarize, translate, extract — cited, never trained on user data | Some AI | Limited | Summarize / translate | Acrobat AI Assistant |
| **UX / design** | Premium, calm, fast, consistent | Modern | Utilitarian | Very polished grid | Powerful but heavy |
| **Transparency** | Per-tool processing labels in the UI | Opaque | Opaque | Opaque | Opaque |
| **Developer / API** | First-class API on the roadmap (Phase 5) | Limited | Limited | Enterprise API | Enterprise API |

Where others differentiate on breadth (PDF24), polish (iLovePDF), editing
(pdf.net), or power (Adobe), **pdf.xyz differentiates on trust you can verify and
speed you can feel** — with breadth, polish, and intelligence as table stakes we
also meet.

---

## 7. The Moat

Each layer is individually useful and collectively compounding. The point is that
they are hard to copy *together* without contradicting the copier's own model.

1. **Privacy by architecture.** Running 26 of 50 tools fully client-side is a
   structural property, not a setting — and *verifiable*, since a user can watch
   the network tab and see no upload. Server-first incumbents cannot retrofit
   "runs on your device" without re-architecting their stacks and cannibalizing
   the upload funnels their upsells depend on.
2. **Speed as a consequence of that architecture.** No upload/download loop for
   the most common operations means instant results — a conversion lever and,
   via Core Web Vitals, an SEO lever competitors pay a round-trip tax on.
3. **Honest processing labels.** Telling users, per tool, exactly where files go
   (see §12) compounds trust. The words are trivial to copy; the *behavior* is
   expensive, because honesty constrains the dark-pattern monetization incumbents
   rely on.
4. **AI depth on a private base.** Grounded, cited document intelligence plus a
   firm "never used to train models" promise is a rare pairing: most AI PDF tools
   cannot credibly make the privacy claim, and most privacy tools lack the AI.
5. **Developer / API platform.** Exposing the same honest engine as an API
   creates ecosystem lock-in and a high-margin, high-retention revenue line pure
   consumer tools never build.
6. **Trust brand.** In a category that trained users to expect tricks, being
   *the* fast, honest, private name compounds into habit and word of mouth — the
   cheapest and stickiest distribution there is.

---

## 8. Product Principles

1. **Privacy by default.** The safest option is the default, never a paid upgrade.
   If a task can run on-device, it does.
2. **Honesty about where files go.** Every tool states its processing mode in
   plain language, in the UI, before the user acts. No ambiguity, ever.
3. **No dark patterns.** No forced signups for basic tasks, no fake delays, no
   hidden caps, no watermarks on free in-browser output, no buried pricing.
4. **Speed is a feature.** Local-first, no round trips where avoidable, instant
   feedback. We treat latency as a bug.
5. **Accessible to everyone.** WCAG AA as a baseline: full keyboard operation,
   screen-reader support, sufficient contrast, respect for reduced motion.
6. **Beautiful and calm.** Premium, uncluttered design that reduces anxiety and
   earns trust in a category defined by clutter.
7. **The file is the unit, not the tool.** Documents flow through a workspace and
   chain across tools without re-uploading — coherent, not one-shot.

---

## 9. Information Architecture

The IA mirrors the real product surface and is driven by a single source of
truth: the tool catalog. Adding one tool automatically wires up the homepage
grid, the /tools index, its dynamic page, search, the sitemap, and footer links.

- **Home (`/`)** — brand promise, featured tools (Merge, Split, Compress, PDF to
  Word, Edit, Sign, Chat with PDF), category overview, privacy story, pricing
  anchor (`/#pricing`), FAQ, and trust sections (`/#privacy`, `/#security`).
- **All tools (`/tools`)** — the catalog index, organized into the 8 categories,
  with search and category filtering (e.g. `/tools?category=ai`).
- **Tool page (`/tools/[slug]`)** — one dynamic page per tool, generated from the
  catalog entry: name, tagline, description, **processing-mode label**, accepted
  inputs/outputs, "how it works" steps, related tools, and SEO metadata.
- **Workspace (`/workspace`)** — the file-centric surface where documents persist
  and flow across multiple tools without re-uploading. The home of the "file is
  the unit" principle and, later, of accounts and history.
- **Footer** — Product, Company (About, Privacy, Security, Contact), and Resources
  (Help center, API — coming soon, Status, Changelog).

**The 8 categories** (order drives navigation):

| Category | Scope | Tools |
|---|---|---|
| **Organize** | Merge, split, reorder, rotate, clean up pages | 7 |
| **Convert to PDF** | Office files, images, web pages, text → PDF | 9 |
| **Convert from PDF** | PDF → Word, Excel, images, structured data | 9 |
| **Edit & Annotate** | Edit text/images, annotate, watermark, number pages | 7 |
| **Sign & Forms** | Sign, request signatures, fill and build forms | 4 |
| **Security** | Protect, unlock, redact, flatten, compare | 5 |
| **Optimize** | Compress, OCR, repair, web-optimize | 5 |
| **AI Tools** | Chat, summarize, translate, extract | 4 |

**50 tools, 8 categories.** The catalog is both the product and the growth engine
(see §15).

---

## 10. MVP Scope (Phase 0 / 1)

The MVP proves the thesis end to end: a complete, beautiful catalog where the
in-browser tools genuinely work, and where every not-yet-live tool is honest
about its status rather than faked.

**Ships as fully working (client-side, real).** The simplest, highest-intent
in-browser tools first: **Organize** — Merge, Split, Organize/Extract/Delete
Pages, Rotate, Extract Images; **Convert to PDF** — JPG, PNG, Text to PDF;
**Convert from PDF** — PDF to JPG, PNG, Text; **Optimize** — Grayscale. All built
on client PDF libraries and canvas/WASM rendering, running entirely on-device
under a truthful **"Runs in your browser"** label.

**Ships as foundation, not fake:**

- Full catalog UI: home, `/tools` index with all 8 categories and filtering, every
  `/tools/[slug]` page rendered from the catalog, search, sitemap, SEO, footer.
- **Honest placeholders + typed API contracts** for server, hybrid, and AI tools:
  each page states its processing mode and "coming soon" status, with the server/
  AI boundary defined so real engines drop in later without UI churn.
- Design system, WCAG AA baseline, and the processing-mode label component wired
  to every tool.
- Workspace shell (`/workspace`) that holds files and routes them into live client
  tools.

**Explicitly out of MVP:** accounts, billing, request-signatures workflow, and
all server/AI engine implementations (those are Phases 3–5). We would rather ship
14 tools that truly work and 36 honest "coming soon" pages than 50 tools that
pretend.

---

## 11. Tier-1 Feature Roadmap

Phased by processing mode, because that maps cleanly onto engineering
dependencies (client libs → WASM → workers/AI → accounts → API). Every tool named
below is a real catalog entry.

| Phase | Theme | Catalog tools brought live | Modes |
|---|---|---|---|
| **1 — Foundation** | Catalog, IA, SEO, design system, first client tools | Merge, Split, Organize/Extract/Delete Pages, Rotate, Extract Images, JPG→PDF, PNG→PDF, Text→PDF, PDF→JPG, PDF→PNG, PDF→Text, Grayscale | client |
| **2 — Client engines** | Richer in-browser editing & security via WASM | Edit PDF, Annotate, Add Page Numbers, Add Watermark, Crop, Header & Footer, Overlay/Stamp, Sign PDF, Fill & Sign Forms, Create Fillable Forms (beta), Redact, Flatten | client |
| **3 — Server & AI workers** | Ephemeral, encrypted workers + document intelligence | Compress, OCR, Repair, Optimize for Web; Word/Excel/PowerPoint/HTML/Webpage→PDF; PDF→Word/Excel/PowerPoint/PDF-A/Markdown; Compare; Markdown→PDF & Protect/Unlock (hybrid); Chat, Summarize, Translate, AI Data Extraction, Extract Tables | server, hybrid, ai |
| **4 — Accounts, workspace, e-sign** | Persistence, collaboration, billing | Request Signatures (audited workflow); workspace history & saved files; Pro subscription & Business seats | server + accounts |
| **5 — API & platform** | Developer platform on the same honest engine | Public API for conversion, compression, OCR, extraction, signing; docs, SDKs, webhooks, usage billing | API |

Prioritization within a phase follows search demand and the featured/popular
badges already encoded in the catalog (Merge, Split, Compress, PDF to Word, Edit,
Sign, Chat with PDF lead).

---

## 12. Processing Architecture & Honesty

The core promise: **we always tell users where their files go, per tool, in the
UI.** Four honest modes, with the exact user-facing copy already defined:

| Mode | Label | Promise to the user | Tools | Count |
|---|---|---|---|---|
| **client** | "Runs in your browser" | "Processes files entirely on your device. Nothing is uploaded to a server." | Merge, Split, Rotate, Edit, Sign, Redact, PDF↔image, and more | **26** |
| **server** | "Secure worker" | "Processed on an encrypted, isolated worker and permanently deleted shortly after." | Compress, OCR, Repair, Office conversions, Compare | **16** |
| **hybrid** | "Browser-first" | "Runs in your browser when possible, with an encrypted server fallback for large or complex files." | Markdown→PDF, Protect, Unlock | **3** |
| **ai** | "AI-assisted" | "Uses an AI model on secure infrastructure. Your content is never used to train models." | Chat, Summarize, Translate, AI Data Extraction, Extract Tables | **5** |

Design implications:

- **Client-first by default.** If an operation can run on-device at acceptable
  quality, it is a `client` tool — which is why 52% of the catalog never transmits
  a file.
- **Hybrid is honest about limits.** We do not pretend the browser can do
  everything; when a file is too large or complex, hybrid tools fall back to an
  encrypted worker — and say so.
- **Server and AI are contained and disclosed** — heavy conversions and
  intelligence run on ephemeral, auto-deleting workers, always labeled, never
  silent.
- **The label is a contract.** Processing mode lives in every tool's definition
  and renders as a visible chip on the tool page, not buried in a policy. Changing
  where a file goes means changing the label, in public.

---

## 13. Privacy & Security Posture

- **Client-first architecture.** The strongest guarantee is not transmitting the
  file at all; 26 tools meet that bar and are labeled accordingly.
- **Ephemeral, auto-deleting workers.** Server and AI operations run on isolated
  workers that permanently delete inputs and outputs shortly after processing;
  retention is minimized by design and stated plainly.
- **Encryption in transit and at rest** for anything that touches a worker,
  during the brief window it exists.
- **No training on user content.** AI features use secure infrastructure and
  never feed user documents into model training — a standing promise, not a toggle.
- **Verifiability.** Client tools run locally, so privacy is auditable by the user
  (no network activity) rather than merely asserted by us.
- **Secure web foundation.** Strict security headers (CSP, HSTS, frame and
  content-type protections), strict TypeScript, dependency hygiene, and a WCAG AA
  baseline as part of the same quality bar. No secrets in the repo — credentials
  live in the environment; `.env` values are never read or exposed.
- **Roadmap to proof:** published privacy/security pages, a transparency-oriented
  changelog, and eventual third-party security review — turning claims into
  independently checkable facts.

---

## 14. Monetization

Principle: **charge for compute, intelligence, and collaboration — never for
privacy or basic dignity.** We never watermark free in-browser output, never cap
the essentials behind a signup, and never obscure the price.

| Tier | Who | What's included | Illustrative price |
|---|---|---|---|
| **Free forever** | Everyone | All 26 in-browser tools, unlimited, no signup, no watermark; a fair allowance of server/AI tasks | $0 |
| **Pro** | Individuals & prosumers | Unlimited server/AI usage, larger files, batch processing, priority workers, higher AI limits, workspace history | ~$X / month* |
| **Business / Team** | SMBs & teams | Seats, shared workspace, e-sign request workflows with audit trails, admin controls, SSO | ~$Y / seat / month* |
| **API / Developer** | Builders & platforms | Usage-based access to conversion, compression, OCR, extraction, signing; free developer tier | usage-based* |

*Prices are illustrative placeholders for planning, not committed pricing.*

- **The free tier is the growth engine.** Client tools cost us almost nothing to
  serve (they run on the user's machine) and drive enormous high-intent organic
  traffic — the top of a funnel that monetizes on the compute-heavy work.
- **Pro monetizes marginal cost.** Server and AI operations have real
  per-operation cost; Pro aligns price with that cost while removing limits for
  power users.
- **Business monetizes collaboration.** Signature workflows, shared workspaces,
  and administration are where teams pay per seat.
- **API monetizes the platform.** High-margin, high-retention usage revenue built
  on the same honest engine.

---

## 15. Growth & SEO

The catalog *is* the growth machine, because adding a tool auto-generates its
landing page, sitemap entry, and internal links.

- **Programmatic per-tool landing pages.** 50 tools → 50 focused, high-intent
  pages, each targeting the head and long-tail keywords already encoded per tool,
  with "how it works" content and related-tool links for internal-linking depth.
- **Category hubs.** 8 category pages capture broader intent and distribute link
  equity to tool pages.
- **Conversion-pair coverage.** "X to Y" queries are among the highest-intent PDF
  searches; our convert-to/convert-from matrices cover them directly (Word↔PDF,
  Excel↔PDF, PPT↔PDF, JPG/PNG↔PDF, Markdown↔PDF).
- **Core Web Vitals as a moat.** Client-first tools are structurally fast; strong
  LCP/INP/CLS lifts both ranking and conversion where competitors pay a round-trip
  tax.
- **Shareable, embeddable, product-led.** Frictionless results plus (later)
  embeddable widgets and an API extend reach; free client tools acquire, the
  workspace and accounts retain, and Pro and API monetize.
- **Content and trust.** Help center, honest comparison guides, and privacy/
  security pages compound authority where trust content is scarce.

---

## 16. Success Metrics / KPIs

| Stage | Metric | Why it matters |
|---|---|---|
| **Acquisition** | Organic sessions; tool-page impressions & CTR; head-term rankings | Validates the programmatic-SEO engine |
| **Activation** | Task-completion rate; time-to-first-result (TTFR); files successfully processed | The product only works if the job finishes |
| **Performance** | LCP / INP / CLS pass rate; TTFB; client-tool processing time | Speed is a feature and an SEO input |
| **Engagement / Retention** | Tools per session; W1 / W4 return rate; workspace adoption | The "file is the unit" thesis, measured |
| **Monetization** | Free→Pro conversion; ARPU; API revenue; churn | Sustainable business |
| **Trust** | Privacy-label impressions; privacy-related support tickets; NPS | Our differentiation, made measurable |

**Guardrails.** Zero dark-pattern regressions; no client tool silently becoming a
server tool without a label change; accessibility (WCAG AA) never regresses.

---

## 17. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Commoditization / race to the bottom on free tools** | Compete on privacy, AI depth, UX, and brand — not just breadth. Build stickiness via workspace, accounts, and the API platform. |
| **Browser compute limits** (large files, memory, mobile) | Hybrid fallback to encrypted workers; WASM/SIMD optimization; honest, visible limits; server workers for genuinely heavy jobs. |
| **AI cost / margin** | Right-sized models, caching, usage limits on free tier, per-operation pricing, on-device where feasible. |
| **Trust, despite running some server tools** | Radical honesty via per-tool labels; ephemeral auto-delete; no training on user data; published security posture and eventual third-party audit. |
| **SEO competition from entrenched incumbents** | Win on Core Web Vitals and UX where they pay a round-trip tax; go deeper programmatically; earn trust-content authority; compound brand. |
| **Conversion-quality expectations** (Office round-trips are hard) | Set expectations clearly; invest in best-in-class engines; use AI-assisted layout reconstruction; iterate against real documents. |
| **E-sign / legal compliance** | Build or partner for an audited, standards-based signature workflow; be precise about what "legally binding" means and where. |
| **Scope sprawl across 50 tools** | The catalog-driven architecture keeps marginal tool cost low; phase strictly by processing mode and demand; never fake a tool to hit a count. |

---

## 18. Phased Execution Plan & Timeline

*Illustrative plan for sequencing and communication — not a commitment. Quarter
labels are relative to program start, not calendar dates.*

| Phase | Illustrative window | Theme | Key deliverables | Exit criteria |
|---|---|---|---|---|
| **Phase 1** | Q1 | Foundation & first client tools | Catalog-driven IA (home, `/tools`, `/tools/[slug]`, search, sitemap, SEO); design system; WCAG AA baseline; processing-label component; ~14 client tools live; honest placeholders for the rest | Live catalog; first client tools genuinely working; CWV green |
| **Phase 2** | Q2 | Client engines | WASM-backed edit/annotate/redact/flatten; watermark, page numbers, header/footer, overlay, crop, grayscale; sign, fill forms, create forms (beta); workspace shell chains client tools | Full client-side suite (26 tools) live and labeled |
| **Phase 3** | Q3 | Server & AI workers | Ephemeral encrypted worker platform; compression, OCR, repair, web-optimize; Office and image conversions both directions; compare; hybrid protect/unlock/markdown; AI chat, summarize, translate, extract, tables | Server/AI tools live behind honest labels; no-training guarantee enforced |
| **Phase 4** | Q4 | Accounts, workspace, e-sign, billing | Accounts; persistent workspace & history; audited Request Signatures workflow; Pro & Business tiers with billing | Signed-in workspace + first paid subscribers |
| **Phase 5** | Q5+ | API & developer platform | Public API + docs + SDKs + webhooks; usage-based billing; embeddable widgets | External developers in production on the API |

**Sequencing logic.** We earn trust and traffic first (free, fast, private client
tools), then add the compute and intelligence people pay for, then the
collaboration and platform layers that create durable revenue and lock-in. Every
phase ships something real and honestly labeled; nothing is faked to inflate the
tool count.

---

### Appendix — Catalog Snapshot

- **50 tools · 8 categories.**
- **Processing mix:** 26 client · 16 server · 3 hybrid · 5 AI.
- **Featured:** Merge PDF, Split PDF, Compress PDF, PDF to Word, Edit PDF, Sign
  PDF, Chat with PDF.
- **Source of truth:** the tool catalog auto-wires the homepage grid, `/tools`
  index, dynamic tool pages, search, sitemap, and footer — so strategy, product,
  and SEO stay in sync by construction.
