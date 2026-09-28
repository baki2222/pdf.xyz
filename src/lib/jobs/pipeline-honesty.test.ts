// @vitest-environment node
/**
 * "What happens to your file", held to what happens to the file.
 *
 * Every worker-backed tool page renders `workerPipelineStages`. Audited at
 * 67e8d0f, that list made four false claims on production — none of them caught,
 * because the only tests of it called the function and checked its shape:
 *
 *  - "A single-job sandbox with no network egress does the work, then is
 *    destroyed." The worker is ONE long-running daemon (`Dockerfile` CMD
 *    `worker:daemon`, compose `restart: unless-stopped`) that must reach object
 *    storage and the queue over the network. There is no per-job sandbox and no
 *    egress policy anywhere in it. The same claim was hand-typed into three panels
 *    ("recognized in a sandbox with no network egress", "processed in a sandbox
 *    with no network egress", "processed in an isolated sandbox").
 *  - On the four AI pages that sentence sat beside a tool that sends the
 *    document's text to a third-party AI provider, and nothing on the page said so.
 *  - On webpage-to-pdf — a network fetch by definition — it said the same, under
 *    "Your file is uploaded" and a file preflight, for a tool that takes no file.
 *  - The server-rendered page (what every crawler and every first paint gets) has
 *    no heartbeat, and rendered that as "not scanning": production said "Files are
 *    not scanned for malware here" while `/api/worker/status` reported an active
 *    scanner. Repair PDF's preflight said "malformed ones are rejected".
 *
 * So this file reads what a reader RECEIVES — every tool page, rendered in a fresh
 * process exactly as `file-ceilings.test.ts` does (see `src/tests/render-tool-pages.ts`
 * for why it must be a subprocess) — and binds each stage to the code that makes
 * it true: the real soundness gate, the real repair engine, and the real
 * processors' dependence on an AI provider.
 *
 * ── EXIT CONDITION FOR THE ISOLATION BAN (a property, not a mechanism) ────────
 * The isolation vocabulary may return to a page only when a real job, run on the
 * production worker, tries to open a network connection from inside its
 * processing step and is REFUSED, and a second job cannot read the first job's
 * working files — and never on an AI or URL tool, which reach the network by
 * design. A container flag, a `bwrap`/`unshare` argv, a Dockerfile line or a
 * heartbeat boolean is a MECHANISM and does not satisfy it: each can exist while
 * the property does not (the daemon needs the network for storage regardless).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { tools } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import { howToSteps } from "@/lib/tools/tool-facts";
import {
  modeHasBrowserPath,
  modeUploadsFiles,
} from "@/lib/tools/processing-split";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "@/lib/tools/copy-surface";
import { readFileSync } from "node:fs";
import {
  capabilityForMode,
  getToolInputKind,
  workerPipelineStages,
} from "./capabilities";
import { acceptsDamagedPdf } from "./damaged-input";
import { declaredContentTypeFor } from "./mime-by-format";
import {
  DEFAULT_SOUNDNESS_POLICY,
  checkSoundness,
  type SoundnessPolicy,
} from "@/lib/workers/soundness";
import * as processors from "@/lib/workers/processor";
import {
  PDF_STRUCTURE_TOOLS,
  REPAIR_TOOL,
  OPTIMIZE_WEB_TOOL,
  runOptimizeWeb,
  runRepair,
  type PdfStructureRun,
  type QpdfStructureRunner,
} from "@/lib/workers/pdf-structure/engine";

const ROOT = process.cwd();

/* ------------------------------------------------------------------ *
 *  The isolation vocabulary — a ban list with a corpus in both directions
 * ------------------------------------------------------------------ */

/** Every isolation sentence the product has shipped, verbatim. */
const SHIPPED_ISOLATION_CLAIMS = [
  "A single-job sandbox with no network egress does the work, then is destroyed.",
  "Isolated processing",
  "recognized in a sandbox with no network egress",
  "processed in a sandbox with no network egress",
  "processed in an isolated sandbox",
] as const;

const ISOLATION_PATTERNS: readonly RegExp[] = [
  /sandbox/i,
  /network egress/i,
  /then is destroyed/i,
  /single-job/i,
  /isolated processing/i,
];

function isolationHits(text: string): string[] {
  return ISOLATION_PATTERNS.filter((re) => re.test(text)).map(String);
}

/* ------------------------------------------------------------------ *
 *  What a reader receives: every tool page, rendered in a fresh process
 * ------------------------------------------------------------------ */

const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const CENSUS = path.join(ROOT, "src", "tests", "render-tool-pages.ts");

const pageText = new Map<string, string>();

beforeAll(() => {
  const stdout = execFileSync(process.execPath, [TSX_CLI, CENSUS], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  for (const [slug, text] of Object.entries(
    JSON.parse(stdout) as Record<string, string>,
  )) {
    pageText.set(slug, text);
  }
}, 180_000);

function page(slug: string): string {
  const text = pageText.get(slug);
  if (text === undefined) throw new Error(`no rendered page for ${slug}`);
  return text;
}

/**
 * The pages that render the worker pipeline, DERIVED from the rendered output
 * (the pipeline's last stage is always "Auto-delete") rather than typed — and
 * then held to the catalog below, so a page that silently stopped rendering it
 * shrinks this set loudly.
 */
function pipelinePages(): string[] {
  return [...pageText.entries()]
    .filter(([, text]) => /\bAuto-delete\b/.test(text))
    .map(([slug]) => slug)
    .sort();
}

/**
 * The tools whose page is the worker panel: they upload, and have no browser
 * path of their own (a hybrid tool's page is its in-browser runner). Asked of
 * `processing-split`, the one module allowed to say what a mode means.
 */
const WORKER_TOOLS: readonly Tool[] = tools.filter(
  (t) => modeUploadsFiles(t.processing) && !modeHasBrowserPath(t.processing),
);

describe("the census reads a plausible set of pages (health checks)", () => {
  it("rendered every catalog page", () => {
    expect(pageText.size).toBe(tools.length);
    expect(pageText.size).toBeGreaterThanOrEqual(40);
  });

  it("found the pipeline on exactly the worker-backed pages", () => {
    const found = pipelinePages();
    expect(
      found.length,
      "implausibly few pipeline pages",
    ).toBeGreaterThanOrEqual(15);
    expect(found).toEqual(WORKER_TOOLS.map((t) => t.slug).sort());
  });
});

describe("no page claims an isolation the worker does not have", () => {
  it("the ban list and the shipped corpus cover each other (both directions)", () => {
    for (const sentence of SHIPPED_ISOLATION_CLAIMS) {
      expect(
        isolationHits(sentence),
        `shipped sentence not caught by any pattern: "${sentence}"`,
      ).not.toEqual([]);
    }
    for (const pattern of ISOLATION_PATTERNS) {
      expect(
        SHIPPED_ISOLATION_CLAIMS.some((s) => pattern.test(s)),
        `pattern ${String(pattern)} catches no shipped sentence — decoration`,
      ).toBe(true);
    }
  });

  it("no rendered tool page contains the vocabulary", () => {
    const offenders = [...pageText.entries()].flatMap(([slug, text]) =>
      isolationHits(text).map((hit) => `${slug}: ${hit}`),
    );
    expect(offenders).toEqual([]);
  });

  it("no pipeline branch, for any worker tool, contains it", () => {
    const offenders: string[] = [];
    for (const tool of WORKER_TOOLS) {
      for (const scan of [true, false, null] as const) {
        const copy = workerPipelineStages(scan, tool)
          .map((s) => `${s.title} ${s.description}`)
          .join(" ");
        for (const hit of isolationHits(copy))
          offenders.push(`${tool.slug}/${String(scan)}: ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no copy file a visitor can read contains it, in any state of any panel", () => {
    // The rendered census sees only the server-render state; a panel's ready or
    // failed state is copy too. So the source walk covers what the render cannot.
    const files = copyFiles();
    expect(files.length, "copy walk is implausibly small").toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const file of files) {
      const text = flattenForPhraseSearch(
        withoutComments(readFileSync(file, "utf8")),
      );
      for (const hit of isolationHits(text))
        offenders.push(`${path.relative(ROOT, file)}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("the server render makes NO malware-scan claim either way", () => {
  it("no pipeline page claims either; every file-tool page renders the neutral checks stage", () => {
    const offenders = pipelinePages().flatMap((slug) => {
      const text = page(slug);
      const out: string[] = [];
      if (/not scanned for malware/i.test(text))
        out.push(`${slug}: not scanned`);
      if (/scanned for malware before/i.test(text))
        out.push(`${slug}: scanned`);
      // A URL tool has no file to check, so no checks stage at all.
      if (getToolInputKind(slug) === "file" && !/Safety checks/.test(text))
        out.push(`${slug}: no neutral checks stage`);
      return out;
    });
    expect(offenders).toEqual([]);
  });

  it("positive control: the observed branches DO carry each claim this polices", () => {
    const pdf = WORKER_TOOLS.find((t) => t.accept.includes("PDF"))!;
    const off = workerPipelineStages(false, pdf).map((s) => s.description);
    const on = workerPipelineStages(true, pdf).map((s) => s.description);
    expect(off.join(" ")).toMatch(/not scanned for malware/i);
    expect(on.join(" ")).toMatch(/scanned for malware before/i);
  });
});

/* ------------------------------------------------------------------ *
 *  AI tools: the page names the third party, on exactly the tools that use one
 * ------------------------------------------------------------------ */

/**
 * The tools whose processor needs an AI provider, found by ASKING the real
 * processors — every `create*Processor` the processor barrel exports is built
 * twice, once without a provider and once with one, and a processor whose
 * readiness flips depends on it. Not the catalog's `processing: "ai"` label: that
 * is the claim, and this is the thing it is a claim about.
 */
function toolsNeedingAiProvider(): { tools: Set<string>; probed: number } {
  const extract = async () => ({
    pageCount: 1,
    pages: [],
    text: "",
    characterCount: 0,
    hasText: false,
  });
  const provider = {
    id: "anthropic",
    model: "probe",
    complete: async () => ({ ok: false }),
  };
  const out = new Set<string>();
  let probed = 0;
  for (const [name, factory] of Object.entries(processors)) {
    if (!/^create\w*Processor$/.test(name) || typeof factory !== "function")
      continue;
    type Built = { tools: readonly string[]; capability(): { ready: boolean } };
    let without: Built;
    let readyWithout: boolean;
    let readyWith: boolean;
    try {
      without = (factory as (d: unknown) => Built)({ extract });
      readyWithout = without.capability().ready;
      readyWith = (factory as (d: unknown) => Built)({
        extract,
        provider,
      }).capability().ready;
    } catch {
      // Needs native deps (e.g. compression's engine table) just to report a
      // capability — so its readiness cannot hinge on a provider stub. Counted
      // out of `probed`, which the caller bounds from below.
      continue;
    }
    probed += 1;
    if (!readyWithout && readyWith) for (const t of without.tools) out.add(t);
  }
  return { tools: out, probed };
}

describe("AI tools say where the text goes", () => {
  it("the catalog's AI tools are exactly the tools whose processor needs a provider", () => {
    const { tools: needing, probed } = toolsNeedingAiProvider();
    expect(
      probed,
      "processor probe reached implausibly few",
    ).toBeGreaterThanOrEqual(10);
    expect(needing.size).toBeGreaterThanOrEqual(2);
    const labelled = tools
      .filter((t) => capabilityForMode(t.processing) === "ai")
      .map((t) => t.slug)
      .sort();
    expect(labelled).toEqual([...needing].sort());
  });

  it("each of their pages names the third-party AI provider; no other worker page does", () => {
    const { tools: needing } = toolsNeedingAiProvider();
    const missing = [...needing].filter(
      (slug) => !/third-party AI provider/.test(page(slug)),
    );
    expect(missing, "AI page that never names the third party").toEqual([]);
    const wrong = pipelinePages().filter(
      (slug) =>
        !needing.has(slug) && /third-party AI provider/.test(page(slug)),
    );
    expect(wrong, "non-AI page claiming an AI provider").toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  URL tools: nothing is uploaded, and the page is fetched from the web
 * ------------------------------------------------------------------ */

describe("URL tools do not describe an upload", () => {
  const urlTools = () =>
    tools.filter((t) => getToolInputKind(t.slug) === "url").map((t) => t.slug);

  it("finds at least one URL tool (health check)", () => {
    expect(urlTools().length).toBeGreaterThanOrEqual(1);
  });

  it("each URL page says nothing is uploaded and the page is fetched — and never tells the reader to upload", () => {
    const offenders: string[] = [];
    for (const slug of urlTools()) {
      const text = page(slug);
      if (!/Nothing is uploaded from your device/.test(text))
        offenders.push(`${slug}: no "nothing is uploaded"`);
      if (!/loads (that|the) page from the internet/.test(text))
        offenders.push(`${slug}: no fetch disclosure`);
      for (const re of [
        /Encrypted upload/,
        /Upload your/i,
        /Your file is uploaded/i,
        /What happens to my file/i,
        /Structural preflight|Safety checks/,
      ])
        if (re.test(text)) offenders.push(`${slug}: ${String(re)}`);
    }
    expect(offenders).toEqual([]);
  });

  it("positive control: a file tool's page DOES carry the upload story", () => {
    const fileWorker = WORKER_TOOLS.find(
      (t) => getToolInputKind(t.slug) === "file",
    )!;
    expect(page(fileWorker.slug)).toMatch(/Encrypted upload/);
    expect(page(fileWorker.slug)).toMatch(/Your file is uploaded/i);
    // "Upload your …" was HowToStep 1 of every worker page until the authored
    // steps (seo/content) replaced the derived ones on the page; the product
    // still writes it — `howToSteps`, the fallback a tool without authored
    // steps renders — so the pattern is exercised on that wording. (Searching
    // the rendered page for it case-insensitively "passes" only by reading
    // the heading "Encrypted upload" into the next line's "Your file".)
    const derived = WORKER_TOOLS.filter(
      (t) => getToolInputKind(t.slug) === "file",
    ).map((t) => howToSteps(t).join(" "));
    expect(derived.some((steps) => /Upload your/.test(steps))).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 *  The preflight sentence, held to the real soundness gate
 * ------------------------------------------------------------------ */

async function wholePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 6; i += 1) doc.addPage([612, 792]);
  return doc.save({ useObjectStreams: false });
}

/** Header present, tail (xref, trailer, `%%EOF`) cut off — the file repair exists for. */
async function truncatedPdf(): Promise<Uint8Array> {
  const whole = await wholePdf();
  return whole.slice(0, Math.floor(whole.byteLength * 0.6));
}

function verdict(
  policy: SoundnessPolicy,
  tool: string,
  file: { filename: string; contentType: string; bytes: Uint8Array },
): string {
  return checkSoundness(policy, {
    tool,
    inputs: [{ fileId: "f_probe", ...file }],
  }).verdict;
}

/** The preflight copy for a tool, as the observed-not-scanning page shows it. */
function preflightCopy(tool: Tool): string {
  const stage = workerPipelineStages(false, tool).find(
    (s) => s.id === "preflight",
  );
  if (!stage) throw new Error(`${tool.slug} has no preflight stage`);
  return stage.description;
}

const FILE_WORKER_TOOLS = () =>
  WORKER_TOOLS.filter((t) => getToolInputKind(t.slug) === "file");

describe("each preflight clause is a check the gate actually runs", () => {
  it("a well-formed input passes (control: the gate is not refusing everything)", async () => {
    const good = await wholePdf();
    for (const tool of FILE_WORKER_TOOLS()) {
      const format = tool.accept[0]!.toLowerCase();
      const filename = `doc.${format}`;
      const bytes = format === "pdf" ? good : new Uint8Array(4096).fill(0x41);
      expect(
        verdict(DEFAULT_SOUNDNESS_POLICY, tool.slug, {
          filename,
          contentType: declaredContentTypeFor(filename)!,
          bytes,
        }),
        tool.slug,
      ).toBe("sound");
    }
  });

  it("every clause the copy states is refused by the gate, for every file tool", () => {
    const offenders: string[] = [];
    for (const tool of FILE_WORKER_TOOLS()) {
      const copy = preflightCopy(tool);
      const format = tool.accept[0]!.toLowerCase();
      const filename = `doc.${format}`;
      const contentType = declaredContentTypeFor(filename)!;

      if (!/an empty file/.test(copy)) offenders.push(`${tool.slug}: no empty`);
      if (
        verdict(DEFAULT_SOUNDNESS_POLICY, tool.slug, {
          filename,
          contentType,
          bytes: new Uint8Array(),
        }) !== "unsound"
      )
        offenders.push(`${tool.slug}: gate passed an empty file`);

      // Was /declared type contradicts its name/ until the merge of
      // wave1/l06-copy-other reworded the clause without the protocol word
      // "declared" (refusal-copy.test.ts bans it). The clause is still required.
      if (!/a file whose type contradicts its name or this tool/.test(copy))
        offenders.push(`${tool.slug}: no type clause`);
      const otherName = format === "pdf" ? "x.docx" : "x.pdf";
      if (
        verdict(DEFAULT_SOUNDNESS_POLICY, tool.slug, {
          filename,
          contentType: declaredContentTypeFor(otherName)!,
          bytes: new Uint8Array(4096).fill(0x41),
        }) !== "unsound"
      )
        offenders.push(`${tool.slug}: gate passed a contradicting type`);

      const takesPdf = tool.accept.includes("PDF");
      const saysHeader = /no PDF header/.test(copy);
      if (saysHeader !== takesPdf)
        offenders.push(
          `${tool.slug}: header clause ${saysHeader} vs takes PDF ${takesPdf}`,
        );
      if (
        takesPdf &&
        verdict(DEFAULT_SOUNDNESS_POLICY, tool.slug, {
          filename: "doc.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array(4096).fill(0x41),
        }) !== "unsound"
      )
        offenders.push(`${tool.slug}: gate passed a headerless PDF`);
    }
    expect(offenders).toEqual([]);
  });

  it("claims no refusal the shipped gate does not make (no end-marker / malformed promise)", async () => {
    // DEFAULT_SOUNDNESS_POLICY does not check `%%EOF`, so a truncated PDF with a
    // header PASSES the gate for every PDF tool — the copy may not say otherwise.
    expect(DEFAULT_SOUNDNESS_POLICY.requireEof).toBe(false);
    const truncated = await truncatedPdf();
    for (const tool of FILE_WORKER_TOOLS().filter((t) =>
      t.accept.includes("PDF"),
    )) {
      expect(
        verdict(DEFAULT_SOUNDNESS_POLICY, tool.slug, {
          filename: "doc.pdf",
          contentType: "application/pdf",
          bytes: truncated,
        }),
        tool.slug,
      ).toBe("sound");
      const copy = preflightCopy(tool);
      expect(copy, tool.slug).not.toMatch(/malformed/i);
      expect(copy, tool.slug).not.toMatch(/really is the type/i);
      expect(copy, tool.slug).not.toMatch(/end marker|%%EOF|trailer/i);
    }
  });
});

/* ------------------------------------------------------------------ *
 *  Repair accepts damage — at the gate, at the engine, and on the page
 * ------------------------------------------------------------------ */

describe("a tool that exists to take damaged PDFs says so, and every layer agrees", () => {
  const STRICT: SoundnessPolicy = {
    ...DEFAULT_SOUNDNESS_POLICY,
    requireEof: true,
  };

  it("at least one tool takes damage and at least one refuses it (health)", () => {
    const pdfTools = FILE_WORKER_TOOLS().filter((t) =>
      t.accept.includes("PDF"),
    );
    const taking = pdfTools.filter((t) => acceptsDamagedPdf(t.slug));
    expect(taking.length).toBeGreaterThanOrEqual(1);
    expect(pdfTools.length - taking.length).toBeGreaterThanOrEqual(5);
  });

  it("gate with the opt-in %%EOF check: passes a truncated PDF exactly for the tools that say they take damage", async () => {
    const truncated = await truncatedPdf();
    const offenders: string[] = [];
    for (const tool of FILE_WORKER_TOOLS().filter((t) =>
      t.accept.includes("PDF"),
    )) {
      const passes =
        verdict(STRICT, tool.slug, {
          filename: "doc.pdf",
          contentType: "application/pdf",
          bytes: truncated,
        }) === "sound";
      const says = /not refused for its damage/.test(preflightCopy(tool));
      if (passes !== acceptsDamagedPdf(tool.slug) || says !== passes)
        offenders.push(
          `${tool.slug}: gate passes=${passes}, copy says=${says}`,
        );
    }
    expect(offenders).toEqual([]);
  });

  it("the structure engine's input floor agrees, run on a truncated PDF", async () => {
    const run: Record<string, typeof runRepair> = {
      [REPAIR_TOOL]: runRepair,
      [OPTIMIZE_WEB_TOOL]: runOptimizeWeb,
    };
    // The run table must name every tool the engine owns — no more, no fewer.
    expect(Object.keys(run).sort()).toEqual([...PDF_STRUCTURE_TOOLS].sort());
    const truncated = await truncatedPdf();
    const healthy = await wholePdf();
    for (const tool of PDF_STRUCTURE_TOOLS) {
      const seen: Uint8Array[] = [];
      const qpdf: QpdfStructureRunner = {
        async repair(input) {
          seen.push(input);
          return { bytes: healthy, warnings: [] };
        },
        async linearize(input) {
          seen.push(input);
          return { bytes: healthy, warnings: [] };
        },
      };
      const result: PdfStructureRun = await run[tool]!(truncated, { qpdf });
      expect(result.ok && seen.length === 1, tool).toBe(
        acceptsDamagedPdf(tool),
      );
    }
  });

  it("the rendered repair page says it; the page that refuses damage does not", () => {
    const offenders: string[] = [];
    for (const slug of pipelinePages()) {
      const text = page(slug);
      if (/malformed ones are rejected/i.test(text))
        offenders.push(`${slug}: "malformed ones are rejected"`);
      const says = /not refused for its damage/.test(text);
      if (says !== acceptsDamagedPdf(slug))
        offenders.push(`${slug}: damage clause ${says}`);
    }
    expect(offenders).toEqual([]);
    // Positive control: the refusing tools DO state the header refusal.
    expect(page(OPTIMIZE_WEB_TOOL)).toMatch(/no PDF header is refused/);
  });
});
