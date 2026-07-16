import { describe, expect, it } from "vitest";
import {
  CHAT_ROLES,
  MAX_CONTEXT_TURNS,
  MAX_QUESTION_CHARS,
  MAX_TURN_CHARS,
  chatAnswerOutputName,
  describeChatRequest,
  parseChatOptions,
} from "./chat-with-pdf";

describe("parseChatOptions — question", () => {
  it("rejects a non-object options bag", () => {
    // @ts-expect-error deliberately wrong type
    expect(parseChatOptions([]).ok).toBe(false);
  });

  it("accepts a bounded question and defaults to no conversation context", () => {
    const r = parseChatOptions({ question: "What is the invoice total?" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.question).toBe("What is the invoice total?");
      expect(r.value.context).toBeUndefined();
    }
  });

  it("requires a question (never invents one)", () => {
    const r = parseChatOptions({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.body.error.details?.[0]?.field).toBe("question");
  });

  it("rejects an all-whitespace question", () => {
    const r = parseChatOptions({ question: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.body.error.details?.[0]?.field).toBe("question");
  });

  it("allows newlines/tabs in the question but rejects other control characters", () => {
    expect(parseChatOptions({ question: "Line one\n\tLine two?" }).ok).toBe(true);
    const bad = parseChatOptions({ question: `a${String.fromCharCode(7)}b` });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.body.error.details?.[0]?.field).toBe("question");
  });

  it("rejects an over-long question", () => {
    const r = parseChatOptions({ question: "x".repeat(MAX_QUESTION_CHARS + 1) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.body.error.details?.[0]?.field).toBe("question");
  });
});

describe("parseChatOptions — conversation context", () => {
  it("names the two supported roles", () => {
    expect([...CHAT_ROLES]).toEqual(["user", "assistant"]);
  });

  it("accepts complete user/assistant pairs preceding the question", () => {
    const r = parseChatOptions({
      question: "And the due date?",
      context: [
        { role: "user", content: "What is the invoice number?" },
        { role: "assistant", content: "It is INV-42 [p.1]." },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.context).toHaveLength(2);
  });

  it("rejects a context that is not an array", () => {
    const r = parseChatOptions({ question: "q?", context: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.body.error.details?.[0]?.field).toBe("context");
  });

  it("rejects an unknown turn role", () => {
    const r = parseChatOptions({
      question: "q?",
      context: [{ role: "system", content: "hi" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.body.error.details?.[0]?.field).toContain("context");
  });

  it("rejects an empty or control-character turn", () => {
    expect(
      parseChatOptions({ question: "q?", context: [{ role: "user", content: "  " }] }).ok,
    ).toBe(false);
    expect(
      parseChatOptions({
        question: "q?",
        context: [{ role: "user", content: `a${String.fromCharCode(0)}b` }],
      }).ok,
    ).toBe(false);
  });

  it("rejects context that does not alternate user→assistant", () => {
    const r = parseChatOptions({
      question: "q?",
      context: [
        { role: "assistant", content: "answer first" },
        { role: "user", content: "then ask" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects context that does not end with an assistant turn", () => {
    const r = parseChatOptions({
      question: "q?",
      context: [{ role: "user", content: "dangling user turn" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects too many context turns", () => {
    const context = Array.from({ length: MAX_CONTEXT_TURNS + 2 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i}`,
    }));
    expect(parseChatOptions({ question: "q?", context }).ok).toBe(false);
  });

  it("rejects an over-long turn", () => {
    const r = parseChatOptions({
      question: "q?",
      context: [
        { role: "user", content: "x".repeat(MAX_TURN_CHARS + 1) },
        { role: "assistant", content: "ok" },
      ],
    });
    expect(r.ok).toBe(false);
  });
});

describe("describeChatRequest", () => {
  it("renders human copy for the UI", () => {
    expect(describeChatRequest({ question: "What is the total?" })).toMatch(/question/i);
    expect(
      describeChatRequest({
        question: "And the date?",
        context: [
          { role: "user", content: "q" },
          { role: "assistant", content: "a" },
        ],
      }),
    ).toMatch(/follow-up|context|turn/i);
  });
});

describe("chatAnswerOutputName", () => {
  it("derives an -answer.zip name from the source PDF", () => {
    expect(chatAnswerOutputName("Invoice 42.pdf")).toBe("Invoice 42-answer.zip");
  });

  it("falls back to a neutral stem for unusable names", () => {
    expect(chatAnswerOutputName(null)).toBe("document-answer.zip");
  });
});
