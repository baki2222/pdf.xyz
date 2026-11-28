/**
 * The typed contract for the secure-worker **liveness heartbeat** (Phase 30).
 *
 * The worker daemon is deliberately out-of-band: the web app never becomes it, so
 * the web vantage historically could not observe whether a worker was actually
 * *running* (`daemonObserved` was always `false`). This seam closes that gap
 * **safely**: an out-of-band daemon periodically publishes a tiny, bounded,
 * content-free liveness record to a shared backend (the same Redis/Upstash broker
 * the job queue uses, when configured), and the web app reads the latest record to
 * classify liveness as observed / stale / unknown — without ever pretending a
 * worker is alive when there is no recent evidence.
 *
 * Honesty & privacy posture (identical to every other worker seam):
 *  - **Bounded by construction.** Every published field is a fixed enum, a small
 *    boolean set, a schema version, a coarse `major.minor` release, or a single
 *    publish timestamp used only to derive a coarse age bucket. There is nowhere to
 *    put — and the parser drops anything that is not — a hostname, process id,
 *    container id, IP, port, path, Redis key, object key, endpoint, secret, or any
 *    high-cardinality value. No worker id is published by default.
 *  - **No fake liveness.** A record older than the freshness window is `stale`, and
 *    a missing record (the broker's TTL swept it, or none was ever published) is
 *    `unknown` — never silently upgraded to observed. A dead daemon cannot refresh
 *    its own timestamp, and the broker key expires, so liveness can never outlive
 *    the worker by more than one freshness window.
 *  - **Disabled stays honest.** With no compatible backend, or with the feature not
 *    explicitly enabled, publication and reads are disabled no-ops; the web vantage
 *    keeps its pre-existing "confirm a worker out-of-band" honesty rather than
 *    implying a worker is down.
 *
 * Node-free: the record schema, the classification, and the Redis-backed provider
 * all build on the node-free `RedisClient` (a `fetch` transport) and the node-free
 * queue config, so this whole module is safe to import from the `/api/worker/*`
 * routes and is reused verbatim by the Node-only daemon CLI.
 */

/** The bump-on-change schema version, so a heartbeat consumer can evolve safely. */
export const WORKER_HEARTBEAT_SCHEMA_VERSION = 1 as const;

/** The one worker role that publishes liveness today. A fixed enum, never an id. */
export type HeartbeatRole = "secure-worker";

/** The single role constant. */
export const HEARTBEAT_ROLE: HeartbeatRole = "secure-worker";

/**
 * The coarse mode the worker was in when it last beat — a small fixed enum, so the
 * dashboard can say "a worker is draining" vs "a worker reported readiness" without
 * any high-cardinality detail. `starting` covers the very first beat before a mode
 * is known.
 */
export type HeartbeatMode =
  "starting" | "loop" | "drain" | "once" | "check" | "dry-run";

/**
 * A coarse, fixed age ladder for the last-seen heartbeat — never a raw millisecond
 * value or wall-clock timestamp, so nothing high-cardinality is surfaced. The
 * boundaries are deliberately generous and independent of the configured interval.
 */
export type HeartbeatAgeBucket =
  "under-30s" | "under-2m" | "under-10m" | "over-10m";

/**
 * Where a liveness signal came from — a safe *category*, never an endpoint, key, or
 * broker name. `queue-broker` = read from the shared job-queue broker; `self` = the
 * worker observing its own in-process liveness; `none` = no backend / disabled.
 */
export type HeartbeatSource = "queue-broker" | "self" | "none";

/**
 * The read-side liveness classification a dashboard/alert cares about:
 *  - `observed` — a heartbeat published within the freshness window is visible;
 *  - `stale`    — a heartbeat is present but older than the freshness window (the
 *                 worker may have stopped or lost connectivity);
 *  - `unknown`  — no heartbeat is visible (the broker TTL swept it, none was ever
 *                 published, or the broker was unreachable) though observation IS
 *                 enabled — a meaningful "should be beating but isn't";
 *  - `disabled` — cross-process liveness observation is not enabled/configured here,
 *                 so absence says nothing (the honest, neutral default).
 */
export type DaemonLivenessState = "observed" | "stale" | "unknown" | "disabled";

/**
 * The presence-only capability summary a worker publishes. Bounded enums only —
 * booleans, plus one fixed-vocabulary language list.
 */
export interface HeartbeatCapabilities {
  /** Deep image compression — a native engine is installed on the worker. */
  readonly deepCompression: boolean;
  /** OCR — a real engine + runner are wired on the worker. */
  readonly ocr: boolean;
  /**
   * The recognition languages this worker can ACTUALLY run — the `traineddata`
   * packs observed in its image, narrowed to the codes the product advertises.
   *
   * `ocr: true` says an engine exists; it says nothing about which languages that
   * engine has data for, and those are different failures. Without this the web
   * tier could only echo the advertised list back, so the status endpoint reported
   * every language the catalogue names while conceding, in its own detail string,
   * that the packs "are not observable from here". A user could pick a language the
   * running image had never installed and only find out after uploading.
   *
   * Content-free by construction: the values come from a fixed 21-code vocabulary
   * (`OCR_LANGUAGE_CODES`), never from a path, a filename, or a document.
   */
  readonly ocrLanguages: readonly string[];
  /** A malware scanner is actively inspecting bytes (not the honest no-op). */
  readonly malwareScan: boolean;
  /** The configured queue guarantees atomic, race-safe state transitions. */
  readonly atomicQueue: boolean;
  /**
   * This image can SPLIT a document too long for one provider call into
   * several — the thing the FAQ promises in the words "a longer document is
   * not refused".
   *
   * PROVEN AT START-UP by running the real planner, never declared. A boolean
   * written in `main` would have read `true` for the nine days the running
   * image had no chunking in it at all, which is exactly the period this field
   * exists to have made visible.
   *
   * An image built before the feature does not publish this key, and
   * `boolOf(undefined)` is `false` — so the old image does not have to
   * cooperate. It could not: it was built before anyone thought to ask.
   */
  readonly chunkedTranslate: boolean;
  /**
   * This image enforces the per-job delivery bound and names the bound that
   * stopped it.
   *
   * Separate from {@link chunkedTranslate} because they fail differently and
   * cost differently: without splitting a long document is refused, which is
   * visible and annoying; without the cap the character reservation is
   * decorative and a caller can declare one character and be handed a whole
   * translation, which is invisible and expensive.
   */
  readonly deliveryCap: boolean;
  /**
   * Every `per-call` AI processor in this image (summarize, chat, extract)
   * reads no more of a document than the cap it is handed, and sends the
   * provider nothing beyond that document, the job's options and
   * `AI_PER_CALL_INSTRUCTION_CHARACTERS` of its own: the three things the
   * route charges. The cap bounds the document ONLY; the options are bounded
   * by the route's byte cap and charged by the server's own measure.
   *
   * Separate from {@link deliveryCap} because that one was proved on translate
   * alone, by images that ignored the cap on the other three tools — so an old
   * image publishes `deliveryCap: true` and could not be told apart. This key
   * did not exist before those processors honoured the cap, so an image built
   * earlier publishes nothing and parses as `false`.
   *
   * It is not only reported: `POST /api/jobs` honours a declared character
   * count for those tools only while this reads `true` on a fresh heartbeat.
   */
  readonly aiReadCap: boolean;
  /**
   * This image's PDF to PowerPoint engine writes a package whose slide master
   * → layout → theme chain is present and resolves, one slide per page.
   *
   * PROVEN AT START-UP by running the real engine and inspecting its output
   * (`pdf-office-export/capability.ts`). Until 2026-09-27 the engine wrote
   * slides with no master, layout or theme, and PowerPoint for Windows refused
   * every file as corrupted while the catalogue promised editable slides. The
   * fix reaches users only in an image built after it, and this field is how
   * the web tier can tell. It does not claim PowerPoint opens the file — no
   * PowerPoint runs on the worker — only that this image's engine writes decks
   * that pass the inspection the engine measured opening on Windows passed
   * (last measured 2026-10-09; see `pdf-office-export/capability.ts`).
   */
  readonly pptxPresentationChain: boolean;
  /**
   * This image's PDF to PowerPoint engine puts a page's picture on its slide
   * AS a picture, where the page paints it, at its pixel size.
   *
   * PROVEN AT START-UP by running the real engine over a generated PDF whose
   * first page paints one picture at a known box, and finding a `p:pic` at
   * that box whose image is that picture (`pdf-office-export/capability.ts`,
   * `provesPptxPictures`). The owner reported on 2026-10-10 that production's
   * decks had no pictures at all: the engine wrote one text box per slide.
   * The engine that keeps them reaches users only in an image built after it,
   * and copy that says pictures are kept is true of a download only while
   * this reads `true`. An image built before this key publishes nothing, and
   * the absence parses as `false`.
   */
  readonly pptxPictures: boolean;
  /**
   * This image's PDF to Word engine puts a page's picture in the .docx AS a
   * picture, between the line above it and the line below it, at the size
   * the page shows it.
   *
   * PROVEN AT START-UP by running the real engine on the deps the image's
   * jobs run on (its own text extractor, page reader and limits:
   * `pdfOfficeExportDeps(env)`) over a generated PDF with a picture between
   * two lines, and reading the .docx back (`pdf-office-export/capability.ts`,
   * `provesDocxPictures`). On 2026-10-17 production returned the owner's
   * 33-page tutorial as a .docx with none of its 37 pictures. The engine that
   * keeps them reaches users only in an image built after it, and copy that
   * says pictures are kept is true of a download only while this reads
   * `true`. An image built before this key publishes nothing, and the absence
   * parses as `false`.
   */
  readonly docxPictures: boolean;
  /**
   * This image's PDF to Word keeps each word's bold, italics, size and
   * colour, on that word and not the words beside it (2026-11-15, backlog
   * #28 slice 1: formatting on each run).
   *
   * PROVEN AT START-UP by running a generated PDF — five words on one
   * baseline in five styles, a plain line under them — as a real job would,
   * in the executor's order (soundness gate, the registry's processor on
   * `pdfOfficeExportDeps(env)`, artifact-manifest gate), and reading the
   * .docx back with a structural reader that shares nothing with the writer
   * (`pdf-office-export/capability.ts`, `provesDocxRunStyles`): each word
   * must carry exactly its own run properties, and the text read back must be
   * the image's poppler text, exactly. Until that date the .docx kept bold
   * or italics only where a WHOLE paragraph was set in them, and no size or
   * colour at all; copy that says each word keeps its formatting is true of
   * a download only while this reads `true`. An image built before this key
   * publishes nothing, and the absence parses as `false`.
   */
  readonly docxRunStyles: boolean;
  /**
   * This image's PDF to Word writes a table whose cells each fit on one line
   * as a Word table, each value in its column, an empty cell left empty,
   * words keeping their run styles (2026-11-15, backlog #28 slice 2:
   * tables).
   *
   * PROVEN AT START-UP by running a generated PDF — a wide-gapped line, a
   * short separator, and a four-row table with a bold header and an empty
   * middle cell — as a real job would, in the executor's order (soundness
   * gate, the registry's processor on `pdfOfficeExportDeps(env)`,
   * artifact-manifest gate), and reading the .docx back with a structural
   * reader that shares nothing with the writer
   * (`pdf-office-export/capability.ts`, `provesDocxTables`): exactly one
   * table of 3 columns and 4 rows, every value in its own column, the empty
   * cell with no run, the header bold and the body rows not, and the text
   * read back the image's poppler text, exactly. Until that date a table
   * came through as paragraphs with its cells separated by tabs; copy that
   * says a table comes through as a Word table is true of a download only
   * while this reads `true`. Tables whose cells wrap onto a second line
   * are not proven by this key: they are covered by `docxTableWraps` since
   * 2026-11-16 (#28 slice 3). An image built before this key publishes
   * nothing, and the absence parses as `false`.
   */
  readonly docxTables: boolean;
  /**
   * This image's PDF to Word sets each word in a font that comes with
   * Windows or Office — a substitute of the same kind as the PDF's font,
   * serif, sans-serif or monospaced, where that kind can be told from the
   * font's name or marks, and none where it cannot — named in `w:rFonts`
   * (`w:ascii`, `w:hAnsi` and `w:cs`, never `w:eastAsia`) (2026-11-15,
   * backlog #28 slice 4: typeface by kind).
   *
   * PROVEN AT START-UP by running a generated PDF — a Times line, a Courier
   * line and a Helvetica line — as a real job would, in the executor's
   * order (soundness gate, the registry's processor on
   * `pdfOfficeExportDeps(env)`, artifact-manifest gate), and reading the
   * .docx back with a structural reader that shares nothing with the writer
   * (`pdf-office-export/capability.ts`, `provesDocxTypefaces`): every word
   * of the three lines in Times New Roman, Courier New and Arial
   * respectively, in all three attributes; no `w:eastAsia` anywhere; the
   * text the image's poppler text, exactly; nothing Word could refuse.
   * Until that date every word opened in Word's default font; copy that
   * says words are set in Office fonts of their kind is true of a download
   * only while this reads `true`. It does NOT prove: that any font is
   * embedded (none is), that the PDF's OWN font reaches the file (only an
   * Office family's name is written — the PDF's own when it is one of
   * those), or anything about words outside Latin (Bengali, Arabic, CJK…
   * carry no typeface by design). Nor does it prove the kind of a face Word
   * does not know (`docxKindOf`, review round 2): the probe's three fonts
   * are standard-14, whose kind the alias table fixes; that derivation is
   * pinned by real-PDF tests (`docx-typefaces.engine.test.ts`) and the
   * claims test's CMR10 / CMTT10 controls, not by this key. An image built
   * before this key publishes nothing, and the absence parses as `false`.
   */
  readonly docxTypefaces: boolean;
  /**
   * This image's PDF to Word keeps a table cell whose text continues onto
   * the lines below it, in a column of text other than the first, in its
   * row as one paragraph, not as rows or lines of its own (2026-11-16,
   * backlog #28 slice 3: wraps).
   *
   * PROVEN AT START-UP by running a generated PDF — an Item / Description /
   * Amount table with a bold header and four rows, two of whose
   * descriptions continue onto one and two lines below them, and a total
   * alone under Amount — as a real job would, in the executor's order
   * (soundness gate, the registry's processor on `pdfOfficeExportDeps(env)`,
   * artifact-manifest gate), and reading the .docx back with a structural
   * reader that shares nothing with the writer
   * (`pdf-office-export/capability.ts`, `provesDocxTableWraps`): exactly
   * one table of 3 columns and 5 rows, each wrapped description whole in
   * its row as exactly one paragraph, the total outside the table, the
   * header bold and the body not, the text read back the image's poppler
   * text exactly, AND the words read back the probe's own words exactly (a
   * second bound: a word flow doubled or lost moves the .docx and the
   * flow's text together). Until that date a table whose cells wrap came
   * through as a smaller table and lines of text, or as lines of text
   * alone; copy that says a wrapped cell stays in its row is true of a
   * download only while this reads `true`. It does NOT cover: wraps in a
   * table's first column (they end the table); a lone figure under a table;
   * any wrap under a column of figures below the header, even a word such
   * as "incl. VAT"; two cells wrapping on the same baseline (they form a
   * row of their own); tables whose wrapped lines outnumber their rows;
   * header lines that sit above the row; or a wrapped line poppler reads as
   * a block of its own, apart from its cell, in a table whose rows are set
   * as close as its lines (flow.ts rule 7 takes such a line only when it
   * sits tighter than the rows, `WRAP_TIGHT_PITCHES`: a subheading or a
   * note between two rows is a block of its own a row pitch down). An image built before this key
   * publishes nothing, and the absence parses as `false`.
   */
  readonly docxTableWraps: boolean;
  /**
   * This image's Translate PDF recognises a SCAN with the OCR processor and
   * translates what OCR read, when the job asks for it — and runs no OCR on a
   * PDF that already has text (audit translate-pdf#3, 2026-11-09).
   *
   * PROVEN AT START-UP by running a `translate-pdf` job through the registry
   * the daemon builds, with stub OCR, extractor and provider
   * (`translate/ocr-capability.ts`, `provesTranslateOcr`): the provider must
   * receive a marker only OCR's output holds, and a typed PDF must run no
   * OCR. It says nothing about whether OCR itself runs here — that is
   * {@link ocr} — so the web offers OCR inside Translate only while BOTH read
   * `true` on an observed heartbeat. Until then the Translate panel refuses
   * a scan before upload, as it did before this key. An image built before
   * the key publishes nothing, and the absence parses as `false`.
   */
  readonly translateOcr: boolean;
  /**
   * This image's HTML to PDF prints a ZIP holding a page and its files: the
   * page chosen (or found), its stylesheets, pictures and fonts served from
   * the archive at the document origin, every refusal typed (2026-11-14,
   * competitor audit #26).
   *
   * PROVEN AT START-UP by running `html-to-pdf` jobs through the registry the
   * daemon builds, with a stub Chromium (`html-render/zip-capability.ts`,
   * `provesHtmlZip`): a ZIP job must reach the renderer as a site whose page
   * is the one asked for and whose stylesheet is served with its type, a
   * path outside the archive must be refused, an HTML file must still render
   * as a file, and a ZIP of several pages naming none must be refused before
   * the renderer starts. An image built before the key cannot open a ZIP —
   * it renders the archive's bytes as if they were HTML and calls the noise
   * a PDF — so the web offers ZIP, and `POST /api/uploads` and
   * `POST /api/jobs` accept one, only while this reads `true` on an observed
   * heartbeat. The absence parses as `false`.
   */
  readonly htmlZip: boolean;
  /**
   * This image's Chat with PDF chooses, for a document whose page-labelled
   * text does not fit one question's budget, the pages THAT question points
   * to — an opening anchor, pages the previous answer cited, and pages ranked
   * by the words they share with the question (BM25) — within the budget the
   * route charged (2026-11-16, competitor audit wave 2 #30, slice 3).
   *
   * PROVEN AT START-UP (`chat-with-pdf/retrieval-capability.ts`,
   * `provesChatRetrieval`): `chat-with-pdf` jobs through the executor's order
   * with the image's REAL `pdftotext` and ICU, a recording provider and an
   * 8,000-character delivery cap. A 70-page document with a token only on
   * page 60 must reach the provider with that page inside the document span,
   * the manifest and the stored record must name page 60, and the
   * document plus its page list must stay within the charge; a question
   * with no informative term must still get the opening pages, and a
   * document that fits must go whole. An image built before the key sends
   * only the opening pages; the absence parses as `false`, and only an
   * observed `true` turns on the panel's sentence about how pages are chosen.
   */
  readonly chatRetrieval: boolean;
  /**
   * This image's Summarize PDF reads only the pages a person chose — physical
   * page numbers, matched by each page's own number so a blank page does not
   * shift the rest — before the read cap, and refuses a page past the end
   * before any provider call (2026-11-16, audit summarize-pdf#5, slice 5).
   *
   * PROVEN AT START-UP (`summarize/pages-capability.ts`,
   * `provesSummarizePages`): `summarize-pdf` jobs through the executor's
   * order with the image's REAL `pdftotext` and a recording provider, over a
   * 4-page PDF whose page 2 is blank. `pages: [[3,3]]` must send page 3's
   * text and neither page 1's nor page 4's, and the manifest, summary.md,
   * README, system prompt and stored record must all name page 3 of 4; no
   * `pages` must send every page; `pages: [[5,5]]` must fail with no provider
   * call. An image built before the key IGNORES `pages` and summarizes the
   * whole document, so the web offers a page choice, and `POST /api/jobs`
   * accepts one, only while this reads `true` on an observed heartbeat. The
   * absence parses as `false`.
   */
  readonly summarizePages: boolean;
  /**
   * The Translate PDF target languages this image prints as a reflowed PDF
   * beside the translation ZIP (2026-11-15, competitor audit #29 slice 1),
   * as codes from `TRANSLATE_LANGUAGES`, sorted.
   *
   * PROVEN AT START-UP (`translate/pdf-capability.ts`,
   * `translatePdfLanguages`): one `translate-pdf` job per language through
   * the executor's order with the image's REAL Chromium and `pdftotext`
   * read-back, and each PDF judged by independent readers — every font
   * embedded with ToUnicode; a Noto face for the script, or (Chinese,
   * Japanese, Korean, since 2026-11-16) Type 3 glyphs that are vector
   * outlines of the regional Noto CJK face and never .notdef boxes; the
   * sample read back by poppler, and for CJK by pdf.js too; ink on the page;
   * Arabic laid out right to left. The engine reads the SAME memo
   * before every render, so a language absent here gets the ZIP alone. An
   * image built before the key publishes nothing, which parses as `[]`: the
   * panel then describes the ZIP alone, as it did before.
   */
  readonly translatePdfLanguages: readonly string[];
  /**
   * This image's Translate PDF sends a two-column page's columns to the model
   * one after the other, not line by line across the page (2026-11-16, slice
   * 3 of competitor audit #29: reading order).
   *
   * PROVEN AT START-UP (`translate/reading-order-capability.ts`,
   * `provesTranslateReadingOrder`): one `translate-pdf` job through the
   * executor's order on a generated two-column page, with the image's REAL
   * Translate extractor (`pdftotext -layout`, then `-bbox-layout`) and a stub
   * provider. The text the provider received AND the delivered
   * `translation.txt` must each hold the left column's sentence whole, before
   * the right column's, with no line of both columns together; the job record
   * must say the page was sent as flow; and the same page's `-layout` reading
   * must interleave the columns on this binary (the in-probe control).
   *
   * What it does NOT prove: that every layout is read in order (the gate is
   * order-blind, and flow's block order on an unusual page is poppler's), that
   * a right-to-left page is sent as flow (it is not, by design), or that a
   * real provider call succeeds. Until a later slice flips the copy, no
   * sentence depends on it. An image built before the key publishes nothing,
   * and the absence parses as `false`.
   */
  readonly translateReadingOrder: boolean;
  /**
   * This image's Translate PDF heads a multi-page chunk's reflowed PDF page
   * by page ("Page 1", "Page 2", ...) when the model keeps the page markers,
   * and by the chunk's range ("Pages 1–3") when it does not, with the ZIP the
   * same either way (2026-11-16, slice 4 of competitor audit #29: page
   * markers).
   *
   * PROVEN AT START-UP (`translate/page-map-capability.ts`,
   * `provesTranslatePageMap`): two `translate-pdf` jobs through the
   * executor's order on a generated three-page PDF, with the image's REAL
   * Translate extractor, its REAL reflowed-PDF renderer (Chromium) and the
   * engine's own `pdftotext` read-back, after the PDF-language memo settles;
   * the target is derived from the proven languages. Arm A's stub model
   * echoes the segment (markers kept), arm B's strips the markers. The marker
   * lines and the instruction must reach the model; each job record's
   * `results.ai.pageMap` must be exact with both invariants holding; arm A's
   * PDF must read back "Page N" before each page's tokens and arm B's one
   * "Pages 1–3" before all of them; the two ZIPs' `translation.txt` must be
   * identical and carry every page's tokens in order; no text a reader gets
   * may hold the marker's brand; and each arm's heading predicate must FAIL
   * on the other arm's PDF (the in-probe control).
   *
   * What it does NOT prove: that a real model keeps the markers
   * (`results.ai.pageMap.verified` / `marked` on real jobs measures that,
   * per job), that every target language keeps them, or that each page's
   * words stay under its own heading when a model moves text across a
   * marker. A worker with no Chromium, or no provable PDF language, publishes
   * `false`: there is no PDF to label. Until a later slice writes the copy,
   * no sentence depends on it. An image built before the key publishes
   * nothing, and the absence parses as `false`.
   */
  readonly translatePageMap: boolean;
  /**
   * This image's Translate PDF translates only the pages a person chose
   * (`pages` on the job, competitor audit #29 slice 6): it applies the
   * selection by PHYSICAL page number BEFORE the reading-order gate, the
   * planner and the delivery cap, so the model receives exactly those pages,
   * the page markers carry their real numbers, and every label names only
   * chosen pages.
   *
   * PROVEN AT START-UP (`translate/page-range-capability.ts`,
   * `provesTranslatePageRange`) on the image's OWN Translate extractor, over
   * a generated five-page PDF whose page 1 is blank, so an index-for-number
   * defect sends the wrong pages and is seen. An image built before the key
   * IGNORES `pages` (its parser is lenient to unknown keys) and translates the
   * whole document under a delivery cap sized for the selection, so the web
   * offers a page choice, and `POST /api/jobs` admits one, only while this
   * reads `true` on an observed heartbeat. The absence parses as `false`.
   */
  readonly translatePageRange: boolean;
  /**
   * This image's Excel to PDF reads a .csv with the delimiter and character
   * set the job chose (`csvDelimiter`, `csvCharset`, competitor audit #18):
   * it parses both strictly, refuses an unknown value, and opens the file
   * with LibreOffice's CSV filter built from them.
   *
   * PROVEN AT START-UP (`office-conversion/csv-capability.ts`,
   * `provesCsvImportOptions`) through the executor's order, with the image's
   * own LibreOffice runner and a recording stand-in for the soffice process:
   * the filter it would be handed must carry the chosen separator and
   * character-set codes. An image built before the key IGNORES both options
   * (its parser is lenient to unknown keys) and reads every CSV as comma
   * separated, so the web offers the choices, and `POST /api/jobs` admits
   * them, only while this reads `true` on an observed heartbeat. The absence
   * parses as `false`.
   */
  readonly csvImportOptions: boolean;
  /**
   * This image's OCR PDF runs on a PDF that opens without a password but
   * carries its author's restrictions, given the file's OWNER password
   * (`ownerPassword` on the job, competitor-audit backlog #11): it checks
   * the password against the file's own encryption dictionary, refuses one
   * that is not the owner's (nothing decrypted), decrypts with qpdf, runs
   * OCRmyPDF, and restricts the searchable PDF again with the same grant,
   * the same owner password, no open password and AES-256, read back before
   * it is delivered.
   *
   * PROVEN AT START-UP (`ocr-owner-capability.ts`, `provesOcrOwnerPassword`)
   * through the executor's order with the image's OWN OCR runner and qpdf
   * runner, on a restricted PDF built in code; only the OCRmyPDF and qpdf
   * PROCESSES are stand-ins, and qpdf must be present on the host. An image
   * built before the key IGNORES `ownerPassword` (its parser is lenient to
   * unknown keys) and refuses the file as restricted, so the web offers the
   * field, and `POST /api/jobs` admits the option, only while this reads
   * `true` on an observed heartbeat. The absence parses as `false`.
   */
  readonly ocrOwnerPassword: boolean;
  /**
   * This image's Request Signatures writes the label a requester gave a box
   * into prepared.pdf as that box's tooltip (/TU, on the field and on its
   * widget, PR #364), so a signer can see what each box is for. An image
   * built before #364 writes none (the label reaches manifest.json only).
   *
   * PROVEN AT START-UP (`request-signatures/labels-capability.ts`,
   * `provesRequestSignatureLabels`): a real Request Signatures job through
   * the executor's order on the daemon's own registry and deps, one signer
   * with one labelled box and one unlabelled box, its prepared.pdf read back
   * with pdf-lib (not the engine's writer): true only when the labelled
   * box's /TU, on the field and every widget, equals the label and the
   * unlabelled box has none. Any throw, or a run past its time bound, is
   * false. Nothing is gated on it (a label sent to an older image still
   * lands in manifest.json); it is what licenses the catalogue to state the
   * tooltip plainly (claims-vs-capability.test.ts). The absence parses as
   * `false`.
   */
  readonly requestSignatureLabels: boolean;
  /**
   * This image's Webpage to PDF honours "Hide common ads" (`hideAds`,
   * audit wave 2 webpage-to-pdf#1): requests to the in-house ad hosts are
   * refused and the slot markup is hidden. An older image IGNORES the key
   * (the capture parser leaves unknown keys alone) and prints every ad, so
   * the panel offers the box only while a fresh beat carries this.
   *
   * PROVEN AT START-UP (`html-render/ads-capability.ts`,
   * `provesHtmlAdBlock`): a webpage job through the daemon's own registry
   * reaches the renderer with the option exactly when asked, and the
   * renderer's own request test and slot script cover the lists. Chromium
   * is a stub there; `ads.chromium.test.ts` proves the printed PDF. The
   * absence parses as `false`.
   */
  readonly htmlAdBlock: boolean;
  /**
   * This image's PDF to PDF/A carries a Title, Author, Subject or Keywords
   * that Ghostscript 10.00.0 drops — a round bracket, a backslash, an accent,
   * another script — into the copy's Info dictionary AND its XMP packet,
   * written after Ghostscript (audit wave 2 pdf-to-pdfa#3,
   * `pdf-archive/docinfo-xmp.ts`). An older image carries plain ASCII only.
   *
   * PROVEN AT START-UP (`pdf-archive/docinfo-capability.ts`,
   * `provesPdfaUnicodeDocInfo`): one real job through the executor's order
   * on `nativePdfArchiveDeps(env)` — this image's real Ghostscript — read
   * back with pdf-lib and as XMP text; true only when all four fields hold
   * the exact strings in both. The panel's notes state the wider rule only
   * while a fresh beat carries this. The absence parses as `false`.
   */
  readonly pdfaUnicodeDocInfo: boolean;
  /**
   * This image's PDF to Word writes a table with NO column of figures — a
   * form grid of labels and values, a staff list of names and roles — as a
   * Word table when it is clearly a table of short entries (audit wave 2
   * pdf-to-word#2, `pdf-text/table-grid.ts` `isTextTable`: at least four
   * rows, every cell short, an entry in every row's first column, no column
   * of list numbering). An older image writes such a table as tabbed rows.
   *
   * PROVEN AT START-UP (`pdf-office-export/capability.ts`,
   * `provesDocxTextTables`): the text-tables probe PDF through the
   * executor's order on `pdfOfficeExportDeps(env)`, read back by
   * `docx-structure`; true only when the .docx holds exactly one Word table
   * of the probe's rows and columns, each cell the page's text, and the
   * numbered list below it outside any table. The absence parses as
   * `false`.
   */
  readonly docxTextTables: boolean;
}

/**
 * The bounded, content-free heartbeat record a worker publishes. Every field is a
 * schema version, a fixed enum, a coarse release, a small boolean set, or the
 * publish timestamp (used only to derive a coarse age — never surfaced raw).
 */
export interface WorkerHeartbeat {
  readonly v: typeof WORKER_HEARTBEAT_SCHEMA_VERSION;
  readonly role: HeartbeatRole;
  /**
   * Coarse `major.minor` release only (never a full build id); omitted if unknown.
   *
   * ⚠️ AND IT HAS NEVER MOVED. It is `coarseRelease(npm_package_version)`, and
   * `package.json` has been `0.1.0` since the beginning — so every worker image
   * ever built has published `"0.1"`, including the 2026-08-12 one that could
   * not chunk and the one that replaced it. It LOOKS like a build identity and
   * is a constant. See {@link fingerprint} for the field that actually
   * distinguishes builds.
   */
  readonly release?: string;
  /**
   * Twelve hex characters identifying the SOURCE this image carries.
   *
   * Diagnostic, deliberately not an alarm — see `../build-fingerprint`. It
   * turns "which build is running?" from an ssh session and a grep inside the
   * container into a value on the posture endpoint, which is the question you
   * ask once the capability probes have already fired.
   *
   * ON THE PRIVACY POSTURE, because this module's header says there is nowhere
   * to put a high-cardinality value and this is one. It is a hash of source
   * code that is not secret, computed from files the image ships; it names no
   * host, container, path, key or endpoint, and reveals nothing an attacker
   * could not get by reading the product. It is bounded by shape — exactly
   * twelve lowercase hex, enforced by the parser — so there is nowhere to smuggle
   * anything else through it.
   *
   * Omitted by any image built before this field existed, which reads as "did
   * not say" rather than as a mismatch.
   */
  readonly fingerprint?: string;
  readonly mode: HeartbeatMode;
  readonly capabilities: HeartbeatCapabilities;
  /**
   * The publish wall-clock time in ms. Used ONLY to derive a coarse age bucket and
   * the fresh/stale line on the read side; it is never surfaced raw to a client.
   */
  readonly at: number;
}

/**
 * The classified liveness a reader returns — the content-free projection the
 * operations snapshot folds in. Bounded enums, one coarse bucket, and a
 * client-safe detail (the UI re-authors all copy regardless).
 */
export interface HeartbeatLiveness {
  readonly state: DaemonLivenessState;
  /** Convenience: `true` iff `state === "observed"`. */
  readonly observed: boolean;
  readonly source: HeartbeatSource;
  /** Coarse age of the last heartbeat, or `null` when none is visible. */
  readonly lastSeen: HeartbeatAgeBucket | null;
  /** The coarse mode from the last heartbeat, or `null` when none is visible. */
  readonly mode: HeartbeatMode | null;
  /** The capability summary from the last heartbeat, or `null` when none is visible. */
  readonly capabilities: HeartbeatCapabilities | null;
  /**
   * The source fingerprint from the last heartbeat, or `null`.
   *
   * `null` covers both "no beat visible" and "the beat carried none" — an image
   * built before the field existed. Diagnostic only; nothing classifies on it.
   */
  readonly fingerprint: string | null;
  /** One-line, content-free explanation. Never names an endpoint, key, or value. */
  readonly detail: string;
}

/**
 * The honest, presence-only capability of the heartbeat seam in this environment —
 * the heartbeat analogue of {@link QueueCapability}. Content-free: it carries the
 * bounded timing windows and the source *category*, never an endpoint, token, key
 * prefix, or variable name.
 */
export interface HeartbeatCapability {
  /** True only when the feature is explicitly enabled AND a compatible backend is present. */
  readonly enabled: boolean;
  /** The source category a read/publish would use. */
  readonly source: HeartbeatSource;
  readonly role: HeartbeatRole;
  /** How often the daemon beats (seconds). */
  readonly intervalSeconds: number;
  /** Age (seconds) under which a heartbeat is still "observed"; beyond it, "stale". */
  readonly freshWindowSeconds: number;
  /** TTL (seconds) applied to the broker key; after it, the record vanishes → "unknown". */
  readonly ttlSeconds: number;
  /** One-line, content-free explanation. */
  readonly detail: string;
}

/** Why a publish attempt did (or did not) happen. Content-free. */
export type HeartbeatPublishReason =
  | "published" // a fresh heartbeat was written
  | "throttled" // within the interval since the last write; skipped (a no-op)
  | "disabled" // the feature is not enabled / no backend configured
  | "unavailable" // the backend errored or was unreachable (swallowed, never thrown)
  // a readiness probe found no proof THIS container's daemon wrote, so it
  // published nothing rather than overwrite the daemon's record with values
  // nobody proved (`daemon/proved-capabilities.ts`)
  | "unproven";

/** The outcome of a publish attempt. Never throws; failures are typed. */
export interface HeartbeatPublishResult {
  readonly published: boolean;
  readonly reason: HeartbeatPublishReason;
}

/** Publishes bounded liveness. Self-throttling and self-guarding; `beat` never throws. */
export interface HeartbeatPublisher {
  readonly capability: HeartbeatCapability;
  /** Publish a heartbeat now, or skip if throttled/disabled. Never throws. */
  beat(): Promise<HeartbeatPublishResult>;
}

/** Reads the latest liveness. `read` never throws; a failure classifies as `unknown`. */
export interface HeartbeatReader {
  readonly capability: HeartbeatCapability;
  /** Read + classify the latest heartbeat. Never throws. */
  read(): Promise<HeartbeatLiveness>;
}
