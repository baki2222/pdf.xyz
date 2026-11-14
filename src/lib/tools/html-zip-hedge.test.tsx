// @vitest-environment jsdom
/**
 * EVERY sentence of HTML to PDF's static copy that says something about a
 * ZIP says WHEN: "when our server can open ZIP files" (or one of its two
 * shipped respellings). Static copy cannot know whether the running worker
 * proves `htmlZip`, and while it does not, production refuses every ZIP (a
 * 501 at the upload, a refusal at the pick) — so an unhedged ZIP sentence
 * is false of the running system for as long as the worker image is old.
 *
 * Behaviour review 2026-11-14 found two that were not: the size sentence
 * ("One HTML file, pasted page or ZIP of up to X per run") and the guide's
 * "How large can the HTML file be?". The implementer's own rule — every ZIP
 * sentence carries the hedge — was a comment, and a comment is not a guard.
 *
 * SENTENCES, NOT STRINGS (surface review round 2, 2026-11-14). The first
 * version judged each whole string, so an unhedged ZIP sentence appended to
 * a string that already held the hedge passed ("Upload a ZIP of your whole
 * site to print it with every image." after the hedged FAQ answer: green).
 * Each string is now split into sentences and EACH is judged.
 *
 * THE CORPUS IS DISCOVERED, not named, and read where the reader gets it:
 *   - every string reachable from the tool's content, its FAQ entries,
 *     every guide that lists the tool, and the desk's answer to a ZIP;
 *   - the PANEL AS RENDERED for a worker that does NOT prove `htmlZip` —
 *     closed, and with the paste box open — so every child module's words
 *     are read through the render tree (the first version read string
 *     literals of html-render-worker-panel.tsx alone, and a ZIP claim added
 *     to the paste box's always-visible hint was never judged: green).
 *     Words shown only once a ZIP is offered are not rendered here, and
 *     need no hedge: they are true whenever they are shown.
 *
 * A question makes no claim, so sentences ending in "?" are not judged; a
 * ZIP sentence that claims nothing about what we take is listed in
 * {@link NOT_A_CLAIM}, and each entry must still be shipped. Both
 * directions are held (house rule 1): every sentence the reviews caught
 * must FAIL the predicate, and every hedge shape must be exercised.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getToolContent } from "@/lib/tools/content";
import { guides } from "@/lib/guides/catalog";
import { modeFaq, toolFacts, toolFaq } from "@/lib/tools/tool-facts";
import { getToolBySlug } from "@/lib/tools";
import { unsupportedWords } from "@/lib/intent/unsupported";
import { InToolPage } from "@/tests/in-tool-page";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import { HtmlRenderWorkerPanel } from "@/components/tools/html-render-worker-panel";

const SLUG = "html-to-pdf";

/** The shapes of the hedge, each one shipped (see the corpus check below). */
const HEDGES: Record<string, RegExp> = {
  server: /\bwhen our server can open ZIP files\b/i,
  page: /\bwhen the page offers ZIP\b/i,
  dropZone: /\bwhen the drop zone takes a ZIP\b/i,
};

/**
 * ZIP sentences that claim nothing about what HTML to PDF takes, each with
 * why. Every entry must be found in the corpus (a stale one is decoration).
 */
const NOT_A_CLAIM: Record<string, string> = {
  "For any other ZIP, unzip it first and add the files inside.":
    "the desk's advice for a ZIP that is not a web page: true whatever the worker proves",
};

/**
 * "such a ZIP": a sentence that refers BACK to the ZIP a hedged sentence
 * described. It counts as hedged only when the sentence before it in the
 * same string is hedged (directly, or by such a chain), so the chain always
 * starts at a real hedge: an unhedged sentence appended anywhere still has
 * neither.
 */
const ANAPHOR = /\bsuch a ZIP\b/i;

const mentionsZip = (s: string) => /\bzip\b/i.test(s);
const hedged = (s: string) => Object.values(HEDGES).some((re) => re.test(s));

/** Each sentence of one string, with whether it is hedged (by itself or the chain). */
function judgedChain(text: string): { text: string; hedged: boolean }[] {
  let previous = false;
  return sentences(text).map((sentence) => {
    const ok = hedged(sentence) || (ANAPHOR.test(sentence) && previous);
    previous = ok;
    return { text: sentence, hedged: ok };
  });
}
const judged = (s: string) =>
  mentionsZip(s) && !s.trim().endsWith("?") && !(s.trim() in NOT_A_CLAIM);

/**
 * A text's sentences: split after . ! ? or … when a capital, a quote or a
 * digit follows. "e.g. Page_files" stays one sentence (a lowercase word
 * follows), as do ".html, .htm or .zip".
 */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<!\b(?:e\.g|i\.e)\.)(?<=[.!?…])\s+(?=[A-Z0-9“"‘'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** What the reviews caught, as shipped: each must be refused by the predicate. */
const CAUGHT_UNHEDGED = [
  "One HTML file, pasted page or ZIP of up to 20.0 MB per run, the most Chromium is handed: a larger file is refused as soon as you pick it, before anything is uploaded, and pasted code over it is marked in the box and not sent.",
  "One HTML file, pasted page or ZIP of up to 20.0 MB is accepted per run.",
  "Up to 20 MB, one file, pasted page or ZIP per run; a larger file is refused when you pick it, before anything is sent, and pasted code over it is marked in the box and not sent.",
  "Yes, within a fixed budget of rendering time, so a chart or table built by script can appear, in pasted code and in a ZIP's page too.",
  "The PDF is named after your file, ending in .pdf instead of .html, .htm or .zip; pasted code becomes pasted.pdf.",
  // Round 2's mutations M2 and M3, which the whole-string predicate passed.
  "Upload a ZIP of your whole site to print it with every image.",
  "For a page with images, upload a ZIP of its folder instead.",
];

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) strings(v, out);
  return out;
}

interface Said {
  source: string;
  text: string;
}

function staticCorpus(): Said[] {
  const tool = getToolBySlug(SLUG)!;
  const out: Said[] = [];
  for (const text of strings(getToolContent(SLUG)))
    out.push({ source: "content", text });
  for (const text of strings([toolFaq(tool), modeFaq(tool), toolFacts(SLUG)]))
    out.push({ source: "faq", text });
  for (const guide of guides.filter((g) => g.tools.includes(SLUG)))
    for (const text of strings(guide))
      out.push({ source: `guide ${guide.slug}`, text });
  const desk = unsupportedWords("ZIP");
  for (const text of [desk.headline, desk.how ?? ""])
    out.push({ source: "desk", text });
  return out;
}

/** Every element's own text, whole: one entry per element that holds text. */
function textsOf(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const own = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "",
    );
    if (own) out.push(el.textContent ?? "");
  }
  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>("[placeholder], [aria-label], [title]"),
  ))
    for (const attr of ["placeholder", "aria-label", "title"])
      if (el.getAttribute(attr)) out.push(el.getAttribute(attr)!);
  return out;
}

/** The panel as a worker WITHOUT htmlZip shows it: closed, then pasting. */
async function renderedCorpus(): Promise<Said[]> {
  const status = { ...READY_WORKER_STATUS, htmlZip: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/api/worker/status"))
        return { ok: true, status: 200, json: async () => status };
      return { ok: false, status: 503, json: async () => ({}) };
    }),
  );
  const tool = getToolBySlug(SLUG)!;
  const view = render(
    <InToolPage tool={tool}>
      <HtmlRenderWorkerPanel tool={tool} />
    </InToolPage>,
  );
  const toggle = await screen.findByRole("button", {
    name: "Or paste HTML code",
  });
  const out: Said[] = textsOf(view.container).map((text) => ({
    source: "panel (closed)",
    text,
  }));
  fireEvent.click(toggle);
  await screen.findByLabelText("HTML code");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Choose a file instead" }),
    ).toBeTruthy(),
  );
  for (const text of textsOf(view.container))
    out.push({ source: "panel (pasting)", text });
  return out;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function corpus(): Promise<Said[]> {
  return [...staticCorpus(), ...(await renderedCorpus())];
}

function sentencesOf(all: Said[]): (Said & { hedged: boolean })[] {
  return all.flatMap((s) =>
    judgedChain(s.text).map((one) => ({ source: s.source, ...one })),
  );
}

describe("HTML to PDF's ZIP sentences say when", () => {
  it("health: the corpus is the copy, not a fragment of it", async () => {
    const all = await corpus();
    const bySource = (prefix: string) =>
      all.filter((s) => s.source.startsWith(prefix));
    expect(bySource("content").length).toBeGreaterThan(30);
    expect(bySource("guide ").length).toBeGreaterThan(50);
    expect(bySource("faq").length).toBeGreaterThan(3);
    expect(bySource("desk").length).toBe(2);
    // The child modules' words arrive through the render tree: the paste
    // box's hint (html-paste-box.tsx) and the source area's toggle
    // (html-source-area.tsx), not only the panel's own file.
    const pasting = bySource("panel (pasting)").map((s) => s.text);
    expect(pasting.some((t) => /Pasted code is not run/.test(t))).toBe(true);
    expect(
      bySource("panel (closed)").some((s) => /Or paste HTML code/.test(s.text)),
    ).toBe(true);
    expect(bySource("panel").length).toBeGreaterThan(10);
    // The ZIP sentences themselves: as many as shipped with the feature.
    const zipSentences = sentencesOf(all).filter((s) => judged(s.text));
    expect(zipSentences.length).toBeGreaterThanOrEqual(10);
    // And the splitter is not the identity: strings hold many sentences.
    expect(sentencesOf(all).length).toBeGreaterThan(all.length * 1.5);
  });

  it("every judged SENTENCE carries the hedge", async () => {
    const bare = sentencesOf(await corpus())
      .filter((s) => judged(s.text) && !s.hedged)
      .map((s) => `${s.source}: ${s.text.slice(0, 160)}`);
    expect([...new Set(bare)]).toEqual([]);
  });

  it("POSITIVE CONTROL: every sentence the reviews caught is refused by the predicate", () => {
    for (const sentence of CAUGHT_UNHEDGED) {
      expect(judged(sentence), sentence).toBe(true);
      expect(hedged(sentence), sentence).toBe(false);
    }
  });

  it("POSITIVE CONTROL: an unhedged sentence appended to a hedged one is split out and caught", () => {
    const appended =
      "When our server can open ZIP files, yes: one ZIP of up to 20.0 MB. Upload a ZIP of your whole site to print it with every image.";
    // The whole string passes the old predicate — the hole round 2 found.
    expect(hedged(appended)).toBe(true);
    const parts = judgedChain(appended);
    expect(parts).toHaveLength(2);
    expect(parts.filter((p) => judged(p.text) && !p.hedged)).toEqual([
      {
        text: "Upload a ZIP of your whole site to print it with every image.",
        hedged: false,
      },
    ]);
    // "such a ZIP" is hedged only after a hedged sentence: first in a
    // string, or after an unhedged one, it is caught too.
    expect(
      judgedChain("Such a ZIP may hold 4,000 files.").map((p) => p.hedged),
    ).toEqual([false]);
    expect(
      judgedChain(
        "Upload a ZIP of your site. Such a ZIP may hold 4,000 files.",
      ).map((p) => p.hedged),
    ).toEqual([false, false]);
    expect(
      judgedChain(
        "When our server can open ZIP files, yes. Such a ZIP may hold 4,000 files. When such a ZIP holds two pages, a list shows.",
      ).map((p) => p.hedged),
    ).toEqual([true, true, true]);
    // And the splitter keeps "e.g." and file extensions inside a sentence.
    expect(
      sentences("2 linked files (e.g. Page_files/s.css) are not here."),
    ).toHaveLength(1);
    expect(sentences("ending in .pdf instead of .html, .htm or .zip.")).toEqual(
      ["ending in .pdf instead of .html, .htm or .zip."],
    );
  });

  it("every NOT_A_CLAIM entry is a shipped sentence (an exemption nothing uses is decoration)", async () => {
    const shipped = new Set(sentencesOf(await corpus()).map((s) => s.text));
    for (const sentence of Object.keys(NOT_A_CLAIM))
      expect(shipped.has(sentence), sentence).toBe(true);
  });

  it("every hedge shape is exercised by a shipped sentence (a shape nothing uses is decoration)", async () => {
    const texts = sentencesOf(await corpus()).map((s) => s.text);
    expect(texts.some((t) => ANAPHOR.test(t))).toBe(true);
    for (const [name, re] of Object.entries(HEDGES))
      expect(
        texts.some((t) => re.test(t)),
        name,
      ).toBe(true);
  });
});
