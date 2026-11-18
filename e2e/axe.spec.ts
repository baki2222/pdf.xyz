import { createRequire } from "node:module";
import { join } from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { getAllToolSlugs, tools } from "../src/lib/tools";
import { GUIDE_META } from "../src/lib/guides/meta.generated";
import { processingSplit } from "../src/lib/tools/processing-split";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { fileInput, waitForHydration } from "./helpers";
import {
  FILE_TOOLS,
  planStatus,
  takenPayloadFor,
} from "./fixtures/tool-payloads";

/**
 * Every page a visitor lands on passes axe-core's WCAG 2.x A/AA rules, in
 * light and dark, in its idle state (no file loaded).
 *
 * ADDED 2026-11-07, after the wave-2 audit's critic named accessibility "essentially
 * unexamined". A one-off axe run on production then found exactly one
 * defect, on every page: the footer's category links sat inside `<summary>`
 * (nested-interactive) and were under 24px tall (target-size). Nothing
 * held the site to axe, so nothing would have caught the next one.
 *
 * THE SET IS DERIVED: every catalogue tool page, plus the routes that are not
 * tools. A tool added tomorrow is checked by existing. The positive
 * control below proves the rules are live: a run that finds nothing on a page
 * with a planted defect would make every pass here meaningless.
 */
const fromRoot = createRequire(join(process.cwd(), "package.json"));
const AXE = fromRoot.resolve("axe-core/axe.min.js");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const PAGES = [
  "/",
  "/tools",
  "/workspace",
  "/privacy",
  "/security",
  `/guides/${GUIDE_META[0]!.slug}`,
  ...getAllToolSlugs().map((slug) => `/tools/${slug}`),
];

interface Violation {
  id: string;
  impact: string | null;
  /** The first three nodes' selectors. */
  nodes: string[];
  /** How many nodes axe reported, all of them, not just the three shown. */
  count: number;
}

async function violations(page: Page): Promise<Violation[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (tags) => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: Document,
            opts: object,
          ) => Promise<{
            violations: {
              id: string;
              impact: string | null;
              nodes: { target: string[] }[];
            }[];
          }>;
        };
      }
    ).axe;
    const r = await axe.run(document, {
      runOnly: { type: "tag", values: tags },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
      count: v.nodes.length,
    }));
  }, TAGS);
}

test.describe("accessibility: axe WCAG 2.x A/AA on every landing page", () => {
  test("health: the set holds every catalogue tool and the other routes", () => {
    expect(getAllToolSlugs().length).toBeGreaterThanOrEqual(50);
    expect(PAGES.length).toBe(getAllToolSlugs().length + 6);
  });

  test("POSITIVE CONTROL: a planted nested control and a tiny target are found", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await page.evaluate(() => {
      const details = document.createElement("details");
      details.innerHTML =
        '<summary>Planted <a href="#x">link</a></summary><p>x</p>';
      const tiny = document.createElement("button");
      tiny.textContent = "x";
      tiny.setAttribute(
        "style",
        "width:8px;height:8px;padding:0;font-size:6px;position:absolute;top:0;left:0",
      );
      const near = tiny.cloneNode(true) as HTMLElement;
      near.style.left = "9px";
      document.body.append(details, tiny, near);
    });
    const ids = (await violations(page)).map((v) => v.id);
    expect(ids).toContain("nested-interactive");
    expect(ids).toContain("target-size");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`every landing page passes (${scheme})`, async ({ browser }) => {
      test.setTimeout(PAGES.length * 6_000);
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      const failures: string[] = [];
      for (const path of PAGES) {
        const response = await page.goto(path, { waitUntil: "load" });
        expect(response?.status(), path).toBe(200);
        for (const v of await violations(page))
          failures.push(
            `${path}: ${v.id} (${v.impact}) at ${v.nodes.join(" | ")}`,
          );
      }
      await context.close();
      expect(failures, failures.join("\n")).toEqual([]);
    });
  }
});

/**
 * Every tool page passes the same rules AFTER a file is loaded, and every
 * in-browser tool passes them on its result.
 *
 * ADDED 2026-11-18, after the after-upload sweep on production found three
 * defects the landing pages above could never show, because each lives in a
 * state that exists only once a file is on the page:
 *
 *   annotate-pdf, edit-pdf, sign-pdf  post-upload  scrollable-region-focusable
 *       (the editor's page view could not be scrolled from the keyboard)
 *   rotate-pdf                        post-upload  nested-interactive
 *       (a page's rotate buttons sat inside the page tile, itself a button)
 *   pdf-to-markdown                   result       scrollable-region-focusable
 *       (the Markdown preview could not be focused)
 *
 * Without the fixes (main at 49b71de3) this sweep is red on exactly those
 * five (slug, state) pairs with exactly those rules, and nothing else but
 * the one KNOWN_OPEN entry below, which is red there too.
 *
 * THE SETS ARE DERIVED. Post-upload: every catalogue tool that takes a file
 * (`FILE_TOOLS`, the same derivation as the phone long-name case), each given
 * the first of its formats a fixture is made for (`takenPayloadFor`). The PDF
 * has 3 pages, so the scroll containers overflow at both widths. Result:
 * those of them whose processing is "client" (`processingSplit().neverUploads`) and
 * whose run button is live once the file is in; server and AI tools stay
 * post-upload only (no worker runs locally or on CI).
 *
 * A load must LAND before the page is checked: the file's name (or, for a
 * text tool, its text in the editor) is on the page AND the controls changed
 * from what the empty page drew. A page that never gets there is a fatal
 * "NOT REACHED", never a clean pass of the idle page under a post-upload
 * label (the production sweep's harness recorded text-to-pdf that way).
 */
const AFTER_UPLOAD_PDF_PAGES = 3;

/**
 * Defects this sweep found that were not yet fixed when it landed, each as
 * `<combo>|<the whole failure line>`, compared by EQUALITY (the line itself
 * holds " | " between nodes, so the combo ends at the FIRST "|"). The line
 * carries the rule's node count, so a new node on the same page and rule
 * changes it even past the three nodes shown. Both directions are held: a
 * failure no entry equals fails the sweep, and an entry no failure equals
 * fails it too ("fixed, remove from KNOWN_OPEN"), so an entry cannot outlive
 * its defect or cover a new one.
 *
 * HISTORY (review, 2026-11-18): entries were first a prefix through the
 * first node, matched by `startsWith`; a contrast failure planted on
 * sign-pdf dark printed after the known node and the sweep stayed green.
 *
 * sign-pdf, dark (found 2026-11-18 by this sweep's first run, on main with
 * #374-#376, and on 49b71de3 before them): the signature style previews are
 * drawn in the chosen ink (#0f172a by default) on the dark panel, 1.21:1 on
 * the selected tile (#192a35). `signature-panel.tsx`, the preview `<span>`'s
 * inline `color: ink`.
 */
const KNOWN_OPEN: readonly string[] = [
  'desktop, dark|sign-pdf [post-upload, desktop, dark]: color-contrast (serious) x1 at button[aria-label="Dancing Script"] > .truncate.text-xl.block',
];
/** A KNOWN_OPEN entry's combo: everything before its first "|". */
const knownCombo = (entry: string) => entry.slice(0, entry.indexOf("|"));
/** A KNOWN_OPEN entry's failure line: everything after its first "|". */
const knownLine = (entry: string) => entry.slice(entry.indexOf("|") + 1);

/** How long one load may take to land, and one run to draw its result. */
const LAND_TIMEOUT = 15_000;
const RESULT_TIMEOUT = 20_000;

interface Combo {
  name: string;
  options: BrowserContextOptions;
}

/** Desktop in both schemes, and the `mobile` project's phone in light. */
const AFTER_UPLOAD_COMBOS: Combo[] = [
  { name: "desktop, light", options: { colorScheme: "light" } },
  { name: "desktop, dark", options: { colorScheme: "dark" } },
  {
    name: "mobile 390, light",
    options: {
      colorScheme: "light",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
];

/**
 * The tools whose processing is "client", asked of `processingSplit` (the one
 * place a processing mode is given a meaning; `processing-split.test.ts`
 * refuses a restated `=== "client"`): no upload path at all, so a run
 * completes in the browser with no worker.
 */
const CLIENT_SLUGS = new Set(processingSplit().neverUploads.map((t) => t.slug));
/** The client tools that take a file: the candidates for a result pass. */
const CLIENT_FILE_TOOLS = FILE_TOOLS.filter((t) => CLIENT_SLUGS.has(t.slug));

/**
 * The client tools with no live run button once one file is in, each with
 * what its page says it still needs (the greyed-out button's reason, as
 * `whyNoRun` printed it on 2026-11-18). Every other candidate must RUN: the
 * result pass asserts its no-run members EQUAL these, so a tool that loses
 * its run button is red by name, and one that gains one forces this list to
 * change.
 *
 * HISTORY (review, 2026-11-18): the pass first held only `ran >= 10` and
 * pdf-to-markdown, so 14 of the 24 results could drop into the printed no-run
 * list with the test green (split-pdf was dropped that way and it passed).
 */
const NEEDS_MORE_THAN_A_FILE: Readonly<Record<string, string>> = {
  "merge-pdf": "Add one more PDF first.",
  "organize-pages": "Rearrange, rotate, add or delete a page first.",
  "extract-pages": "Select at least one page first.",
  "remove-pages": "Select at least one page first.",
  "rotate-pdf": "Rotate at least one page first.",
  "edit-pdf": "Change or add something on a page first.",
  "pdf-viewer": "no run button: a viewer has nothing to run",
  "annotate-pdf": "Add a highlight, ..., drawing or note to a page first.",
  "overlay-pdf": "Add the PDF to lay over the pages first.",
  // Greyed out with no reason shown: the fixture has no annotations, so there
  // is nothing to remove (`!inventory || toRemove === 0`).
  "remove-annotations": "nothing to remove in the fixture",
  "sign-pdf": "Place your signature, or a date, ... on a page first.",
  "fill-forms": "no run button: the fixture has no form fields",
  "redact-pdf": "Mark at least one area to remove first.",
  // Greyed out with no reason shown: `canCompare` is `items.length === 2`.
  "compare-pdf": "needs a second PDF",
};

type Tool = (typeof tools)[number];

/** A page with the worker answering ready and the consent banner answered. */
async function sweepPage(browser: Browser, options: BrowserContextOptions) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  // A worker panel mounts its picker only once the status answers ready.
  await planStatus(page, ["ready"]);
  // The banner is checked by the landing pages above; here it would sit over
  // a run button on a phone.
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  return { context, page };
}

/**
 * What the page's controls say: every control in `main` (but the file input,
 * whose value changes whether or not the page took the file), with its name,
 * value and state. A load that landed changes this; one that did not leaves
 * the idle page's controls exactly as they were.
 */
const controlsOf = (page: Page) =>
  page.evaluate(() => {
    const scope = document.querySelector("main") ?? document.body;
    const sel =
      'button, input:not([type="file"]), select, textarea, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="tab"], [contenteditable="true"]';
    return [...scope.querySelectorAll<HTMLElement>(sel)]
      .map((el) =>
        [
          el.tagName,
          el.getAttribute("type") ?? "",
          el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40),
          (el as HTMLInputElement).value ?? "",
          (el as HTMLInputElement).checked ?? "",
          (el as HTMLButtonElement).disabled ?? "",
          el.getAttribute("aria-disabled") ?? "",
          el.getAttribute("aria-pressed") ?? "",
        ].join("|"),
      )
      .join("\n");
  });

/** Wait until the document stops changing shape (renders, thumbnails). */
async function settle(page: Page) {
  const shape = () =>
    page.evaluate(
      () =>
        `${document.getElementsByTagName("*").length}:${document.documentElement.scrollHeight}`,
    );
  let last = await shape();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    const now = await shape();
    if (now === last) return;
    last = now;
  }
}

interface Reached {
  /** Why the load did not land, or null when it did. */
  notReached: string | null;
}

/**
 * Load `tool`'s first format into its page and wait for it to LAND: the name
 * (or the text) shown, and the controls changed. Resolves either way; the
 * caller records a miss as fatal.
 */
async function loadTool(page: Page, tool: Tool): Promise<Reached> {
  const payload = await takenPayloadFor(tool, AFTER_UPLOAD_PDF_PAGES);
  const response = await page.goto(`/tools/${tool.slug}`, {
    waitUntil: "load",
  });
  if (response?.status() !== 200)
    return { notReached: `HTTP ${response?.status()}` };
  const input = fileInput(page);
  await waitForHydration(input);
  const idle = await controlsOf(page);
  await input.setInputFiles(payload);
  const deadline = Date.now() + LAND_TIMEOUT;
  let shown = false;
  let changed = false;
  while (Date.now() < deadline) {
    shown = await page.evaluate(
      ({ name, body }) =>
        (document.body.textContent?.includes(name) ?? false) ||
        (!!body &&
          [...document.querySelectorAll("textarea")].some((t) =>
            t.value.includes(body),
          )),
      { name: payload.name, body: payload.body },
    );
    changed = (await controlsOf(page)) !== idle;
    if (shown && changed) break;
    await page.waitForTimeout(200);
  }
  if (!(shown && changed))
    return {
      notReached: `file shown: ${shown}, controls changed: ${changed}, after ${LAND_TIMEOUT} ms`,
    };
  await settle(page);
  return { notReached: null };
}

/**
 * The targets axe calls too small that are still too small with the target
 * scrolled to the middle of the screen. Run only after `violations()`, which
 * loaded axe.
 *
 * WHY: axe's target-size counts a control that straddles the bottom edge of
 * the screen, at the scroll position it happens to be read at, as "partially
 * obscured". On the 390x844 phone, remove-pages' "View page 3 larger" sat at
 * 808-852px and n-up-pdf's sheet chips likewise, on every run. A reader
 * scrolls; a target is too small only if it is too small where it can be
 * put. The positive control plants two 8px buttons and proves a real one
 * survives this re-check, in every combo.
 */
async function targetsStillTooSmall(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    type Run = (
      ctx: unknown,
      opts: object,
    ) => Promise<{ violations: { nodes: { target: string[] }[] }[] }>;
    const axe = (window as unknown as { axe: { run: Run } }).axe;
    const only = { runOnly: { type: "rule", values: ["target-size"] } };
    const all = await axe.run(document, only);
    const targets = all.violations.flatMap((v) => v.nodes.map((n) => n.target));
    const still: string[] = [];
    for (const target of targets) {
      const el = document.querySelector(target[target.length - 1]!);
      // `instant`: the site's smooth scrolling would still be moving it.
      el?.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
      await new Promise(requestAnimationFrame);
      const again = await axe.run({ include: [target] }, only);
      if (again.violations.length > 0) still.push(target.join(" "));
    }
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    return still;
  });
}

/**
 * Why a client tool's page has no live run button with only a file chosen:
 * the text its greyed-out button points at (`aria-describedby`, a runner's
 * `RunReason`), or that there is no run button at all.
 */
const whyNoRun = (page: Page) =>
  page.evaluate(() => {
    const trigger = document.querySelector("main [data-run-trigger]");
    if (!trigger) return "no run button on the page";
    const ids = trigger.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
    const said = ids
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    return `greyed out: ${said || "(says no reason)"}`;
  });

/**
 * One page's axe violations, each as
 * `slug [state, combo]: rule (impact) xN at node | node | node`.
 */
async function record(
  page: Page,
  slug: string,
  state: string,
  combo: string,
): Promise<string[]> {
  const found = await violations(page);
  const out: string[] = [];
  for (const v of found) {
    let nodes = v.nodes;
    let count = v.count;
    if (v.id === "target-size") {
      nodes = await targetsStillTooSmall(page);
      count = nodes.length;
      if (count === 0) continue;
    }
    // The node count is in the line so that an exact KNOWN_OPEN entry turns
    // red when a node is added, even one past the three shown.
    out.push(
      `${slug} [${state}, ${combo}]: ${v.id} (${v.impact}) x${count} at ${nodes.slice(0, 3).join(" | ")}`,
    );
  }
  return out;
}

/**
 * The post-upload sweep of `set` in one combo. `plant` runs on each landed
 * page before axe does (the positive control's way in; the sweep passes none).
 */
async function afterUpload(
  browser: Browser,
  combo: Combo,
  set: readonly Tool[],
  plant?: (page: Page) => Promise<void>,
) {
  const { context, page } = await sweepPage(browser, combo.options);
  const failures: string[] = [];
  const notReached: string[] = [];
  const reached: string[] = [];
  for (const tool of set) {
    const { notReached: why } = await loadTool(page, tool);
    if (why) {
      notReached.push(`NOT REACHED ${tool.slug} [${combo.name}]: ${why}`);
      continue;
    }
    reached.push(tool.slug);
    if (plant) await plant(page);
    failures.push(
      ...(await record(page, tool.slug, "post-upload", combo.name)),
    );
  }
  await context.close();
  return { failures, notReached, reached };
}

test.describe("accessibility: axe after a file is loaded, and on client results", () => {
  test("health: the post-upload set is every tool that takes a file, and the result candidates hold pdf-to-markdown", () => {
    const members = FILE_TOOLS.map((t) => t.slug).join(", ");
    expect(FILE_TOOLS.length, members).toBeGreaterThanOrEqual(50);
    // Only URL tools are left out.
    const left = tools.filter((t) => !FILE_TOOLS.includes(t));
    expect(
      left.every((t) => t.accept.join() === "URL"),
      left.map((t) => t.slug).join(", "),
    ).toBe(true);
    const candidates = CLIENT_FILE_TOOLS.map((t) => t.slug);
    expect(candidates.length, candidates.join(", ")).toBeGreaterThanOrEqual(10);
    expect(candidates).toContain("pdf-to-markdown");
    // A second, independent count: every client tool takes a file, so the
    // candidates are ALL of them. A filter that drops one is red here.
    expect(candidates.length, candidates.join(", ")).toBe(CLIENT_SLUGS.size);
    // Every pinned no-run tool is a candidate, or its pin passes over nothing.
    for (const slug of Object.keys(NEEDS_MORE_THAN_A_FILE))
      expect(candidates, slug).toContain(slug);
    // Every known-open entry names a combo the sweep runs, or it is never
    // compared and its "fixed" check passes over nothing.
    const combos = AFTER_UPLOAD_COMBOS.map((c) => c.name);
    for (const entry of KNOWN_OPEN)
      expect(combos, entry).toContain(knownCombo(entry));
  });

  test("POSITIVE CONTROL: a planted unfocusable scroller, a button in a button and two tiny targets are found after a load", async ({
    browser,
  }) => {
    const tool = FILE_TOOLS.find((t) => t.slug === "merge-pdf")!;
    // In every combo: the phone's run dock is what the target-size re-check
    // looks past, so a real tiny target must still be found there.
    for (const combo of AFTER_UPLOAD_COMBOS) {
      const { failures, notReached } = await afterUpload(
        browser,
        combo,
        [tool],
        async (page) => {
          await page.evaluate(() => {
            // F1's shape: overflowing, tabIndex -1, nothing focusable inside.
            const scroller = document.createElement("div");
            scroller.tabIndex = -1;
            scroller.setAttribute(
              "style",
              "height:60px;width:200px;overflow:auto",
            );
            for (let i = 0; i < 12; i++) {
              const p = document.createElement("p");
              p.textContent = `Planted line ${i + 1}`;
              scroller.append(p);
            }
            // F3's shape: a role=button tile holding a real button.
            const tile = document.createElement("div");
            tile.setAttribute("role", "button");
            tile.tabIndex = 0;
            tile.setAttribute("aria-label", "Planted tile");
            const inner = document.createElement("button");
            inner.type = "button";
            inner.textContent = "Planted inner";
            tile.append(inner);
            // Two 8px buttons a pixel apart: too small wherever they are put,
            // so they must survive the scrolled re-check of target-size.
            const tiny = document.createElement("div");
            for (let i = 0; i < 2; i++) {
              const b = document.createElement("button");
              b.type = "button";
              b.textContent = "x";
              b.setAttribute(
                "style",
                "width:8px;height:8px;padding:0;margin-right:1px;font-size:6px;border:0",
              );
              tiny.append(b);
            }
            (document.querySelector("main") ?? document.body).append(
              scroller,
              tile,
              tiny,
            );
          });
        },
      );
      expect(notReached).toEqual([]);
      const rules = failures.map((f) => f.split(": ")[1]!.split(" ")[0]);
      expect(rules, failures.join("\n")).toContain(
        "scrollable-region-focusable",
      );
      expect(rules, failures.join("\n")).toContain("nested-interactive");
      expect(rules, failures.join("\n")).toContain("target-size");
      expect(
        failures.every((f) => f.startsWith("merge-pdf [post-upload")),
      ).toBe(true);
    }
  });

  for (const combo of AFTER_UPLOAD_COMBOS) {
    test(`every tool page passes after a file is loaded (${combo.name})`, async ({
      browser,
    }) => {
      test.setTimeout(FILE_TOOLS.length * 12_000);
      const { failures, notReached, reached } = await afterUpload(
        browser,
        combo,
        FILE_TOOLS,
      );
      // Fatal first: a page that never took its file was not checked.
      expect(notReached, notReached.join("\n")).toEqual([]);
      expect(
        reached.length,
        `reached ${reached.length} of ${FILE_TOOLS.length}: ${reached.join(", ")}`,
      ).toBe(FILE_TOOLS.length);
      const known = KNOWN_OPEN.filter((k) => knownCombo(k) === combo.name);
      // EQUALITY, not a prefix: a prefix through the first node let a new
      // node on the same rule and page pass as the known one (review,
      // 2026-11-18: a planted contrast failure on sign-pdf dark stayed green).
      const isKnown = (f: string) => known.some((k) => knownLine(k) === f);
      // A known entry no line equals was fixed, or changed: either way, red.
      const fixed = known.filter((k) => !failures.includes(knownLine(k)));
      const fresh = failures.filter((f) => !isKnown(f));
      // One assertion, so a changed entry shows both its stale form and the
      // line that replaced it.
      expect(
        { fresh, fixed },
        `${fresh.join("\n")}\nfixed, remove from KNOWN_OPEN: ${fixed.join("; ")}`,
      ).toEqual({ fresh: [], fixed: [] });
    });
  }

  test("every client tool passes on its result (desktop, light)", async ({
    browser,
  }) => {
    test.setTimeout(CLIENT_FILE_TOOLS.length * 20_000);
    const combo = AFTER_UPLOAD_COMBOS[0]!;
    const { context, page } = await sweepPage(browser, combo.options);
    const failures: string[] = [];
    const notReached: string[] = [];
    const ran: string[] = [];
    const noRun: string[] = [];
    const noRunWhy: string[] = [];
    for (const tool of CLIENT_FILE_TOOLS) {
      const { notReached: why } = await loadTool(page, tool);
      if (why) {
        notReached.push(`NOT REACHED ${tool.slug} [post-upload]: ${why}`);
        continue;
      }
      // The tool's own run button, live with nothing but the file chosen.
      const trigger = page.locator("main [data-run-trigger]").first();
      if (
        (await trigger.count()) === 0 ||
        (await trigger.getAttribute("aria-disabled")) === "true"
      ) {
        noRun.push(tool.slug);
        noRunWhy.push(`${tool.slug}: ${await whyNoRun(page)}`);
        continue;
      }
      // The result is a heading the page did not have before the run (a
      // `ResultPanel`'s title, or a runner's own outcome such as Extract
      // Images' "No extractable images found"), with nothing still busy.
      const headings = () =>
        page.evaluate(() =>
          [...document.querySelectorAll("main h2, main h3")]
            .filter((h) => (h as HTMLElement).offsetParent !== null)
            .map((h) => h.textContent?.trim() ?? ""),
        );
      const before = new Set(await headings());
      await trigger.click();
      const deadline = Date.now() + RESULT_TIMEOUT;
      let fresh: string[] = [];
      while (Date.now() < deadline) {
        const busy = await page.locator('main [aria-busy="true"]').count();
        fresh = (await headings()).filter((h) => h && !before.has(h));
        if (fresh.length > 0 && busy === 0) break;
        fresh = [];
        await page.waitForTimeout(200);
      }
      if (fresh.length === 0) {
        notReached.push(
          `NOT REACHED ${tool.slug} [result]: no new heading after ${RESULT_TIMEOUT} ms`,
        );
        continue;
      }
      await settle(page);
      ran.push(`${tool.slug} ("${fresh[0]}")`);
      failures.push(...(await record(page, tool.slug, "result", combo.name)));
    }
    await context.close();
    console.log(
      `AXE_RESULT_SET ran ${ran.length}: ${ran.join(", ")}\nAXE_RESULT_SET no live run button ${noRun.length}:\n  ${noRunWhy.join("\n  ")}`,
    );
    expect(notReached, notReached.join("\n")).toEqual([]);
    // Health: the candidates PARTITION into ran and no-run, the no-run part is
    // exactly the pinned list, and F2's result is among those drawn.
    expect(ran.length + noRun.length, `ran: ${ran.join(", ")}`).toBe(
      CLIENT_FILE_TOOLS.length,
    );
    expect(
      [...noRun].sort(),
      `no live run button:\n  ${noRunWhy.join("\n  ")}`,
    ).toEqual(Object.keys(NEEDS_MORE_THAN_A_FILE).sort());
    expect(ran.length, `ran: ${ran.join(", ")}`).toBeGreaterThanOrEqual(10);
    expect(ran.map((r) => r.split(" ")[0])).toContain("pdf-to-markdown");
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
