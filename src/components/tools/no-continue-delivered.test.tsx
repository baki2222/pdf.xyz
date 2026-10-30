// @vitest-environment jsdom
/**
 * "Nothing here should touch this file again — and here is why" reaches the
 * reader, on the tool page that says it.
 *
 * `NO_CONTINUE` (Protect PDF: the output is encrypted; PDF to PDF/A: an edit
 * would break conformance) was computed into the plan and certified by
 * `next-steps.test.ts` as "the reason is said" — and said nowhere: both are
 * worker tools, the page gave only the in-browser runner its job
 * (`ToolRunProvider`), and a worker's result card had no way to say it (WP-08
 * review, 2026-10-10: CLAUDE.md rule 5, a correct value that reaches nobody).
 * This holds the composed chain, not its parts:
 *
 *  1. the set is DERIVED: every tool whose plan carries a reason, found from
 *     the catalogue (health-checked against `NO_CONTINUE`, both ways);
 *  2. each is mounted by the page as the page mounts it — an in-browser
 *     runner (`ToolRunner`) or a worker panel (`panel.Panel`) — and the page
 *     renders that element INSIDE `ToolRunProvider` (read from the page's
 *     own source, as JSX: a comment or a string is not an ancestor);
 *  3. the panel the registry routes the tool to, driven through the REAL job
 *     client over a stubbed network to its result card, shows the reason in
 *     that card.
 *
 * A member with no way to drive it is FATAL rather than skipped: a tool that
 * gains a reason gains a driver here, or this fails naming it.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ToolRunProvider } from "@/components/tools/runner/tool-context";
import type { JobArtifact } from "@/lib/jobs/types";
import { continueTargetsFor, NO_CONTINUE } from "@/lib/intent/next-steps";
import { getRunnerKind } from "@/lib/pdf/registry";
import { tools } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import type { WorkerStatus } from "@/lib/workers/status";
import { stubJobNetwork } from "@/tests/stub-job-network";
import {
  TOOL_PAGE,
  panelComponent,
  panelDispatchArms,
} from "@/tests/worker-panel-dispatch";
import { readyFileInput } from "@/tests/worker-ready";
import { withAppRouter } from "@/tests/app-router";

const READY = {
  mode: "remote-configured",
  enabled: false,
  localDevOnly: false,
  detail: "remote",
  compress: { lossless: false, deep: false, engines: [] },
  ocr: { available: false, engine: null, languages: [], detail: "off" },
  scan: { active: false, detail: "not scanned" },
  security: { available: true, operations: [], detail: "qpdf" },
  providers: {
    storage: { ready: true },
    queue: { ready: true },
    processor: { ready: true },
  },
  daemon: { drainable: true, detail: "ready" },
  ai: { ready: false },
  pipeline: { verdict: "off", observed: false, drainable: false, detail: "" },
} as unknown as WorkerStatus;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 1. Every tool whose output nothing here should open, from the plans. */
const reasoned = tools.filter(
  (tool) => continueTargetsFor(tool, tools).none !== undefined,
);

/** JSX elements named `tag` in the page, with the tags around each. */
function pageElements(tag: string): string[][] {
  const source = readFileSync(TOOL_PAGE, "utf8");
  const sf = ts.createSourceFile(
    TOOL_PAGE,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[][] = [];
  const visit = (node: ts.Node, ancestors: string[]) => {
    let next = ancestors;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const name = opening.tagName.getText(sf);
      if (name === tag) found.push(ancestors);
      next = [name, ...ancestors];
    }
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(sf, []);
  return found;
}

/** How each worker panel with a reasoned tool reaches its result card. */
const DRIVERS: Record<
  string,
  { drive: () => Promise<void>; announce: string }
> = {
  PdfSecurityWorkerPanel: {
    drive: async () => {
      fireEvent.change(await screen.findByLabelText("New password"), {
        target: { value: "correct horse" },
      });
      fireEvent.click(
        await screen.findByRole("button", { name: /encrypt pdf/i }),
      );
    },
    announce: "Your PDF is protected and ready.",
  },
  PdfArchiveWorkerPanel: {
    drive: async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /convert to pdf\/a/i }),
      );
    },
    announce: "Your PDF/A file is ready.",
  },
};

const artifact = (filename: string): JobArtifact => ({
  artifactId: "a_stub",
  filename,
  contentType: "application/pdf",
  bytes: 8,
  url: "/api/jobs/j_stub/artifacts/a_stub",
  expiresAt: new Date(0).toISOString(),
});

describe("a reason for no next step reaches the page that has one", () => {
  it("health check: the set is the table, both ways, and not empty", () => {
    expect(reasoned.map((t) => t.slug).sort()).toEqual(
      Object.keys(NO_CONTINUE).sort(),
    );
    expect(reasoned.length).toBeGreaterThanOrEqual(2);
  });

  it("the page gives what it mounts for each the job that carries the reason", () => {
    // Both mount points, read as JSX from the page itself.
    const runner = pageElements("ToolRunner");
    const panel = pageElements("panel.Panel");
    // Health: the page mounts each exactly once — a renamed element is a
    // broken link, not an empty (and so vacuous) check.
    expect(runner).toHaveLength(1);
    expect(panel).toHaveLength(1);
    for (const tool of reasoned) {
      const mounted = getRunnerKind(tool.slug) ? runner[0]! : panel[0]!;
      expect(mounted, tool.slug).toContain("ToolRunProvider");
    }
    // Positive control, through the same reader: an element the page does
    // not wrap is seen as unwrapped.
    expect(pageElements("ToolTelemetry")[0]).not.toContain("ToolRunProvider");
  });

  describe("driven to its result, the panel says it", () => {
    for (const tool of reasoned) {
      it(`${tool.slug}: the result card says why nothing follows`, async () => {
        expect(
          getRunnerKind(tool.slug),
          `${tool.slug} has an in-browser runner: its ending is ContinueWith's, held in result-ending.test.tsx`,
        ).toBeUndefined();
        const arm = panelDispatchArms().find((a) =>
          a.slugs.includes(tool.slug),
        );
        if (!arm) throw new Error(`no server panel serves ${tool.slug}`);
        const driver = DRIVERS[arm.component];
        if (!driver)
          throw new Error(
            `${arm.component} (${tool.slug}) has a reason for no next step and no driver here — write one`,
          );
        const Panel = await panelComponent(arm);
        const network = stubJobNetwork(READY, (body) => {
          expect(body.tool).toBe(tool.slug);
          return {
            status: "completed",
            artifact: {
              artifact: artifact("out.pdf"),
              bytes: new TextEncoder().encode("%PDF-1.7"),
            },
          };
        });
        renderOnPage(tool, <Panel tool={tool} />);
        const input = await waitFor(() => {
          const el = readyFileInput();
          expect(el).not.toBeNull();
          return el!;
        });
        fireEvent.change(input, {
          target: {
            files: [
              new File(["%PDF-1.7"], "statement.pdf", {
                type: "application/pdf",
              }),
            ],
          },
        });
        await driver.drive();
        await waitFor(() => expect(network.jobBodies).toHaveLength(1));
        const card = await screen.findByRole("group", {
          name: driver.announce,
        });
        // Found, not got: since WP-10 the worker card carries its output,
        // so the reason arrives with the result's ending chunk (the
        // receipt and "Continue with"), which loads on demand.
        expect(
          (await within(card).findByText(NO_CONTINUE[tool.slug]!)).hasAttribute(
            "data-no-continue",
          ),
        ).toBe(true);
      });
    }
  });

  it("POSITIVE CONTROL: the same card outside the page's job says nothing about what follows", async () => {
    const tool = reasoned.find((t) => t.slug === "pdf-to-pdfa")!;
    const arm = panelDispatchArms().find((a) => a.slugs.includes(tool.slug))!;
    const Panel = await panelComponent(arm);
    stubJobNetwork(READY, () => ({
      status: "completed",
      artifact: {
        artifact: artifact("out.pdf"),
        bytes: new TextEncoder().encode("%PDF-1.7"),
      },
    }));
    render(<Panel tool={tool} />);
    const input = await waitFor(() => {
      const el = readyFileInput();
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.change(input, {
      target: {
        files: [
          new File(["%PDF-1.7"], "statement.pdf", { type: "application/pdf" }),
        ],
      },
    });
    await DRIVERS[arm.component]!.drive();
    await screen.findByRole("group", { name: "Your PDF/A file is ready." });
    expect(document.querySelector("[data-no-continue]")).toBeNull();
  });
});

function renderOnPage(tool: Tool, ui: React.ReactElement) {
  // In the App Router's context, as the page is: since WP-10 the worker
  // card carries its output, so it draws "Continue with", which launches.
  render(
    withAppRouter(
      <ToolRunProvider
        tool={{ slug: tool.slug, name: tool.name, category: tool.category }}
        plan={continueTargetsFor(tool, tools)}
      >
        {ui}
      </ToolRunProvider>,
    ),
  );
}
