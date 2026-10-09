// @vitest-environment node
/**
 * The ranked search's rules, each on documents built for the rule — not on
 * the catalogue, whose words change. What the catalogue search returns for
 * what people type is the corpus in `tools.test.ts`; this file pins the
 * mechanics that corpus relies on, each with the case that would break.
 */
import { describe, expect, it } from "vitest";
import {
  buildIndex,
  nearest,
  search,
  toolDocs,
  wordsOf,
  type SearchDoc,
} from "./search";

const doc = (id: string, name: string, more: Partial<SearchDoc> = {}) =>
  ({ kind: "tool", id, name, ...more }) as const satisfies SearchDoc;

const DOCS: SearchDoc[] = [
  doc("merge", "Merge PDF", { keywords: ["combine pdf"] }),
  doc("rotate", "Rotate PDF", { description: "Turn pages upright." }),
  doc("webpage", "Webpage to PDF", { formats: ["URL", "PDF"] }),
  doc("word-out", "PDF to Word", { formats: ["PDF", "DOCX"] }),
  doc("word-in", "Word to PDF", { formats: ["DOCX", "DOC", "PDF"] }),
  doc("chat", "Chat with PDF"),
  { kind: "guide", id: "guide-merge", name: "How to merge PDF files" },
];

const ids = (query: string, index = buildIndex(DOCS)) =>
  search(index, query).results.map((d) => d.id);

describe("wordsOf", () => {
  it("folds accents, case and plurals, and keeps slash pairs whole too", () => {
    expect(wordsOf("Résumé PDFs")).toEqual(["resume", "pdf"]);
    expect(wordsOf("PDF/A")).toEqual(["pdf", "a", "pdfa"]);
    // Not "-ss" words, not short words.
    expect(wordsOf("compress has")).toEqual(["compress", "has"]);
  });

  it("finds no words in punctuation", () => {
    expect(wordsOf("??? —")).toEqual([]);
  });
});

describe("modes", () => {
  it("a blank query is every document in order; no words is empty", () => {
    expect(search(buildIndex(DOCS), "  ")).toMatchObject({
      mode: "all",
      results: DOCS,
    });
    expect(search(buildIndex(DOCS), "???")).toMatchObject({
      mode: "empty",
      results: [],
    });
  });

  it("'all' needs every token; 'closest' takes any, most tokens first", () => {
    const index = buildIndex(DOCS);
    expect(search(index, "merge pdf").mode).toBe("all");
    const fallback = search(index, "merge rotate");
    expect(fallback.mode).toBe("closest");
    expect(
      fallback.results
        .map((d) => d.id)
        .slice(0, 2)
        .sort(),
    ).toEqual(["merge", "rotate"]);
  });

  it("'closest' needs evidence: a token most documents match qualifies nobody alone", () => {
    // "pdf" is in nearly every name. "pdf zzqx" falling back to every PDF
    // document would be a list, not an answer.
    expect(search(buildIndex(DOCS), "pdf zzqx")).toMatchObject({
      mode: "empty",
      results: [],
    });
  });
});

describe("matching", () => {
  it("a word prefix matches, so typing narrows on every keystroke", () => {
    expect(ids("rot")[0]).toBe("rotate");
    // A short token only as the LAST word (the one still being typed).
    expect(ids("ro")[0]).toBe("rotate");
    expect(search(buildIndex(DOCS), "ro pdf").mode).not.toBe("all");
  });

  it("a format token is never a prefix: 'webp' is not 'webpage', 'doc' is not 'docx'", () => {
    expect(ids("webp")).not.toContain("webpage");
    // Control: the word itself, and a non-format prefix of it, do match.
    expect(ids("webpage")[0]).toBe("webpage");
    expect(ids("webpa")[0]).toBe("webpage");
    // (No synonyms here: the word group joins "doc" and "docx" on purpose.)
    const docx = buildIndex([doc("x", "Docx Thing")], { synonyms: [] });
    expect(search(docx, "doc").results).toEqual([]);
    expect(search(docx, "docx").results).toHaveLength(1);
  });

  it("formats match by the format, any spelling", () => {
    // "jpeg" and "jpg" are one format; the formats field takes nothing else.
    const index = buildIndex([doc("img", "Thing", { formats: ["JPG"] })]);
    expect(search(index, "jpeg").results).toHaveLength(1);
    expect(search(index, "jp").results).toHaveLength(0);
  });

  it("one edit away matches for words of five letters or more, a swap counting as one", () => {
    expect(ids("mrege")[0]).toBe("merge");
    expect(ids("rotaet")[0]).toBe("rotate");
    // Four letters is too short to guess at.
    expect(ids("chta")).toEqual([]);
  });

  it("a synonym group matches its peers, and a phrase collapses to its head", () => {
    const groups = [
      ["rotate", "flip"],
      ["webpage", "web page"],
    ];
    const index = buildIndex(DOCS, { synonyms: groups });
    expect(search(index, "flip").results[0]?.id).toBe("rotate");
    expect(search(index, "web page").results[0]?.id).toBe("webpage");
    // Control: without the group, no match.
    expect(search(buildIndex(DOCS, { synonyms: [] }), "flip").results).toEqual(
      [],
    );
  });
});

describe("ranking", () => {
  it("the query's order tells 'pdf word' from 'word pdf'", () => {
    expect(ids("pdf word")[0]).toBe("word-out");
    expect(ids("word pdf")[0]).toBe("word-in");
  });

  it("'to' names the target, when the name's source agrees", () => {
    expect(ids("pdf to word")[0]).toBe("word-out");
    expect(ids("word to pdf")[0]).toBe("word-in");
  });

  it("a whole name, stopwords included, ranks its document first", () => {
    expect(ids("chat with pdf")[0]).toBe("chat");
  });

  it("a keyword phrase, word for word, ranks its document first", () => {
    expect(ids("combine pdf")[0]).toBe("merge");
  });
});

describe("options", () => {
  it("kinds filters before ranking; limit caps the list", () => {
    const index = buildIndex(DOCS);
    expect(
      search(index, "merge", { kinds: ["guide"] }).results.map((d) => d.id),
    ).toEqual(["guide-merge"]);
    expect(search(index, "pdf", { limit: 2 }).results).toHaveLength(2);
  });
});

describe("unsupported formats", () => {
  it("a token naming a format nothing opens is reported", () => {
    const index = buildIndex(DOCS);
    expect(search(index, "heic").unsupported).toBe("HEIC");
    expect(search(index, "convert heic to pdf").unsupported).toBe("HEIC");
    expect(search(index, "merge pdf").unsupported).toBeNull();
  });
});

describe("nearest", () => {
  it("offers names within two edits for an empty result, and nothing for noise", () => {
    const index = buildIndex(DOCS);
    expect(search(index, "mregee").mode).toBe("empty");
    expect(nearest(index, "mregee").map((d) => d.id)).toEqual([
      "merge",
      "guide-merge",
    ]);
    expect(nearest(index, "zzzz")).toEqual([]);
  });
});

describe("toolDocs", () => {
  it("carries the tool, its formats both ways, and the tasks that name it", () => {
    const tool = {
      slug: "compress-pdf",
      name: "Compress PDF",
      tagline: "t",
      description: "d",
      keywords: ["shrink pdf"],
      accept: ["PDF"],
      outputs: ["PDF", "ZIP"],
    };
    const [made] = toolDocs(
      [tool],
      [
        { label: "Make a PDF smaller", slug: "compress-pdf" },
        { label: "Combine PDFs", slug: "merge-pdf" },
      ],
    );
    expect(made).toMatchObject({
      kind: "tool",
      id: "compress-pdf",
      aliases: ["Make a PDF smaller"],
      formats: ["PDF", "PDF", "ZIP"],
      tool,
    });
  });
});
