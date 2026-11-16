// @vitest-environment node
/**
 * The common-character corpora, held to bounds that do not come from the
 * derivation itself: the published set sizes, named members, and a broken
 * decoder that must be FATAL rather than a quietly smaller corpus.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commonCorpus,
  CORPUS_COUNTS,
  CorpusDecodeError,
  corpusBody,
  gb2312Level1,
  jisKana,
  jisX0208Level1,
  ksX1001Hangul,
} from "./cjk-common-corpus";
import { classifyRadical, judgeCorpusRead } from "./cjk-corpus-read";
import type { RadicalGlyphFacts } from "./radical-equivalents";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the derived corpora", () => {
  it("health: the exact published counts — GB2312 L1 3,755, JIS X 0208 L1 2,965 (+83 hiragana, 86 katakana), KS X 1001 Hangul 2,350", () => {
    expect(gb2312Level1().length).toBe(3755);
    expect(jisX0208Level1().length).toBe(2965);
    expect(jisKana().length).toBe(83 + 86);
    expect(ksX1001Hangul().length).toBe(2350);
    expect(CORPUS_COUNTS).toEqual({
      gb2312Level1: 3755,
      jisX0208Level1: 2965,
      hiragana: 83,
      katakana: 86,
      ksX1001Hangul: 2350,
    });
    expect(commonCorpus("zh").chars.length).toBe(3755);
    expect(commonCorpus("ja").chars.length).toBe(2965 + 169);
    expect(commonCorpus("ko").chars.length).toBe(2350);
  });

  it("members: 门 车 马 (the production misreads) are in zh; the set ends and starts where GB2312 says", () => {
    const zh = gb2312Level1();
    for (const ch of ["门", "车", "马", "贝", "见", "鱼", "胶"])
      expect(zh, ch).toContain(ch);
    expect(zh[0]).toBe("啊"); // 0xB0A1
    expect(zh.at(-1)).toBe("座"); // 0xD7F9
    const ja = jisX0208Level1();
    expect(ja[0]).toBe("亜"); // 0x889F / EUC 0xB0A1
    expect(ja.at(-1)).toBe("腕"); // EUC 0xCFD3
    for (const ch of ["長", "黄", "歯", "竜"]) expect(ja, ch).toContain(ch);
    const kana = jisKana();
    expect(kana[0]).toBe("ぁ");
    expect(kana.at(-1)).toBe("ヶ");
    const ko = ksX1001Hangul();
    expect(ko[0]).toBe("가");
    expect(ko.at(-1)).toBe("힝");
  });

  it("every member is distinct and in its script's block", () => {
    for (const l of ["zh", "ja", "ko"] as const) {
      const { chars } = commonCorpus(l);
      expect(new Set(chars).size, l).toBe(chars.length);
    }
    expect(gb2312Level1().filter((c) => !/^[一-鿿]$/.test(c))).toEqual([]);
    expect(ksX1001Hangul().filter((c) => !/^[가-힣]$/.test(c))).toEqual([]);
  });

  it("POSITIVE CONTROL: a broken decoder (all U+FFFD) is FATAL, not a smaller corpus", () => {
    class Broken {
      decode() {
        return "�";
      }
    }
    vi.stubGlobal("TextDecoder", Broken);
    expect(() => gb2312Level1()).toThrow(CorpusDecodeError);
    expect(() => jisX0208Level1()).toThrow(/decoded to/);
    expect(() => ksX1001Hangul()).toThrow(CorpusDecodeError);
  });

  it("POSITIVE CONTROL: a decoder label the runtime lacks is FATAL", () => {
    class Missing {
      constructor() {
        throw new RangeError("unsupported");
      }
    }
    vi.stubGlobal("TextDecoder", Missing);
    expect(() => gb2312Level1()).toThrow(/no gbk decoder/);
  });

  it("the body is every character once, whitespace-separated, so a reader's output aligns position by position", () => {
    const chars = gb2312Level1();
    const body = corpusBody(chars);
    expect([...body.replace(/\s/g, "")]).toEqual(chars);
  });
});

describe("the corpus judge", () => {
  const corpus = {
    language: "zh" as const,
    name: "t",
    chars: ["门", "开", "胶"],
  };
  const facts: RadicalGlyphFacts = {
    faces: {
      F: { "2ed4": "95e8", "2e95": "", "2f3e": "6236 6237" },
    },
  };

  it("a clean read passes; pdftotext must be exact", () => {
    expect(
      judgeCorpusRead(corpus, "门 开\n胶", "门开胶", ["F"], facts).failures,
    ).toEqual([]);
    const p = judgeCorpusRead(corpus, "门 开", "门开胶", ["F"], facts);
    expect(p.failures.join()).toMatch(/pdftotext read 2 characters for 3/);
  });

  it("a radical whose one sharer should have been rewritten FAILS; a different real character FAILS", () => {
    const r = judgeCorpusRead(corpus, "门开胶", "⻔开㬵", ["F"], facts);
    expect(r.viewer!.misreads.map((m) => [m.expected, m.kind])).toEqual([
      ["门", "radical, should have been rewritten"],
      ["胶", "different character"],
    ]);
    expect(r.failures.length).toBe(1);
    expect(r.failures[0]).toMatch(/misread 2/);
  });

  it("a radical with no sharer, or several, is reported and allowed; one the facts do not measure fails", () => {
    expect(classifyRadical(0x2e95, ["F"], facts)).toBe("radical, no sharer");
    expect(classifyRadical(0x2f3e, ["F"], facts)).toBe(
      "radical, several sharers",
    );
    expect(classifyRadical(0x2ed5, ["F"], facts)).toBe("radical, not measured");
    expect(classifyRadical(0x2ed4, ["NotInFacts"], facts)).toBe(
      "radical, not measured",
    );
    const allowed = judgeCorpusRead(corpus, "门开胶", "门开⺕", ["F"], facts);
    expect(allowed.viewer!.misreads.length).toBe(1);
    expect(allowed.failures).toEqual([]);
  });

  it("an unaligned pdf.js read fails", () => {
    const r = judgeCorpusRead(corpus, "门开胶", "门开", ["F"], facts);
    expect(r.failures.join()).toMatch(/pdf\.js read 2 characters for 3/);
  });
});
