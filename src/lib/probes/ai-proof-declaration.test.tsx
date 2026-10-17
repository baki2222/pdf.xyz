// @vitest-environment jsdom
// @native-canvas
/**
 * The deployment proof of every AI tool declares what the BROWSER declares
 * for the same file — read off the wire the real panel writes to.
 *
 * THE DEFECT (2026-10-09). `scripts/worker-prove-tools.ts` sent summarize-pdf,
 * translate-pdf, ai-extract and both chat-with-pdf turns with no declaration.
 * The route reserves an undeclared job's fallback — a whole run of the daily
 * AI allowance — whatever the file holds, while every panel counts first. So
 * one run of the five AI proofs cost what five maximal documents cost, and on
 * 2026-10-09 the chat proofs were refused as UNPROVEN because the proofs
 * before them had spent the day. No user's request looks like that.
 *
 * WHAT IS HELD, AND AGAINST WHAT. The subjects are DERIVED: every AI spec the
 * harness runs is in `AI_PROOF_SPECS` (the script is read below to hold that
 * it spreads them and writes no AI spec of its own), and every AI tool in the
 * catalogue has one. For each, its fixture is dropped into the REAL panel for
 * its tool — real pdfjs count, real client, only `fetch` stubbed — and the
 * `POST /api/jobs` body that panel sends is compared with what the harness
 * computes (`browserAiDeclaration`) through pdfjs's LEGACY build, the one a
 * Node harness loads, while the panel here reads with whichever build the
 * page would. And the script is read to hold that `runSpec` puts that
 * declaration on every AI job, before the upload.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type * as TS from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { extractPdfText, type ExtractedPdfText } from "@/lib/pdf/text";
import { getAllToolSlugs, getToolBySlug } from "@/lib/tools";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { resetTelemetry } from "@/lib/telemetry/track";
import { runChatWithPdf } from "@/lib/workers/chat-with-pdf/engine";
import { runWorkerChatWithPdf } from "@/lib/workers/chat-with-pdf-client";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import { stubJobNetwork } from "@/tests/stub-job-network";
import { AI_PROOF_SPECS, type AiProofSpec } from "@/tests/ai-proof-specs";
import {
  AI_DELIVERY_LIMITS,
  aiReservationGiven,
} from "@/lib/jobs/delivery-cap";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import { PROOF_MEMO_PAGES } from "./ai-proof-content";
import {
  DECLARING_AI_TOOLS,
  browserAiDeclaration,
  type AiJobDeclaration,
} from "./ai-proof-declaration";
import { SummarizeWorkerPanel } from "@/components/tools/summarize-worker-panel";
import { TranslateWorkerPanel } from "@/components/tools/translate-worker-panel";
import { AiExtractWorkerPanel } from "@/components/tools/ai-extract-worker-panel";
import { ChatWithPdfWorkerPanel } from "@/components/tools/chat-with-pdf-worker-panel";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const HARNESS = "scripts/worker-prove-tools.ts";

/** pdfjs's legacy build: what `loadPdfjs` gives the Node harness. */
const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;
const harnessExtract = (bytes: Uint8Array): Promise<ExtractedPdfText> =>
  extractPdfText(bytes, legacy);

/** The catalogue's AI tools — the predicate the harness's `isAiSpec` applies. */
const isAiTool = (slug: string): boolean => {
  const tool = getToolBySlug(slug);
  return tool ? capabilityForMode(tool.processing) === "ai" : false;
};
const CATALOGUE_AI_TOOLS = getAllToolSlugs().filter(isAiTool).sort();

const specLabel = (spec: AiProofSpec) => spec.label ?? spec.tool;

/** The two declaration fields, both always present, so `undefined` is compared too. */
const fields = (body: AiJobDeclaration | Record<string, unknown>) => ({
  declaredCharacters: body.declaredCharacters,
  declaredTextPages: body.declaredTextPages,
});

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
});

// ── the derived set ─────────────────────────────────────────────────────────

describe("the AI proofs are one set, and it is the catalogue's", () => {
  it("every AI tool has a proof and a declaration, and nothing else does", () => {
    // Health: the predicate sees AI tools at all (a blind one is `[] ⊆ X`).
    expect(CATALOGUE_AI_TOOLS.length).toBeGreaterThanOrEqual(4);
    expect([...new Set(AI_PROOF_SPECS.map((s) => s.tool))].sort()).toEqual(
      CATALOGUE_AI_TOOLS,
    );
    expect([...DECLARING_AI_TOOLS].sort()).toEqual(CATALOGUE_AI_TOOLS);
    // Bounded: the chat follow-up is a fifth spec; labels are ledger keys.
    expect(AI_PROOF_SPECS.length).toBeGreaterThanOrEqual(
      CATALOGUE_AI_TOOLS.length + 1,
    );
    const labels = AI_PROOF_SPECS.map(specLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ── the script runs exactly that set, declaring before it uploads ──────────

/** What is wrong with how `source` (the harness) runs its AI proofs. */
function harnessProblems(source: string): string[] {
  const file = ts.createSourceFile(
    "worker-prove-tools.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const problems: string[] = [];
  let specs: TS.ArrayLiteralExpression | undefined;
  let runSpec: TS.FunctionDeclaration | undefined;
  let importsSpecs = false;
  const walk = (n: TS.Node) => {
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText(file) === "SPECS" &&
      n.initializer &&
      ts.isArrayLiteralExpression(n.initializer)
    )
      specs = n.initializer;
    if (ts.isFunctionDeclaration(n) && n.name?.text === "runSpec") runSpec = n;
    if (
      ts.isImportDeclaration(n) &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      n.moduleSpecifier.text === "@/tests/ai-proof-specs"
    ) {
      const b = n.importClause?.namedBindings;
      if (b && ts.isNamedImports(b))
        importsSpecs = b.elements.some((e) => e.name.text === "AI_PROOF_SPECS");
    }
    ts.forEachChild(n, walk);
  };
  walk(file);
  if (!specs) return ["no `const SPECS = [...]`"];
  if (!runSpec) return ["no `function runSpec`"];

  const names = (node: TS.Node): Set<string> => {
    const out = new Set<string>();
    const w = (x: TS.Node) => {
      if (ts.isIdentifier(x)) out.add(x.text);
      ts.forEachChild(x, w);
    };
    w(node);
    return out;
  };

  // 1. No AI spec is written in the script itself.
  for (const element of specs.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;
    const prop = (name: string) =>
      element.properties.find(
        (p): p is TS.PropertyAssignment =>
          ts.isPropertyAssignment(p) && p.name.getText(file) === name,
      );
    const tool = prop("tool")?.initializer;
    if (tool && ts.isStringLiteral(tool) && isAiTool(tool.text)) {
      const label = prop("label")?.initializer;
      problems.push(
        `inline AI spec "${label && ts.isStringLiteral(label) ? label.text : tool.text}"`,
      );
    }
  }
  // 2. The set the script runs includes AI_PROOF_SPECS, imported from its module.
  const spreads = specs.elements.some(
    (e) => ts.isSpreadElement(e) && names(e).has("AI_PROOF_SPECS"),
  );
  if (!spreads || !importsSpecs)
    problems.push(
      "SPECS does not spread AI_PROOF_SPECS from @/tests/ai-proof-specs",
    );

  // 3. runSpec declares, for every AI spec, what the browser declares — and
  //    puts it on the job request — and does it BEFORE the upload.
  let declareAt = -1;
  let declaredVar: string | undefined;
  let uploadAt = -1;
  let requestSpreads = new Set<string>();
  const inRun = (n: TS.Node) => {
    if (
      ts.isIfStatement(n) &&
      n.expression.getText(file).replace(/\s/g, "") === "isAiSpec(spec)"
    ) {
      const inner = (x: TS.Node) => {
        if (
          ts.isCallExpression(x) &&
          x.expression.getText(file) === "browserAiDeclaration" &&
          x.arguments[0]?.getText(file) === "spec.tool"
        )
          declareAt = x.getStart(file);
        if (
          ts.isBinaryExpression(x) &&
          x.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(x.left) &&
          ts.isPropertyAccessExpression(x.right) &&
          x.right.name.text === "declaration"
        )
          declaredVar = x.left.text;
        ts.forEachChild(x, inner);
      };
      inner(n.thenStatement);
    }
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(file) === "postJson" &&
      n.arguments[0]?.getText(file) === '"/api/uploads"'
    )
      uploadAt = n.getStart(file);
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText(file) === "request" &&
      n.initializer &&
      ts.isObjectLiteralExpression(n.initializer)
    )
      requestSpreads = new Set(
        n.initializer.properties
          .filter(ts.isSpreadAssignment)
          .map((p) => p.expression.getText(file)),
      );
    ts.forEachChild(n, inRun);
  };
  inRun(runSpec);
  if (declareAt < 0)
    problems.push(
      "runSpec never calls browserAiDeclaration(spec.tool, …) under isAiSpec(spec)",
    );
  else if (uploadAt >= 0 && declareAt > uploadAt)
    problems.push("runSpec declares AFTER the upload");
  if (!declaredVar || !requestSpreads.has(declaredVar))
    problems.push("the job request does not carry the browser's declaration");
  return problems;
}

describe("the harness runs every AI proof with the browser's declaration", () => {
  const source = readFileSync(HARNESS, "utf8");

  it("spreads AI_PROOF_SPECS, writes no AI spec itself, and declares before uploading", () => {
    expect(harnessProblems(source)).toEqual([]);
  });

  it("POSITIVE CONTROL: the harness as it shipped — inline AI specs, nothing declared", () => {
    // The shape of 2026-10-09's script, cut down: an AI spec in SPECS and a
    // runSpec that uploads and builds its request with no declaration.
    const shipped = `
      const SPECS: ProofSpec[] = [
        { tool: "compress-pdf", make: imagePdf, name: "photo.pdf", expect: isPdf, want: "PDF" },
        { tool: "summarize-pdf", make: textPdf, name: "report.pdf", expect: isZipContainer, want: "summary ZIP" },
        { tool: "chat-with-pdf", label: "chat-with-pdf (follow-up)", make: chatDocPdf, expect: isZipContainer, want: "answer ZIP" },
      ];
      async function runSpec(spec: ProofSpec) {
        const up = await postJson("/api/uploads", {});
        const request: Record<string, unknown> = { tool: spec.tool, inputs };
      }`;
    expect(harnessProblems(shipped)).toEqual([
      'inline AI spec "summarize-pdf"',
      'inline AI spec "chat-with-pdf (follow-up)"',
      "SPECS does not spread AI_PROOF_SPECS from @/tests/ai-proof-specs",
      "runSpec never calls browserAiDeclaration(spec.tool, …) under isAiSpec(spec)",
      "the job request does not carry the browser's declaration",
    ]);
  });

  it("POSITIVE CONTROL: the live script with its declaration moved below the upload is refused", () => {
    // Cut the declaring block out and paste it after the upload request.
    const start = source.indexOf("    if (isAiSpec(spec)) {");
    const end = source.indexOf("\n    }\n", start) + "\n    }\n".length;
    expect(
      start,
      "health: the declaring block is where this control looks",
    ).toBeGreaterThan(0);
    const block = source.slice(start, end);
    const without = source.slice(0, start) + source.slice(end);
    const upload = without.indexOf("    const up = await postJson(");
    expect(upload).toBeGreaterThan(0);
    const after = without.indexOf("\n", without.indexOf("});", upload)) + 1;
    const moved = without.slice(0, after) + block + without.slice(after);
    expect(moved).not.toBe(source);
    expect(harnessProblems(moved)).toContain(
      "runSpec declares AFTER the upload",
    );
    // And with the declaration dropped from the request, it is refused too.
    const dropped = source.replace(/\n\s*\.\.\.aiDeclaration,/, "\n");
    expect(dropped).not.toBe(source);
    expect(harnessProblems(dropped)).toContain(
      "the job request does not carry the browser's declaration",
    );
  });
});

// ── what each panel puts on the wire, for each proof's fixture ─────────────

/** The file input, once the panel's builder has mounted. */
async function drop(bytes: Uint8Array, name: string): Promise<void> {
  const input = await waitFor(
    () => {
      const found = document.querySelector('input[type="file"]');
      expect(found, "the builder's file input").not.toBeNull();
      return found!;
    },
    { timeout: 5_000 },
  );
  fireEvent.change(input, {
    target: {
      files: [new File([bytes.slice()], name, { type: "application/pdf" })],
    },
  });
}

async function press(name: RegExp): Promise<void> {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => {
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("aria-disabled", "true");
  });
  fireEvent.click(button);
}

/** A real chat package from the real engine, answering `question` with `answer`. */
async function chatPackage(
  question: string,
  answer: string,
): Promise<Uint8Array> {
  const text = "The notes describe the secure worker.";
  const run = await runChatWithPdf(
    new Uint8Array([1, 2, 3]),
    { question },
    {
      extract: async () => ({
        pageCount: 1,
        pages: [{ pageNumber: 1, text, characterCount: text.length }],
        text,
        characterCount: text.length,
        hasText: true,
      }),
      provider: {
        id: "openai",
        model: "gpt-test",
        complete: async () => ({ ok: true, text: answer, model: "gpt-test" }),
      },
    },
  );
  if (!run.ok) throw new Error(`engine failed: ${run.message}`);
  return run.output;
}

/** That package as the client returns a success: what the panel reads of one. */
async function answered(question: string) {
  return {
    ok: true as const,
    job: { jobId: "j_test" },
    artifact: { filename: "answer.zip", url: "blob:answer" },
    output: await chatPackage(question, "They are platform notes [p.1]."),
  } as unknown as Awaited<ReturnType<typeof runWorkerChatWithPdf>>;
}

/**
 * Drive the panel for `spec.tool` with `bytes` the way a user does, and
 * return every `POST /api/jobs` body it sent. A spec that builds its options
 * from an earlier answer (the chat follow-up) is a SECOND question in the
 * same panel, so its body is the second one.
 */
async function panelJobBodies(
  spec: AiProofSpec,
  bytes: Uint8Array,
): Promise<Record<string, unknown>[]> {
  const network = stubJobNetwork(READY_WORKER_STATUS);
  const tool = getToolBySlug(spec.tool)!;
  switch (spec.tool) {
    case "summarize-pdf":
      render(<SummarizeWorkerPanel tool={tool} />);
      await drop(bytes, spec.name);
      await press(/summarize pdf/i);
      break;
    case "translate-pdf":
      render(<TranslateWorkerPanel tool={tool} />);
      await drop(bytes, spec.name);
      await screen.findByText(spec.name);
      await press(/translate pdf/i);
      break;
    case "ai-extract":
      render(<AiExtractWorkerPanel tool={tool} />);
      await drop(bytes, spec.name);
      fireEvent.change(
        await screen.findByRole("textbox", { name: "Field 1 name" }),
        { target: { value: "region" } },
      );
      await press(/extract data/i);
      break;
    case "chat-with-pdf": {
      const turns = spec.optionsFrom ? 2 : 1;
      let calls = 0;
      // The REAL client, over the stubbed wire. Only the first answer of a
      // two-turn spec is replaced — with a real engine package — so the panel
      // has an exchange to follow up on; its request still went out.
      const runChat: typeof runWorkerChatWithPdf = async (input, options) => {
        calls += 1;
        const sent = await runWorkerChatWithPdf(input, options);
        return calls < turns ? answered(input.question) : sent;
      };
      render(<ChatWithPdfWorkerPanel tool={tool} runChat={runChat} />);
      await drop(bytes, spec.name);
      for (let turn = 1; turn <= turns; turn += 1) {
        fireEvent.change(await screen.findByRole("textbox"), {
          target: { value: `Question ${turn}?` },
        });
        await press(/ask the pdf|send follow-up/i);
        await waitFor(() => expect(network.jobBodies).toHaveLength(turn), {
          timeout: 15_000,
        });
        if (turn < turns)
          await screen.findByText("They are platform notes [p.1].");
      }
      break;
    }
    default:
      throw new Error(`no panel driver for ${spec.tool} — add one here`);
  }
  await waitFor(
    () => expect(network.jobBodies.length).toBe(spec.optionsFrom ? 2 : 1),
    { timeout: 15_000 },
  );
  for (const body of network.jobBodies) expect(body.tool).toBe(spec.tool);
  return network.jobBodies;
}

describe("each AI proof declares what its panel declares for its fixture", () => {
  for (const spec of AI_PROOF_SPECS) {
    it(`${specLabel(spec)}: the harness's declaration is the panel's wire body`, async () => {
      const bytes = await spec.make();
      const harness = await browserAiDeclaration(
        spec.tool,
        bytes,
        harnessExtract,
      );
      expect(harness.kind, JSON.stringify(harness)).toBe("declared");
      if (harness.kind !== "declared") return;

      const bodies = await panelJobBodies(spec, bytes);
      const wire = fields(bodies.at(-1)!);
      // Health: the panel DID declare — equality below is not two undefineds.
      expect(wire.declaredCharacters).toBeGreaterThan(0);
      expect(wire).toEqual(fields(harness.declaration));
      // POSITIVE CONTROL: what the harness sent until 2026-10-09 — nothing —
      // is not what this panel sends.
      expect(fields({})).not.toEqual(wire);
    }, 60_000);
  }

  it("the translate proof's page declaration is the pages WITH TEXT, not the page count", async () => {
    // A counter that declared `pageCount` would agree with the panel on any
    // fixture whose every page has text; this one has a blank page, so it
    // cannot. Health for the mutation that swaps the two.
    const spec = AI_PROOF_SPECS.find((s) => s.tool === "translate-pdf")!;
    const bytes = await spec.make();
    const extracted = await harnessExtract(bytes);
    expect(extracted.pageCount).toBe(PROOF_MEMO_PAGES);
    const harness = await browserAiDeclaration(
      spec.tool,
      bytes,
      harnessExtract,
    );
    expect(harness).toMatchObject({ kind: "declared" });
    if (harness.kind !== "declared") return;
    expect(harness.declaration.declaredTextPages).toBe(1);
    expect(harness.declaration.declaredTextPages).toBeLessThan(
      extracted.pageCount,
    );
  });

  it("refuses to guess for a tool with no panel counter", async () => {
    await expect(
      browserAiDeclaration("compress-pdf", new Uint8Array([1])),
    ).rejects.toThrow(/no browser declaration is known for "compress-pdf"/);
    await expect(
      browserAiDeclaration("constructor", new Uint8Array([1])),
    ).rejects.toThrow(/no browser declaration/);
  });
});

// ── what that buys: one run of every AI proof fits in one day ──────────────

/**
 * The options each spec sends. A follow-up builds its own from the opening
 * answer, so it is built here from a real package whose answer is as long as
 * the builder can carry — the most this spec can put in its options.
 */
async function optionsOf(spec: AiProofSpec): Promise<Record<string, unknown>> {
  if (!spec.optionsFrom) return spec.options ?? {};
  const opening = AI_PROOF_SPECS.find(
    (s) => s.keepArtifactAs === spec.optionsFrom!.artifact,
  )!;
  const question = String(opening.options?.question ?? "");
  return spec.optionsFrom.build(
    await chatPackage(question, "An answer that runs long. ".repeat(200)),
  );
}

/** What `POST /api/jobs` charges one run of every AI proof, by the route's own pricing. */
async function chargeForAllProofs(
  declare: (spec: AiProofSpec, bytes: Uint8Array) => Promise<AiJobDeclaration>,
  /** Does the running worker prove its read cap (`aiReservationFor`)? */
  readCapEnforced = true,
): Promise<number> {
  let total = 0;
  for (const spec of AI_PROOF_SPECS) {
    const declaration = await declare(spec, await spec.make());
    total += aiReservationGiven(
      spec.tool,
      { ...declaration, options: await optionsOf(spec) },
      AI_DELIVERY_LIMITS,
      readCapEnforced,
    ).charge;
  }
  return total;
}

/** The harness's declaration, as `runSpec` makes it. */
async function harnessDeclares(
  spec: AiProofSpec,
  bytes: Uint8Array,
): Promise<AiJobDeclaration> {
  const verdict = await browserAiDeclaration(spec.tool, bytes, harnessExtract);
  if (verdict.kind !== "declared") throw new Error(JSON.stringify(verdict));
  return verdict.declaration;
}

describe("the property the declaration exists for", () => {
  it("one run of every AI proof fits in one day's AI allowance", async () => {
    // A SECOND, independent bound (CLAUDE.md rule 3): not "the declaration is
    // the panel's" — the tests above — but what it COSTS, priced by the
    // route's own function against the allowance the limiter enforces, on a
    // worker that proves its read cap (the only one a per-call declaration
    // is priced for at all).
    const declared = await chargeForAllProofs(harnessDeclares);
    expect(declared).toBeGreaterThan(0);
    expect(declared).toBeLessThanOrEqual(AI_CHARACTER_ALLOWANCE);
  }, 60_000);

  it("POSITIVE CONTROL: the proofs as they shipped — undeclared — did not", async () => {
    const undeclared = await chargeForAllProofs(async () => ({}));
    expect(undeclared).toBeGreaterThan(AI_CHARACTER_ALLOWANCE);
  }, 60_000);

  it("on a worker that does not prove its read cap they still do not — the rotation is still needed", async () => {
    // What the harness's header says, held: the route ignores a per-call
    // declaration there, so the ledger rotation remains the only way all
    // five get proven.
    const unproven = await chargeForAllProofs(harnessDeclares, false);
    expect(unproven).toBeGreaterThan(AI_CHARACTER_ALLOWANCE);
  }, 60_000);
});
