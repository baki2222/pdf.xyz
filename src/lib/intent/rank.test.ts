// @vitest-environment node
/**
 * What the site suggests for a set of files, and why — measured facts in,
 * ranked tools with their evidence out (spec E.3, addendum WP-04 #71).
 *
 * Three kinds of check:
 *
 *  1. A CORPUS of file mixes, each with the top three a person should see.
 *     Written from the priors and boosts in E.3 and checked by hand; a change
 *     to the model that reorders a row must change the row on purpose.
 *  2. The CARRY PROPERTY, over every mix: what a suggestion says it will
 *     carry is exactly what the hand-off gate carries — `carry.eligible`
 *     equals `eligibleFilesFor(slug, files it opens)`, and the ids are what
 *     `handoffPayload` sends. The spec wrote `carry.eligible > 0` for every
 *     suggestion; that cannot hold for a worker or AI tool, which receives
 *     no hand-off until WP-10's stage mode (`eligibleFilesFor` is [] for
 *     them by construction) — and OCR PDF is exactly the tool a scan must be
 *     offered. So the property is split: every suggestion OPENS at least one
 *     file, and it carries one iff its tool can receive a hand-off.
 *  3. The LOCKS: a lock is two verdicts, and only the reader decides which.
 *     Unlock PDF is pinned for any lock; a restricted file stays open to the
 *     pdf.js readers and the workers; only a file that needs a password is
 *     called password-protected.
 */
import { describe, expect, it } from "vitest";
import { eligibleFilesFor, handoffPayload } from "@/lib/handoff";
import type { PdfProbe } from "@/lib/pdf/probe";
import { quickFacts, type FileFacts } from "./facts";
import { renderEvidence } from "./evidence";
import { buildToolIndex } from "./tool-index";
import { holdOrder, RANK_SLUGS, rankForFiles, type RankContext } from "./rank";

const MB = 1024 * 1024;
const index = buildToolIndex();
let seq = 0;

function probe(over: Partial<PdfProbe> = {}): PdfProbe {
  return {
    read: "ok",
    lock: "none",
    pages: 2,
    formFields: 0,
    sample: ["text", "text"],
    ...over,
  };
}

/** A PDF whose bytes were read and probed. */
function pdf(
  name: string,
  over: Partial<PdfProbe> = {},
  size = 200 * 1024,
): FileFacts {
  seq += 1;
  return {
    ...quickFacts({ name, size, type: "application/pdf" }, `id${seq}`),
    bytes: "PDF",
    pdf: { state: "checked", probe: probe(over) },
  };
}

/** Any other file, its bytes agreeing with its name. */
function file(name: string, size = 50 * 1024, type = ""): FileFacts {
  seq += 1;
  const quick = quickFacts({ name, size, type }, `id${seq}`);
  return { ...quick, bytes: quick.format };
}

const scan = (name: string, pages = 1) =>
  pdf(name, {
    pages,
    sample: Array.from({ length: Math.min(3, pages) }, () => "image-only"),
  });

interface Row {
  readonly mix: string;
  readonly files: () => FileFacts[];
  readonly ctx?: RankContext;
  readonly top: readonly string[];
}

const CORPUS: readonly Row[] = [
  {
    mix: "one PDF",
    files: () => [pdf("a.pdf")],
    top: ["compress-pdf", "sign-pdf", "edit-pdf"],
  },
  {
    mix: "two PDFs",
    files: () => [pdf("a.pdf"), pdf("b.pdf")],
    top: ["merge-pdf", "compress-pdf", "sign-pdf"],
  },
  {
    mix: "a scan",
    files: () => [scan("scan.pdf")],
    top: ["ocr-pdf", "compress-pdf", "sign-pdf"],
  },
  {
    mix: "a form (evidence wins a tie over a prior)",
    files: () => [pdf("form.pdf", { formFields: 4 })],
    top: ["fill-forms", "compress-pdf", "sign-pdf"],
  },
  {
    mix: "a large PDF",
    files: () => [pdf("big.pdf", {}, 12 * MB)],
    top: ["compress-pdf", "sign-pdf", "edit-pdf"],
  },
  {
    mix: "a long PDF",
    files: () => [pdf("long.pdf", { pages: 40 })],
    top: ["split-pdf", "compress-pdf", "sign-pdf"],
  },
  {
    mix: "a PDF that needs a password: only Unlock PDF opens it",
    files: () => [
      pdf("locked.pdf", {
        lock: "password-required",
        pages: null,
        formFields: null,
        sample: [],
      }),
    ],
    top: ["unlock-pdf"],
  },
  {
    mix: "a restricted PDF: the pdf-lib writers wait, the rest stay",
    files: () => [
      pdf("statement.pdf", {
        lock: "restricted",
        formFields: null,
        sample: [],
      }),
    ],
    top: ["unlock-pdf", "compress-pdf", "pdf-to-word"],
  },
  {
    mix: "a PDF whose lock could not be told",
    files: () => [
      pdf("odd.pdf", {
        lock: "unknown",
        pages: null,
        formFields: null,
        sample: [],
      }),
    ],
    top: ["unlock-pdf", "pdf-to-word", "protect-pdf"],
  },
  {
    mix: "two PDFs, one locked",
    files: () => [
      pdf("locked.pdf", {
        lock: "password-required",
        pages: null,
        formFields: null,
        sample: [],
      }),
      pdf("open.pdf"),
    ],
    top: ["unlock-pdf", "compress-pdf", "sign-pdf"],
  },
  {
    mix: "an unreadable PDF",
    files: () => [
      pdf("broken.pdf", {
        read: "unreadable",
        pages: null,
        formFields: null,
        sample: [],
      }),
    ],
    top: ["repair-pdf", "pdf-to-word", "protect-pdf"],
  },
  {
    mix: "one JPG",
    files: () => [file("a.jpg")],
    top: ["jpg-to-pdf", "ocr-pdf", "png-to-pdf"],
  },
  {
    mix: "two PNGs",
    files: () => [file("a.png"), file("b.png")],
    top: ["png-to-pdf", "ocr-pdf", "jpg-to-pdf"],
  },
  {
    mix: "a JPG and a PNG",
    files: () => [file("a.png"), file("b.jpg")],
    top: ["jpg-to-pdf", "ocr-pdf", "png-to-pdf"],
  },
  { mix: "a DOCX", files: () => [file("letter.docx")], top: ["word-to-pdf"] },
  { mix: "a DOC", files: () => [file("letter.doc")], top: ["word-to-pdf"] },
  { mix: "an XLSX", files: () => [file("sheet.xlsx")], top: ["excel-to-pdf"] },
  { mix: "a CSV", files: () => [file("data.csv")], top: ["excel-to-pdf"] },
  {
    mix: "a PPTX",
    files: () => [file("deck.pptx")],
    top: ["powerpoint-to-pdf"],
  },
  {
    mix: "a Markdown file",
    files: () => [file("readme.md")],
    top: ["markdown-to-pdf"],
  },
  {
    mix: "a text file",
    files: () => [file("notes.txt")],
    top: ["text-to-pdf"],
  },
  {
    mix: "an HTML file",
    files: () => [file("page.html")],
    top: ["html-to-pdf"],
  },
  {
    mix: "a DOCX and two PDFs",
    files: () => [file("report.docx"), pdf("a.pdf"), pdf("b.pdf")],
    top: ["merge-pdf", "compress-pdf", "word-to-pdf"],
  },
  { mix: "a HEIC photo", files: () => [file("photo.heic")], top: [] },
  {
    mix: "a HEIC and a JPG",
    files: () => [file("photo.heic"), file("photo.jpg")],
    top: ["jpg-to-pdf", "ocr-pdf", "png-to-pdf"],
  },
  {
    mix: "a PNG over the image tools' limit",
    files: () => [file("photo.png", 31 * MB)],
    top: ["ocr-pdf"],
  },
  {
    mix: "three PDFs, one a scan",
    files: () => [pdf("a.pdf"), scan("b.pdf"), pdf("c.pdf")],
    top: ["merge-pdf", "ocr-pdf", "compress-pdf"],
  },
  {
    mix: "one PDF, opened in a dialog on Rotate PDF",
    files: () => [pdf("a.pdf")],
    ctx: { currentTool: "rotate-pdf" },
    top: ["rotate-pdf", "compress-pdf", "sign-pdf"],
  },
  {
    mix: "one PDF, already compressed in this job",
    files: () => [pdf("a.pdf")],
    ctx: { trail: ["compress-pdf"] },
    top: ["sign-pdf", "edit-pdf", "organize-pages"],
  },
  {
    mix: "one PDF, with a watermark step pending",
    files: () => [pdf("a.pdf")],
    ctx: { pending: "watermark-pdf" },
    top: ["watermark-pdf", "compress-pdf", "sign-pdf"],
  },
];

describe("rankForFiles: the corpus", () => {
  it("is large enough to mean something (health)", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(20);
  });

  it.each(CORPUS.map((row) => [row.mix, row] as const))("%s", (_, row) => {
    const ranking = rankForFiles(row.files(), index, row.ctx);
    expect(ranking.top.map((s) => s.slug)).toEqual(row.top);
  });
});

describe("the carry property, over every mix", () => {
  it("every suggestion opens a file; it carries exactly what the gate carries", () => {
    let checked = 0;
    let carrying = 0;
    let notCarrying = 0;
    for (const row of CORPUS) {
      const facts = row.files();
      const files = facts.map((f) => new File(["x"], f.name, { type: f.type }));
      const fileById = new Map(facts.map((f, i) => [f.id, files[i]!]));
      const { top, more } = rankForFiles(facts, index, row.ctx);
      for (const s of [...top, ...more]) {
        checked += 1;
        const opens = s.opens.map((id) => fileById.get(id)!);
        expect(
          opens.length,
          `${row.mix}: ${s.slug} opens nothing`,
        ).toBeGreaterThan(s.blocked ? -1 : 0);
        expect(s.carry.eligible, `${row.mix}: ${s.slug}`).toBe(
          eligibleFilesFor(s.slug, opens).length,
        );
        expect(
          s.carry.ids.map((id) => fileById.get(id)!.name),
          `${row.mix}: ${s.slug}`,
        ).toEqual(handoffPayload(s.slug, opens).map((f) => f.name));
        const entry = index.find((t) => t.slug === s.slug)!;
        expect(s.carry.eligible > 0, `${row.mix}: ${s.slug}`).toBe(
          entry.handoffMode !== "none" && opens.length > 0,
        );
        if (s.carry.eligible > 0) carrying += 1;
        else notCarrying += 1;
      }
    }
    // Health: the property ran over both kinds of suggestion, many times.
    expect(checked).toBeGreaterThanOrEqual(100);
    expect(carrying).toBeGreaterThan(0);
    expect(notCarrying).toBeGreaterThan(0);
  });

  it("a one-file tool offered several files says which one it takes", () => {
    const [a, b] = [pdf("first.pdf"), pdf("second.pdf")];
    const sign = rankForFiles([a, b], index)
      .top.concat(rankForFiles([a, b], index).more)
      .find((s) => s.slug === "sign-pdf")!;
    expect(sign.carry.ids).toEqual([a.id]);
    expect(sign.evidence.map(renderEvidence)).toContain(
      "takes one file — first.pdf",
    );
  });

  /**
   * FOUND IN THE VISUAL PASS (2026-10-09): with contract.pdf and a form,
   * annex.pdf, staged in that order, Fill forms said "annex.pdf has 4 form
   * fields" and its launch carried contract.pdf — a one-file tool takes the
   * first file it opens, and the file that justified it was second. The file
   * a boost names goes first, so the row carries what it says.
   */
  it("a boosted one-file tool carries the file its evidence names", () => {
    const contract = pdf("contract.pdf", { pages: 12 });
    const annex = pdf("annex.pdf", { pages: 3, formFields: 4 });
    const all = (r: ReturnType<typeof rankForFiles>) => [...r.top, ...r.more];
    const fill = all(rankForFiles([contract, annex], index)).find(
      (s) => s.slug === "fill-forms",
    )!;
    expect(fill.evidence.map(renderEvidence)[0]).toBe(
      "annex.pdf has 4 form fields",
    );
    expect(fill.carry.ids).toEqual([annex.id]);
    // INVERTED (2026-10-09, second visual pass): this asserted the row said
    // "annex.pdf has 4 form fields · takes one file — annex.pdf", naming the
    // file twice in one line. When the fact before it already names the file
    // it takes, the row says so without repeating the name.
    const words = fill.evidence.map(renderEvidence);
    expect(words).toContain("takes only that file");
    expect(words).not.toContain("takes one file — annex.pdf");
    // Control: with no boost, the first file it opens is the one it takes,
    // and since no fact names it, the row does.
    const split = all(rankForFiles([contract, annex], index)).find(
      (s) => s.slug === "split-pdf",
    )!;
    expect(split.carry.ids).toEqual([contract.id]);
    expect(split.evidence.map(renderEvidence)).toContain(
      "takes one file — contract.pdf",
    );
  });

  /**
   * The same shape through the pins (found while fixing the boost): with a
   * plain PDF staged before a locked one, Unlock PDF's row said "locked.pdf
   * needs a password to open" and listed plain.pdf first in what it opens —
   * Unlock opens both. Repair PDF the same with a broken file second.
   *
   * No visitor receives the wrong file TODAY: neither tool has a browser
   * runner, so neither receives a hand-off (`carry` is empty, by the gate's
   * own rule, asserted below rather than assumed). `opens` is the order a
   * carry takes — and WP-10's stage mode will — so the file the pin names
   * goes first now, before a runner makes the order visible.
   */
  it("a pinned tool opens the file its pin names first", () => {
    const all = (r: ReturnType<typeof rankForFiles>) => [...r.top, ...r.more];
    const plain = pdf("plain.pdf");
    const locked = pdf("locked.pdf", {
      lock: "password-required",
      pages: null,
      formFields: null,
      sample: [],
    });
    const unlock = all(rankForFiles([plain, locked], index)).find(
      (s) => s.slug === "unlock-pdf",
    )!;
    expect(unlock.pinned).toBe("lock");
    expect(unlock.evidence.map(renderEvidence)[0]).toBe(
      "locked.pdf needs a password to open",
    );
    // Health: it opens both, so the order is a real choice.
    expect([...unlock.opens].sort()).toEqual([plain.id, locked.id].sort());
    expect(unlock.opens[0]).toBe(locked.id);
    expect(unlock.carry.ids).toEqual(
      unlock.tool.handoffMode === "none" ? [] : [locked.id],
    );

    const ok = pdf("ok.pdf");
    const broken = pdf("broken.pdf", {
      read: "unreadable",
      pages: null,
      formFields: null,
      sample: [],
    });
    const repair = all(rankForFiles([ok, broken], index)).find(
      (s) => s.slug === "repair-pdf",
    )!;
    expect(repair.pinned).toBe("repair");
    expect([...repair.opens].sort()).toEqual([ok.id, broken.id].sort());
    expect(repair.opens[0]).toBe(broken.id);
    expect(repair.carry.ids).toEqual(
      repair.tool.handoffMode === "none" ? [] : [broken.id],
    );
  });

  it("a file no tool opens has its own note, and does not count against every tool", () => {
    const merge = rankForFiles(
      [pdf("a.pdf"), pdf("b.pdf"), file("photo.heic")],
      index,
    ).top[0]!;
    expect(merge.slug).toBe("merge-pdf");
    expect(merge.evidence.map(renderEvidence).join(" ")).not.toMatch(
      /opens \d+ of your/,
    );
  });

  it("a mixed drop says how many of the files a tool opens", () => {
    const merge = rankForFiles(
      [file("report.docx"), pdf("a.pdf"), pdf("b.pdf")],
      index,
    ).top[0]!;
    expect(merge.evidence.map(renderEvidence)).toContain(
      "opens 2 of your 3 files",
    );
  });
});

describe("evidence: each boost shows the fact behind it", () => {
  const say = (facts: FileFacts[], slug: string) => {
    const r = rankForFiles(facts, index);
    return [...r.top, ...r.more]
      .find((s) => s.slug === slug)!
      .evidence.map(renderEvidence);
  };

  it("a scan: OCR PDF shows which pages have no selectable text, and when the file moves", () => {
    // OCR PDF runs on a worker: it cannot receive the file yet (WP-10's
    // stage mode), so its row says the file is added there, and when it
    // moves.
    expect(say([scan("scan.pdf")], "ocr-pdf")).toEqual([
      "No selectable text on page 1",
      "you'll add scan.pdf there",
      "uploads only when you start it",
    ]);
    expect(say([scan("scan.pdf", 5)], "ocr-pdf")[0]).toBe(
      "No selectable text on pages 1–3",
    );
  });

  it("a form, a large file, a long file", () => {
    expect(say([pdf("annex.pdf", { formFields: 4 })], "fill-forms")[0]).toBe(
      "annex.pdf has 4 form fields",
    );
    expect(say([pdf("big.pdf", {}, 12 * MB)], "compress-pdf")[0]).toMatch(
      /^big\.pdf is 12\.0 MB$/,
    );
    expect(say([pdf("long.pdf", { pages: 40 })], "split-pdf")[0]).toBe(
      "long.pdf has 40 pages",
    );
  });

  it("two PDFs: Merge PDF counts them and their pages", () => {
    expect(
      say([pdf("a.pdf"), pdf("b.pdf", { pages: 3 })], "merge-pdf"),
    ).toEqual(["2 PDFs", "5 pages"]);
  });

  it("no measured fact, no boost: an unprobed PDF earns no OCR evidence", () => {
    const pending = quickFacts(
      { name: "a.pdf", size: 1000, type: "application/pdf" },
      "pending",
    );
    const r = rankForFiles([pending], index);
    expect(r.top.map((s) => s.slug)).toEqual([
      "compress-pdf",
      "sign-pdf",
      "edit-pdf",
    ]);
    const all = [...r.top, ...r.more].flatMap((s) =>
      s.evidence.map(renderEvidence),
    );
    expect(all.join("\n")).not.toMatch(/selectable|form field|pages? \d/);
  });
});

describe("locks: two verdicts, read from the probe", () => {
  const locked = (lock: PdfProbe["lock"]) =>
    pdf("contract.pdf", { lock, pages: null, formFields: null, sample: [] });

  it("Unlock PDF is pinned first for every lock, with the lock's own words", () => {
    for (const lock of [
      "password-required",
      "restricted",
      "unknown",
    ] as const) {
      const first = rankForFiles([locked(lock)], index).top[0]!;
      expect(first.slug, lock).toBe("unlock-pdf");
      const words = first.evidence.map(renderEvidence);
      if (lock === "password-required")
        expect(words[0]).toBe("contract.pdf needs a password to open");
      else expect(words.join(" "), lock).not.toMatch(/password/i);
    }
  });

  it("a restricted file stays open to the pdf.js readers and the workers; the writers wait for Unlock PDF", () => {
    const r = rankForFiles([locked("restricted")], index);
    const all = [...r.top, ...r.more];
    const by = (slug: string) => all.find((s) => s.slug === slug)!;
    for (const slug of [
      "pdf-to-jpg",
      "pdf-to-png",
      "pdf-to-text",
      "pdf-to-markdown",
      "pdf-to-word",
      "compress-pdf",
    ])
      expect(by(slug).blocked, slug).toBeNull();
    for (const slug of ["merge-pdf", "rotate-pdf", "sign-pdf", "edit-pdf"]) {
      expect(by(slug).blocked, slug).toBe("unlock-first");
      expect(r.top.map((s) => s.slug)).not.toContain(slug);
      expect(by(slug).evidence.map(renderEvidence)).toContain(
        "after Unlock PDF",
      );
    }
  });

  it("a file that needs a password is opened by Unlock PDF alone", () => {
    const r = rankForFiles([locked("password-required")], index);
    expect(r.top.map((s) => s.slug)).toEqual(["unlock-pdf"]);
    expect(r.more.every((s) => s.blocked === "unlock-first")).toBe(true);
    expect(r.more.length).toBeGreaterThan(10);
  });
});

describe("notes: what the ranking cannot offer, said", () => {
  const notes = (facts: FileFacts[]) => rankForFiles(facts, index).notes;

  it("a format no tool opens gets the /tools answer", () => {
    expect(notes([file("photo.heic")]).map((n) => n.kind)).toEqual([
      "unsupported",
    ]);
    // Two of the same format: one answer, not two.
    expect(notes([file("a.heic"), file("b.heic")])).toHaveLength(1);
  });

  it("a file over a tool's limit names it; within every limit, no note", () => {
    const [over] = notes([file("photo.png", 31 * MB)]);
    expect(over).toMatchObject({
      kind: "over-ceiling",
      name: "photo.png",
      tools: ["JPG to PDF", "PNG to PDF"],
    });
    expect(notes([file("photo.png", 1 * MB)])).toEqual([]);
  });

  it("a file whose bytes contradict its name opens nowhere, and is said to", () => {
    const renamed: FileFacts = {
      ...quickFacts({ name: "report.pdf", size: 900, type: "" }, "r"),
      bytes: "PNG",
      contradicted: true,
      pdf: null,
    };
    const r = rankForFiles([renamed], index);
    expect([...r.top, ...r.more]).toEqual([]);
    expect(r.notes).toEqual([
      { kind: "contradicted", name: "report.pdf", named: "PDF", actual: "PNG" },
    ]);
  });

  it("a file nothing recognises", () => {
    expect(notes([file("data.weird")])).toEqual([
      { kind: "unrecognised", name: "data.weird" },
    ]);
  });
});

describe("context", () => {
  it("recents break ties and nothing more", () => {
    const facts = [pdf("a.pdf")];
    const plain = rankForFiles(facts, index);
    const recent = rankForFiles(facts, index, { recents: ["pdf-to-text"] });
    expect(recent.top.map((s) => s.slug)).toEqual(plain.top.map((s) => s.slug));
    const order = (r: typeof plain) => [...r.top, ...r.more].map((s) => s.slug);
    // Among the tools on the "any other" prior, the recent one leads.
    const tens = order(plain).filter((slug) =>
      ["pdf-to-png", "pdf-to-text", "pdf-to-markdown"].includes(slug),
    );
    expect(tens[0]).not.toBe("pdf-to-text");
    expect(
      order(recent).filter((slug) =>
        ["pdf-to-png", "pdf-to-text", "pdf-to-markdown"].includes(slug),
      )[0],
    ).toBe("pdf-to-text");
  });

  it("is deterministic", () => {
    const facts = [file("report.docx"), pdf("a.pdf"), scan("b.pdf")];
    expect(rankForFiles(facts, index)).toEqual(rankForFiles(facts, index));
  });
});

describe("the model's own names", () => {
  it("every slug it names is a catalogue tool (both tables and the pins)", () => {
    const slugs = new Set(index.map((t) => t.slug));
    expect(RANK_SLUGS.length).toBeGreaterThanOrEqual(15);
    expect(RANK_SLUGS.filter((slug) => !slugs.has(slug))).toEqual([]);
  });
});

describe("holdOrder: rows stay where a person last saw them", () => {
  const rows = (...slugs: string[]) => slugs.map((slug) => ({ slug }));

  it("keeps the shown order for rows already shown, new rows after in rank order", () => {
    expect(
      holdOrder(["b", "a"], rows("a", "c", "b")).map((r) => r.slug),
    ).toEqual(["b", "a", "c"]);
  });

  it("drops rows that left, and with nothing shown yet it is the ranking", () => {
    expect(holdOrder(["x", "a"], rows("a", "b")).map((r) => r.slug)).toEqual([
      "a",
      "b",
    ]);
    expect(holdOrder([], rows("a", "b")).map((r) => r.slug)).toEqual([
      "a",
      "b",
    ]);
  });
});
