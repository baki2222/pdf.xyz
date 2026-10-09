/**
 * A stand-in for the extraction model that does EXACTLY what the AI Data
 * Extraction engine's system prompt tells it to, from the document text in the
 * request and nothing else. No AI provider is called.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * The production proof of ai-extract failed on 2026-10-09 with "every requested
 * value is null" while the composed chain handed the model the whole table
 * (`workers/ai-extract-read.chain.test.ts`). The proof asked for ONE `region`
 * and ONE `q1` from a table of four regions, and the engine tells the model
 * "When a requested value is not present in the text, use null — never a
 * guess". Four candidates is not one value: any single answer is a guess, and
 * null is the instruction followed. Every fake provider before this one
 * answered with whatever reply its test author typed — `{"region":"North",
 * "q1":1200}` — so the tests agreed with the request instead of asking whether
 * it had an answer.
 *
 * This model answers what the prompt asks of the text it was given:
 *
 *  - it reads the requested fields from the system prompt's own field lines
 *    (`- "name" (type) — description`), so it asks what the engine asked;
 *  - it reads the document from between the user turn's `---` delimiters, so
 *    it sees exactly what was sent — a document cut short gives it fewer rows;
 *  - a field is a table COLUMN whose header matches the field name, ignoring
 *    case; its values are the rows below the header with the header's width;
 *  - an `array` field is answered with every value in the column, in order;
 *    any other field with the column's value only when the column holds
 *    exactly ONE — several candidates for one value is a guess, so null;
 *  - a field with no matching column is null ("not present in the text").
 *
 * It is a model of the INSTRUCTION, not of any vendor's model. It cannot say
 * what a real model returns; it can say whether a request has one right answer
 * that the text supports, which is the property a proof's request needs.
 */
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "@/lib/workers/ai/provider";

/** One requested field as the engine's system prompt states it. */
const FIELD_LINE = /^- "([^"]+)" \(([a-z]+)\)/gm;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

export interface LiteralExtractionModel extends AiProvider {
  /** Every request the engine made, in order. */
  readonly requests: AiCompletionRequest[];
  /** The document text each request carried, cut out of its user turn. */
  readonly documents: string[];
}

/**
 * The document text an extraction request carries: the span between the
 * engine's `---` delimiters in the last user turn. Empty when there is none.
 */
export function documentInExtractionRequest(
  request: AiCompletionRequest,
): string {
  const content = request.messages.at(-1)?.content ?? "";
  const open = "\n---\n";
  const start = content.indexOf(open);
  const end = content.lastIndexOf("\n---");
  return start >= 0 && end > start
    ? content.slice(start + open.length, end)
    : "";
}

/** The fields the system prompt asks for, in order. */
export function requestedFields(
  request: AiCompletionRequest,
): { name: string; type: string }[] {
  return [...(request.system ?? "").matchAll(FIELD_LINE)].map((m) => ({
    name: m[1]!,
    type: m[2]!,
  }));
}

/** The values below the header cell named `name`, or null when no header is. */
function column(document: string, name: string): string[] | null {
  const lines = document
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/));
  for (let h = 0; h < lines.length; h += 1) {
    const header = lines[h]!;
    const c = header.findIndex(
      (cell) => cell.toLowerCase() === name.toLowerCase(),
    );
    if (c < 0) continue;
    const values: string[] = [];
    for (const row of lines.slice(h + 1)) {
      if (row.length !== header.length) break;
      values.push(row[c]!);
    }
    return values;
  }
  return null;
}

function typed(values: string[]): (string | number)[] {
  return values.every((v) => NUMBER.test(v)) ? values.map(Number) : values;
}

/** The reply a model following the engine's instructions to the letter gives. */
export function literalExtraction(
  request: AiCompletionRequest,
): Record<string, unknown> {
  const document = documentInExtractionRequest(request);
  const reply: Record<string, unknown> = {};
  for (const field of requestedFields(request)) {
    const values = column(document, field.name);
    if (values === null || values.length === 0) {
      reply[field.name] = null;
    } else if (field.type === "array") {
      reply[field.name] = typed(values);
    } else {
      // "When a requested value is not present in the text, use null — never
      // a guess." One value asked of a column holding several is a guess.
      reply[field.name] = values.length === 1 ? typed(values)[0] : null;
    }
  }
  return reply;
}

export function literalExtractionModel(): LiteralExtractionModel {
  const requests: AiCompletionRequest[] = [];
  const documents: string[] = [];
  return {
    id: "literal",
    model: "literal-extraction",
    requests,
    documents,
    async complete(request): Promise<AiCompletionResult> {
      requests.push(request);
      documents.push(documentInExtractionRequest(request));
      return {
        ok: true,
        text: JSON.stringify(literalExtraction(request)),
        model: "literal-extraction",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}
