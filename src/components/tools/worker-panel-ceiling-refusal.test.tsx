// @vitest-environment jsdom
/**
 * An over-ceiling file is refused at the pick, in the panel, in the page's own
 * words, and before anything uploads.
 *
 * The Office and HTML panels call `fileOverCeilingMessage` from their
 * Dropzone's `onFiles`. The function had a unit test. The two call sites had
 * none: with both replaced by `null` the whole suite stayed green. The upload
 * session's own validator still refuses the file, so the defect would not come
 * back, but the user would read "...exceeds the 52428800-byte per-file limit."
 * after a round trip, instead of the MB figure the page states.
 *
 * THE SUBJECTS ARE DISCOVERED, not typed. The tool page decides which slugs
 * mount which panel, so the slugs are read from that branch of
 * `src/app/tools/[slug]/page.tsx`. A tool routed to one of these panels that
 * takes a file must show a file picker, and must refuse above its ceiling.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import {
  fileOverCeilingMessage,
  toolFileCeilingBytes,
  toolFileCeilingMb,
} from "@/lib/tools/file-ceilings";
import { canRunHtmlRender } from "@/lib/workers/html-render-client";
import { canRunOfficeConversion } from "@/lib/workers/office-conversion-client";
import { resetTelemetry } from "@/lib/telemetry/track";
import { READY_WORKER_STATUS as READY } from "@/tests/ready-worker-status";
import { HtmlRenderWorkerPanel } from "./html-render-worker-panel";
import { OfficeConversionWorkerPanel } from "./office-conversion-worker-panel";

const PAGE = readFileSync(
  resolve(process.cwd(), "src/app/tools/[slug]/page.tsx"),
  "utf8",
);

/**
 * The slugs the page's ternary routes to `<name tool={tool} />`: the
 * `tool.slug === "..."` conditions between the previous `) :` and the `? (`
 * that opens this branch.
 */
function routedSlugs(name: string): string[] {
  const tag = `<${name} tool={tool} />`;
  const at = PAGE.indexOf(tag);
  expect(at, `${tag} is not mounted by the tool page`).toBeGreaterThan(0);
  expect(PAGE.indexOf(tag, at + 1), `${tag} is mounted twice`).toBe(-1);
  const before = PAGE.slice(0, at);
  const condition = before.slice(
    before.lastIndexOf(") :"),
    before.lastIndexOf("? ("),
  );
  return [...condition.matchAll(/tool\.slug === "([^"]+)"/g)].map((m) => m[1]!);
}

const PANELS: {
  name: string;
  Panel: ComponentType<{ tool: Tool }>;
  canRun: (status: typeof READY) => boolean;
}[] = [
  {
    name: "OfficeConversionWorkerPanel",
    Panel: OfficeConversionWorkerPanel,
    canRun: canRunOfficeConversion,
  },
  {
    name: "HtmlRenderWorkerPanel",
    Panel: HtmlRenderWorkerPanel,
    canRun: canRunHtmlRender,
  },
];

/** Every routed tool that takes a file, per panel. */
const SUBJECTS = PANELS.map((panel) => ({
  ...panel,
  tools: routedSlugs(panel.name)
    .map((slug) => {
      const tool = getToolBySlug(slug);
      expect(
        tool,
        `routed slug "${slug}" is not in the catalogue`,
      ).toBeDefined();
      return tool!;
    })
    .filter((tool) => toolFileCeilingBytes(tool) !== null),
}));

function stubNetwork() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/worker/status")) {
      return { ok: true, json: async () => READY } as Response;
    }
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const blocked = (el: Element) => el.getAttribute("aria-disabled") === "true";

/** A file with the panel's first accepted extension, reporting `size` bytes. */
function fileOfSize(input: HTMLInputElement, size: number): File {
  const ext =
    input.accept
      .split(",")
      .map((part) => part.trim())
      .find((part) => part.startsWith(".")) ?? ".bin";
  const file = new File([new Uint8Array([1, 2, 3])], `upload${ext}`);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

async function renderReady(Panel: ComponentType<{ tool: Tool }>, tool: Tool) {
  const fetchMock = stubNetwork();
  const { container } = render(<Panel tool={tool} />);
  const input = await waitFor(() => {
    const found =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(found, `${tool.slug} shows no file picker`).not.toBeNull();
    return found!;
  });
  const run = container.querySelector('button[aria-disabled="true"]');
  expect(
    run,
    `${tool.slug}: no blocked run button before a pick`,
  ).not.toBeNull();
  return { fetchMock, input, run: run! };
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("health checks: the discovered corpus is the one the page routes", () => {
  it("each panel is routed at least one tool that takes a file, and the stub is ready", () => {
    for (const { name, tools, canRun } of SUBJECTS) {
      expect(
        tools.length,
        `${name}: no file-taking tool routed`,
      ).toBeGreaterThan(0);
      expect(canRun(READY), `${name}: READY does not show its builder`).toBe(
        true,
      );
    }
    // Office routes three tools today; losing one would shrink the corpus
    // silently, so the total is bounded below by what the page mounts now.
    const total = SUBJECTS.reduce((n, s) => n + s.tools.length, 0);
    expect(total).toBeGreaterThanOrEqual(4);
  });
});

describe.each(
  SUBJECTS.flatMap(({ name, Panel, tools }) =>
    tools.map((tool) => ({ name, Panel, tool, slug: tool.slug })),
  ),
)("$name for $slug", ({ Panel, tool }) => {
  it("refuses a file one byte over the ceiling, in the page's MB figure, before any upload", async () => {
    const ceiling = toolFileCeilingBytes(tool)!;
    const { fetchMock, input, run } = await renderReady(Panel, tool);

    fireEvent.change(input, {
      target: { files: [fileOfSize(input, ceiling + 1)] },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(fileOverCeilingMessage(tool, ceiling + 1)!);
    expect(alert).toHaveTextContent(`${toolFileCeilingMb(tool)} MB`);
    expect(alert).not.toHaveTextContent(/byte per-file limit/);
    // Nothing staged, nothing sent.
    expect(blocked(run)).toBe(true);
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => !String(url).includes("/api/worker/status"),
      ),
    ).toEqual([]);
  });

  it("control: a file exactly at the ceiling is staged with no refusal", async () => {
    const ceiling = toolFileCeilingBytes(tool)!;
    const { input, run } = await renderReady(Panel, tool);
    const file = fileOfSize(input, ceiling);

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(file.name)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(blocked(run)).toBe(false);
  });
});
