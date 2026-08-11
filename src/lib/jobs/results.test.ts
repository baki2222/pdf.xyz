import { describe, expect, it } from "vitest";
import { hasJobResults, sanitizeJobResults, type JobResults } from "./results";
import {
  OCR_MAX_REPORTED_CHARACTERS,
  OCR_MAX_REPORTED_PAGES,
  buildOcrResultMeta,
  type OcrResultMeta,
} from "./ocr";

/** A representative, valid OCR result-meta a runner produces. */
function ocrMeta(over: Partial<OcrResultMeta> = {}): OcrResultMeta {
  return buildOcrResultMeta({
    engine: "ocrmypdf",
    languages: ["eng", "spa"],
    outputMode: "both",
    producedSearchablePdf: true,
    producedTextSidecar: true,
    pageCount: 3,
    textCharacters: 1_240,
    ...over,
  });
}

describe("hasJobResults", () => {
  it("is false for null/undefined/empty and for all-empty blocks", () => {
    expect(hasJobResults(null)).toBe(false);
    expect(hasJobResults(undefined)).toBe(false);
    expect(hasJobResults({})).toBe(false);
    expect(hasJobResults({ ocr: undefined })).toBe(false);
  });

  it("is true once any block is populated", () => {
    expect(hasJobResults({ ocr: ocrMeta() })).toBe(true);
  });
});

describe("sanitizeJobResults — the redaction/persistence boundary", () => {
  it("normalizes absent/empty input to undefined (never a misleading empty object)", () => {
    expect(sanitizeJobResults(undefined)).toBeUndefined();
    expect(sanitizeJobResults(null)).toBeUndefined();
    expect(sanitizeJobResults({})).toBeUndefined();
    expect(sanitizeJobResults({ ocr: undefined })).toBeUndefined();
    // A non-object slips through the type system from an untrusted source.
    expect(sanitizeJobResults("nope" as unknown as JobResults)).toBeUndefined();
  });

  it("passes a valid OCR block through, schema-stable and intact", () => {
    const clean = sanitizeJobResults({ ocr: ocrMeta() });
    expect(clean?.ocr).toEqual({
      engine: "ocrmypdf",
      languages: ["eng", "spa"],
      outputMode: "both",
      producedSearchablePdf: true,
      producedTextSidecar: true,
      pageCount: 3,
      textCharacters: 1_240,
      meanConfidence: null,
      lowConfidenceWordRatio: null,
      recognizedWords: null,
    });
  });

  it("re-bounds pathological counts at the boundary", () => {
    const clean = sanitizeJobResults({
      ocr: ocrMeta({
        pageCount: OCR_MAX_REPORTED_PAGES + 10_000,
        textCharacters: OCR_MAX_REPORTED_CHARACTERS + 1,
      }),
    });
    expect(clean?.ocr?.pageCount).toBe(OCR_MAX_REPORTED_PAGES);
    expect(clean?.ocr?.textCharacters).toBe(OCR_MAX_REPORTED_CHARACTERS);
  });

  it("re-sanitizes a hostile engine token, collapsing it to the safe `unknown` family", () => {
    // A runner (or a tampered record) tries to smuggle a path + secret through the
    // free-text engine field. It is not EXACTLY a known family, so it degrades to
    // `unknown` — no fragment, path, or secret can survive as the client-facing engine.
    const clean = sanitizeJobResults({
      ocr: {
        ...ocrMeta(),
        engine:
          "/usr/local/bin/ocrmypdf --pass=SECRETVALUE /tmp/pdfxyz-abc/in.pdf",
      } as OcrResultMeta,
    });
    const engine = clean?.ocr?.engine ?? "";
    expect(engine).toBe("unknown");
    expect(engine).not.toContain("/");
    expect(engine).not.toContain(" ");
    expect(engine).not.toContain("SECRETVALUE");
    expect(engine.length).toBeLessThanOrEqual(32);
  });

  it("constrains the client-facing engine to the closed family set (ocrmypdf/tesseract/unknown)", () => {
    const engineOf = (engine: string) =>
      sanitizeJobResults({ ocr: ocrMeta({ engine }) })?.ocr?.engine;
    // Known families pass through verbatim.
    expect(engineOf("ocrmypdf")).toBe("ocrmypdf");
    expect(engineOf("tesseract")).toBe("tesseract");
    // A version, a different engine, or any decorated value collapses to `unknown`
    // rather than laundering a fragment through as a "known" family.
    expect(engineOf("ocrmypdf-16.4.0")).toBe("unknown");
    expect(engineOf("kraken")).toBe("unknown");
    expect(engineOf("ocrmypdfSECRET")).toBe("unknown");
  });

  it("filters languages to the allowlist and drops a smuggled sentence", () => {
    const clean = sanitizeJobResults({
      ocr: {
        ...ocrMeta(),
        languages: [
          "eng",
          "klingon",
          "The account balance is $9,412.55",
        ] as unknown as OcrResultMeta["languages"],
      },
    });
    expect(clean?.ocr?.languages).toEqual(["eng"]);
  });

  it("drops the whole OCR block when the output mode is not from the real contract", () => {
    // An unrecognized discriminant means the block did not come from a real run —
    // reject it whole rather than coerce a value onto the record.
    const clean = sanitizeJobResults({
      ocr: {
        ...ocrMeta(),
        outputMode: "exfiltrate" as unknown as OcrResultMeta["outputMode"],
      },
    });
    expect(clean).toBeUndefined();
  });

  it("nulls counts that contradict the produced artifacts (no phantom output)", () => {
    const clean = sanitizeJobResults({
      ocr: ocrMeta({
        producedSearchablePdf: false,
        producedTextSidecar: false,
        pageCount: 12,
        textCharacters: 999,
      }),
    });
    expect(clean?.ocr?.pageCount).toBeNull();
    expect(clean?.ocr?.textCharacters).toBeNull();
  });

  it("is idempotent — sanitizing an already-clean value changes nothing", () => {
    const once = sanitizeJobResults({ ocr: ocrMeta() });
    const twice = sanitizeJobResults(once);
    expect(twice).toEqual(once);
  });

  it("never lets recognized text, a path, key, URL, or secret survive serialization", () => {
    const TEXT = "SENSITIVE-OCR-TEXT-9f3c recognized on page 1";
    const hostile: JobResults = {
      ocr: {
        // Every free-text-ish field seeded with a distinct leak sentinel.
        engine: `ocrmypdf ${TEXT} /tmp/pdfxyz-xyz/in.pdf`,
        languages: [
          "eng",
          TEXT,
          "s3://bucket/object-key",
          "https://signed.example/url?sig=SECRET",
        ] as unknown as OcrResultMeta["languages"],
        outputMode: "both",
        producedSearchablePdf: true,
        producedTextSidecar: true,
        pageCount: 2,
        textCharacters: 42,
        meanConfidence: null,
        lowConfidenceWordRatio: null,
        recognizedWords: null,
      },
    };
    const serialized = JSON.stringify(sanitizeJobResults(hostile));
    for (const sentinel of [
      TEXT,
      "SENSITIVE",
      "sensitive",
      "/tmp/",
      "s3://",
      "bucket",
      "object-key",
      "https://",
      "signed.example",
      "SECRET",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
    // The engine collapsed to the safe `unknown` family, and the safe structural
    // facts (a valid language, the output mode) still made it through.
    expect(serialized).toContain("unknown");
    expect(serialized).toContain("eng");
    expect(serialized).toContain("both");
  });
});

describe("sanitizeJobResults — the AI window block", () => {
  const window = {
    truncated: true,
    charactersSent: 500_000,
    charactersTotal: 1_600_000,
    totalPages: 400,
    lastCompletePage: 131,
    cutMidPage: true,
  };

  it("carries a valid AI window through to the job record", () => {
    // On its own this is the whole point of the block: without it the counts
    // never reach the browser and the panel has nothing to state.
    const clean = sanitizeJobResults({ ai: { truncation: window } });
    expect(clean?.ai?.truncation).toEqual(window);
  });

  it("drops a block that did not come from the real contract", () => {
    const clean = sanitizeJobResults({
      ai: { truncation: { totalPages: 400 } },
    } as unknown as JobResults);
    expect(clean).toBeUndefined();
  });

  it("refuses to persist a window that contradicts itself", () => {
    // "Nothing was cut" beside "cut mid-page" renders as a confident sentence
    // about nothing. The block is normalized to ONE claim, not six fields.
    const clean = sanitizeJobResults({
      ai: {
        truncation: { ...window, truncated: false },
      },
    });
    expect(clean?.ai?.truncation.cutMidPage).toBe(false);
    expect(clean?.ai?.truncation.charactersSent).toBe(1_600_000);
    expect(clean?.ai?.truncation.lastCompletePage).toBe(400);
  });

  it("never names a page beyond the document's own length", () => {
    const clean = sanitizeJobResults({
      ai: { truncation: { ...window, lastCompletePage: 999 } },
    });
    expect(clean?.ai?.truncation.lastCompletePage).toBe(400);
  });

  it("clamps junk counts instead of persisting them", () => {
    const clean = sanitizeJobResults({
      ai: {
        truncation: {
          ...window,
          charactersTotal: Number.NaN,
          totalPages: -7,
          lastCompletePage: 0,
        },
      },
    });
    expect(clean?.ai?.truncation.charactersTotal).toBe(0);
    expect(clean?.ai?.truncation.totalPages).toBe(0);
    expect(clean?.ai?.truncation.lastCompletePage).toBeNull();
  });
});

describe("sanitizeJobResults — the AI usage block", () => {
  const window = {
    truncated: false,
    charactersSent: 10_000,
    charactersTotal: 10_000,
    totalPages: 3,
    lastCompletePage: 3,
    cutMidPage: false,
  };
  const usage = {
    inputTokens: 8_100,
    outputTokens: 7_400,
    calls: 1,
    model: "gpt-5.6-luna",
  };

  it("carries token counts and their model to the job record", () => {
    // The whole point: until this block existed the counts were produced at
    // every call and thrown away, so the per-page cost of an AI run could not
    // be measured after the fact.
    const clean = sanitizeJobResults({ ai: { truncation: window, usage } });
    expect(clean?.ai?.usage).toEqual(usage);
  });

  it("omits the block when the provider did not report usage", () => {
    // Absent must stay absent rather than becoming zeroes: "not reported" and
    // "reported as free" are different facts, and a costing that averages a
    // fabricated zero moves the price toward nothing.
    const clean = sanitizeJobResults({ ai: { truncation: window } });
    expect(clean?.ai).toBeDefined();
    expect(clean?.ai?.usage).toBeUndefined();
  });

  it("drops usage that cannot be attributed to a model", () => {
    // A token count nobody can price is not a cheap measurement, it is a row
    // that will be averaged into a per-page figure and quietly move it.
    for (const model of ["", "   ", undefined, 42]) {
      const clean = sanitizeJobResults({
        ai: { truncation: window, usage: { ...usage, model } },
      } as unknown as JobResults);
      expect(
        clean?.ai?.usage,
        `usage with model=${JSON.stringify(model)} must not persist`,
      ).toBeUndefined();
      // The rest of the block still survives — losing the price does not lose
      // the disclosure.
      expect(clean?.ai?.truncation.totalPages).toBe(3);
    }
  });

  it("keeps 'no cached tokens reported' distinct from 'zero cached tokens'", () => {
    // Both providers report cached input separately and price it well below a
    // fresh token. Collapsing absent into 0 prices a cache hit as a miss.
    const notReported = sanitizeJobResults({
      ai: { truncation: window, usage },
    });
    expect(notReported?.ai?.usage?.cachedInputTokens).toBeUndefined();
    expect("cachedInputTokens" in (notReported?.ai?.usage ?? {})).toBe(false);

    const reportedZero = sanitizeJobResults({
      ai: { truncation: window, usage: { ...usage, cachedInputTokens: 0 } },
    });
    expect(reportedZero?.ai?.usage?.cachedInputTokens).toBe(0);
  });

  it("clamps junk counts and bounds the model id", () => {
    const clean = sanitizeJobResults({
      ai: {
        truncation: window,
        usage: {
          inputTokens: Number.NaN,
          outputTokens: -12,
          cachedInputTokens: Number.POSITIVE_INFINITY,
          model: "m".repeat(500),
        },
      },
    } as unknown as JobResults);
    expect(clean?.ai?.usage?.inputTokens).toBe(0);
    expect(clean?.ai?.usage?.outputTokens).toBe(0);
    // Infinity is not a number the seam will persist, so it is not "reported".
    expect(clean?.ai?.usage?.cachedInputTokens).toBeUndefined();
    expect(clean?.ai?.usage?.model.length).toBe(100);
  });
});

describe("sanitizeJobResults — the repair block", () => {
  it("carries a recovered repair through to the job record", () => {
    const clean = sanitizeJobResults({
      repair: {
        recoveredWithWarnings: true,
        warnings: ["file is damaged", "reconstructing cross-reference table"],
      },
    });
    expect(clean?.repair?.recoveredWithWarnings).toBe(true);
    expect(clean?.repair?.warnings).toEqual([
      "file is damaged",
      "reconstructing cross-reference table",
    ]);
  });

  it("drops a line that still carries a path, and says how many", () => {
    // Fails CLOSED. A half-scrubbed path is still a leak, so the line goes
    // whole — but silently shrinking the list would read as "nothing was
    // wrong", which is the opposite of what it means.
    const clean = sanitizeJobResults({
      repair: {
        recoveredWithWarnings: true,
        warnings: [
          "/tmp/pdfxyz-structure-ab12/input.pdf: damaged",
          "recovered",
        ],
      },
    });
    expect(clean?.repair?.warnings).toEqual([
      "recovered",
      "1 further message(s) not shown.",
    ]);
  });

  it("still reports a recovery whose every line was dropped", () => {
    // The distinction a repair tool must never blur: "nothing was wrong" and
    // "we cannot tell you what was wrong" are different answers.
    // The separator is built rather than typed: a backslash in a fixture is one
    // careless escape away from not being a separator at all, and the test
    // would then pass for the wrong reason.
    const sep = String.fromCharCode(92);
    const clean = sanitizeJobResults({
      repair: {
        recoveredWithWarnings: true,
        warnings: [`C:${sep}temp${sep}input.pdf: damaged`],
      },
    });
    expect(clean?.repair?.recoveredWithWarnings).toBe(true);
    expect(clean?.repair?.warnings).toEqual([
      "1 further message(s) not shown.",
    ]);
  });

  it("drops a block that did not come from the real contract", () => {
    const clean = sanitizeJobResults({
      repair: { warnings: ["x"] },
    } as unknown as JobResults);
    expect(clean).toBeUndefined();
  });
});

describe("sanitizeJobResults — the compression page check", () => {
  it("carries a justified verdict through", () => {
    const clean = sanitizeJobResults({
      compression: { pageCheck: "verified", pagesIn: 12, pagesOut: 12 },
    });
    expect(clean?.compression).toEqual({
      pageCheck: "verified",
      pagesIn: 12,
      pagesOut: 12,
    });
  });

  it("downgrades a `verified` verdict nothing supports", () => {
    // The whole value of the field is that "verified" means something was
    // checked. A verdict without the numbers that would justify it is the
    // failure this guard exists to stop, not a value to be trusted.
    const clean = sanitizeJobResults({
      compression: { pageCheck: "verified", pagesIn: null, pagesOut: 4 },
    });
    expect(clean?.compression?.pageCheck).toBe("unverified");
  });

  it("downgrades a `verified` verdict the numbers contradict", () => {
    const clean = sanitizeJobResults({
      compression: { pageCheck: "verified", pagesIn: 10, pagesOut: 3 },
    });
    expect(clean?.compression?.pageCheck).toBe("unverified");
  });

  it("never persists a page count of zero", () => {
    // `0` is not a count a comparison can use, and persisting it would let a
    // reader treat "we could not count" as "the document has no pages".
    const clean = sanitizeJobResults({
      compression: { pageCheck: "unverified", pagesIn: 0, pagesOut: -3 },
    });
    expect(clean?.compression?.pagesIn).toBeNull();
    expect(clean?.compression?.pagesOut).toBeNull();
  });

  it("drops a block that did not come from the real contract", () => {
    const clean = sanitizeJobResults({
      compression: { pagesIn: 3 },
    } as unknown as JobResults);
    expect(clean).toBeUndefined();
  });
});

describe("sanitizeJobResults — the PDF/A block", () => {
  it("carries what the conversion removed through to the job record", () => {
    const clean = sanitizeJobResults({
      pdfa: {
        hadNotes: true,
        notes: [
          "Text string detected in DOCINFO cannot be represented in XMP for PDF/A1, discarding DOCINFO",
        ],
      },
    });
    expect(clean?.pdfa?.hadNotes).toBe(true);
    // Not classified, not summarised — Ghostscript's own prose. It changes
    // between versions, and a parser that stopped matching would render an
    // empty list, which reads as "nothing was removed".
    expect(clean?.pdfa?.notes).toEqual([
      "Text string detected in DOCINFO cannot be represented in XMP for PDF/A1, discarding DOCINFO",
    ]);
  });

  it("still reports a conversion whose every note was dropped", () => {
    const clean = sanitizeJobResults({
      pdfa: { hadNotes: true, notes: ["/tmp/x/input.pdf: discarding"] },
    });
    expect(clean?.pdfa?.hadNotes).toBe(true);
    expect(clean?.pdfa?.notes).toEqual(["1 further message(s) not shown."]);
  });

  it("drops a block that did not come from the real contract", () => {
    const clean = sanitizeJobResults({
      pdfa: { notes: ["x"] },
    } as unknown as JobResults);
    expect(clean).toBeUndefined();
  });
});
