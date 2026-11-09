// @vitest-environment node
/**
 * The pick check a worker panel runs on facts the SERVER computed
 * (`pickFactsFor`, handed over in `toolRunInfoFor`) says exactly what it said
 * when the browser computed them, for every worker tool.
 *
 * Until 2026-11-09 (perf/per-tool-first-load) `pickRefusal` computed the
 * ceiling in the browser (`fileOverCeilingMessage` → `toolFileCeilingBytes`:
 * every runner kind's ceiling and every worker engine's tool list) and the
 * converter over the whole tool directory, on every worker page's first
 * load. The facts now arrive as data, so what must not change is the answer:
 *
 *  - the ceiling equals the one the page states (`toolFileCeilingBytes`) AND,
 *    independently, the one the upload API refuses above
 *    (`workerFileCeilingBytes`) — two paths, so a wrong number in one shows;
 *  - the size refusal is byte-identical to `fileOverCeilingMessage`, and
 *    pinned as words for one tool, so the shared phrasing cannot drift both
 *    ways at once;
 *  - a wrong-kind file names the same converter the directory names, for a
 *    file of every extension the format table knows.
 *
 * The worker tools are DISCOVERED from the routes the tool page indexes
 * (`WORKER_PANEL_ROUTES`), never typed.
 */
import { describe, expect, it } from "vitest";
import { WORKER_PANEL_ROUTES } from "@/components/tools/worker-panels";
import { EXTENSIONS_BY_FORMAT } from "@/lib/jobs/mime-by-format";
import { getToolBySlug } from "@/lib/tools";
import {
  fileOverCeilingMessage,
  toolFileCeilingBytes,
} from "@/lib/tools/file-ceilings";
import { getToolInputKind } from "@/lib/jobs/tool-capability";
import { workerFileCeilingBytes } from "@/lib/workers/engine-file-ceilings";
import { pickRefusal, toolTakesFile } from "./pick-check";
import { converterToPdfFor, pickFactsFor } from "./pick-facts";

const WORKER_TOOLS = WORKER_PANEL_ROUTES.flatMap((route) => route.slugs).map(
  (slug) => {
    const tool = getToolBySlug(slug);
    if (!tool) throw new Error(`routed slug ${slug} is not in the catalogue`);
    return tool;
  },
);

const EXTENSIONS = Object.values(EXTENSIONS_BY_FORMAT).flat();

describe("pick facts computed on the server", () => {
  it("health check: every routed worker tool, and every extension", () => {
    expect(WORKER_TOOLS.length).toBeGreaterThanOrEqual(19);
    expect(EXTENSIONS.length).toBeGreaterThanOrEqual(25);
  });

  it.each(WORKER_TOOLS.map((t) => [t.slug, t] as const))(
    "%s: the ceiling is the page's and the upload API's",
    (slug, tool) => {
      const facts = pickFactsFor(tool);
      expect(facts.ceilingBytes).toBe(toolFileCeilingBytes(tool));
      if (getToolInputKind(slug) === "url") {
        expect(facts.ceilingBytes).toBeNull();
        return;
      }
      expect(facts.ceilingBytes).toBe(workerFileCeilingBytes(slug));
      const bytes = facts.ceilingBytes!;
      const file = (size: number) => ({
        name: `f.${tool.accept[0]!.toLowerCase()}`,
        type: "",
        size,
      });
      expect(pickRefusal(tool, file(bytes), facts)).toBeNull();
      expect(pickRefusal(tool, file(bytes + 1), facts)).toBe(
        fileOverCeilingMessage(tool, bytes + 1),
      );
    },
  );

  it.each(WORKER_TOOLS.map((t) => [t.slug, t] as const))(
    "%s: a wrong file names the converter the directory names",
    (slug, tool) => {
      const facts = pickFactsFor(tool);
      for (const ext of EXTENSIONS) {
        const file = { name: `letter.${ext}`, type: "", size: 1 };
        if (toolTakesFile(tool, file)) continue;
        const converter = tool.accept.includes("PDF")
          ? converterToPdfFor(file.name)
          : undefined;
        const said = pickRefusal(tool, file, facts)!;
        if (converter && converter.slug !== slug)
          expect(said, `${slug} ${ext}`).toContain(
            ` Turn it into a PDF with ${converter.name} first.`,
          );
        else expect(said, `${slug} ${ext}`).not.toContain("Turn it into");
      }
    },
  );

  it("the size refusal's words, pinned for one tool", () => {
    const word = getToolBySlug("word-to-pdf")!;
    const facts = pickFactsFor(word);
    expect(
      pickRefusal(
        word,
        { name: "a.docx", type: "", size: facts.ceilingBytes! + 1 },
        facts,
      ),
    ).toBe("This file is larger than 50 MB, the most Word to PDF accepts.");
    const protect = getToolBySlug("protect-pdf")!;
    expect(
      pickRefusal(
        protect,
        { name: "letter.docx", type: "", size: 1 },
        pickFactsFor(protect),
      ),
    ).toBe(
      `"letter.docx" isn't a PDF — Protect PDF works on PDF files. Turn it into a PDF with Word to PDF first.`,
    );
  });

  it("positive control: facts with a wrong ceiling or no converters are caught", () => {
    const word = getToolBySlug("word-to-pdf")!;
    const wrong = { ...pickFactsFor(word), ceilingBytes: 100 * 1024 * 1024 };
    expect(
      pickRefusal(
        word,
        { name: "a.docx", type: "", size: 60 * 1024 * 1024 },
        wrong,
      ),
    ).not.toBe(fileOverCeilingMessage(word, 60 * 1024 * 1024));
    const protect = getToolBySlug("protect-pdf")!;
    expect(
      pickRefusal(
        protect,
        { name: "letter.docx", type: "", size: 1 },
        { ...pickFactsFor(protect), converters: {} },
      ),
    ).not.toContain("Word to PDF");
  });
});
