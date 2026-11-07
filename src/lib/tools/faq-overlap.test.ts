// @vitest-environment node
/**
 * A TOOL PAGE ASKS EACH QUESTION ONCE.
 *
 * `pageFaq` appends the derived fact FAQ to the authored one and skipped a
 * derived question only when the author had asked it WORD FOR WORD. So the
 * PowerPoint page served "How large a presentation can I convert?" and then
 * "How large can my file be?", and "Can I convert Google Slides, Keynote or
 * ODP presentations?" beside "Which files can PowerPoint to PDF convert?"
 * (audit powerpoint-to-pdf#7, 2026-11-06). Nine pages carried a second size
 * question the same way.
 *
 * The derived entry is now skipped when an authored entry already ASKS the
 * topic and STATES the fact the derived one would — the ceiling figure, or
 * every accepted format. Both halves are checked here: no page asks a topic
 * twice, and no page loses the fact when the derived entry goes.
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { getToolContent } from "@/lib/tools/content";
import { FORMAT_TOPIC, pageFaq, SIZE_TOPIC } from "@/lib/tools/page-copy";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import {
  SIZE_FAQ_QUESTION,
  officeInputFaqQuestion,
} from "@/lib/tools/tool-facts";

/** A megabyte figure as copy states it: "50 MB", "50.0 MB". */
const MB_FIGURE = /(\d+(?:\.\d+)?)\s*MB\b/g;

const withContent = tools.filter((t) => getToolContent(t.slug));

describe("tool pages ask each FAQ topic once", () => {
  it("health: the corpus is the size the catalogue implies", () => {
    expect(withContent.length).toBeGreaterThanOrEqual(40);
  });

  it("the topic patterns catch the derived questions and the authored ones that duplicated them", () => {
    expect(SIZE_FAQ_QUESTION).toMatch(SIZE_TOPIC);
    const ppt = tools.find((t) => t.slug === "powerpoint-to-pdf")!;
    expect(officeInputFaqQuestion(ppt)).toMatch(FORMAT_TOPIC);
    for (const q of [
      "How large a presentation can I convert?",
      "Is there a limit on file size or page count?",
      "How big a scan can I process, and how many at once?",
    ])
      expect(q).toMatch(SIZE_TOPIC);
    expect(
      "Can I convert Google Slides, Keynote or ODP presentations?",
    ).toMatch(FORMAT_TOPIC);
    expect("Which file types can I convert here?").toMatch(FORMAT_TOPIC);
    // …and not a question about something else.
    expect("How does splitting by file size work?").not.toMatch(SIZE_TOPIC);
  });

  it.each(withContent.map((t) => [t.slug, t] as const))(
    "%s: at most one size question and one formats question",
    (_slug, tool) => {
      const qs = pageFaq(tool).map((f) => f.question);
      expect(
        qs.filter((q) => SIZE_TOPIC.test(q)).length,
        JSON.stringify(qs),
      ).toBeLessThanOrEqual(1);
      expect(
        qs.filter((q) => FORMAT_TOPIC.test(q)).length,
        JSON.stringify(qs),
      ).toBeLessThanOrEqual(1);
    },
  );

  it.each(withContent.map((t) => [t.slug, t] as const))(
    "%s: the facts survive — the ceiling and every format are still answered",
    (_slug, tool) => {
      const faq = pageFaq(tool);
      const mb = toolFileCeilingMb(tool);
      if (mb !== null && faq.some((f) => SIZE_TOPIC.test(f.question))) {
        expect(
          faq.some(
            (f) =>
              SIZE_TOPIC.test(f.question) &&
              [...f.answer.matchAll(MB_FIGURE)].some(
                (m) => Number(m[1]) === mb,
              ),
          ),
          `${tool.slug}: no size answer states ${mb} MB`,
        ).toBe(true);
      }
      const derivedFormats = officeInputFaqQuestion(tool);
      if (derivedFormats !== null) {
        const answered = faq.filter((f) => FORMAT_TOPIC.test(f.question));
        expect(answered).toHaveLength(1);
        const text = `${answered[0]!.question} ${answered[0]!.answer}`;
        for (const format of tool.accept)
          expect(text, `${tool.slug}: ${format} unanswered`).toMatch(
            new RegExp(`(?:^|[\\s.(])${format}\\b`, "i"),
          );
      }
    },
  );

  it("the derived size answer still reaches pages whose authors did not ask", () => {
    const served = withContent.filter((t) =>
      pageFaq(t).some((f) => f.question === SIZE_FAQ_QUESTION),
    );
    expect(served.length).toBeGreaterThanOrEqual(20);
  });
});
