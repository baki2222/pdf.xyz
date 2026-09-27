// @vitest-environment node
/**
 * A live tool's SERVER HTML must not say it has not shipped.
 *
 * Every worker and AI panel starts in its "loading" phase — the phase the
 * server renders — and until 2026-09-27 that phase rendered the unavailable
 * branch in full, "Notify me when this ships" button included. Measured on the
 * rendered pages that day: twenty tool pages (OCR, the Office conversions,
 * Protect/Unlock, the four AI tools, …) all running in production, all
 * shipping the button to every crawler and to every visitor until the status
 * check came back. The content writers saw it in the HTML; no guard did,
 * because every panel test rendered a phase the server never renders.
 *
 * So this reads the pages as the server renders them — the same out-of-process
 * census `file-ceilings.test.ts` uses (see `src/tests/render-tool-pages.ts` for
 * why it must be a subprocess), in `--markup` mode, because the question is
 * about a BUTTON: a step that describes the button in words is honest copy
 * about the unavailable state and is not what this guard is after.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { NotifyMe } from "./notify-me";

const ROOT = process.cwd();
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const CENSUS = path.join(ROOT, "src", "tests", "render-tool-pages.ts");

/** A rendered `<button>` whose label is the notify-me label. */
export function hasNotifyButton(markup: string): boolean {
  return /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*Notify me when this ships(?:(?!<\/button>)[\s\S])*<\/button>/.test(
    markup,
  );
}

const pages = new Map<string, string>();

beforeAll(() => {
  const stdout = execFileSync(process.execPath, [TSX_CLI, CENSUS, "--markup"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  for (const [slug, markup] of Object.entries(
    JSON.parse(stdout) as Record<string, string>,
  ))
    pages.set(slug, markup);
}, 180_000);

describe("no tool page's server HTML carries the notify-me button", () => {
  it("rendered every tool page (health check)", () => {
    expect(pages.size).toBe(tools.length);
    // The subjects this guard is about: pages whose panel checks the worker.
    // Twenty on the day it was written; a census that lost them is blind.
    const checking = [...pages.values()].filter((m) => m.includes("Checking"));
    expect(checking.length).toBeGreaterThanOrEqual(15);
  });

  it("none renders the button before the status check answers", () => {
    const offenders = [...pages]
      .filter(([, markup]) => hasNotifyButton(markup))
      .map(([slug]) => slug);
    expect(
      offenders,
      "these pages tell a crawler the tool has not shipped",
    ).toEqual([]);
  });

  it("positive control: the button is detected when it IS rendered", () => {
    const shown = renderToStaticMarkup(
      createElement(NotifyMe, {
        toolName: "Word to PDF",
        toolSlug: "word-to-pdf",
        checking: false,
      }),
    );
    expect(hasNotifyButton(shown)).toBe(true);
    const hidden = renderToStaticMarkup(
      createElement(NotifyMe, {
        toolName: "Word to PDF",
        toolSlug: "word-to-pdf",
        checking: true,
      }),
    );
    expect(hidden).toBe("");
    // Words about the button are not the button.
    expect(
      hasNotifyButton(
        '<p>you get a “Notify me when this ships” button.</p><button type="button">Remove</button>',
      ),
    ).toBe(false);
  });
});
