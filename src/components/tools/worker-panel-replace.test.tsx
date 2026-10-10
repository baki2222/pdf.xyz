// @vitest-environment jsdom
/**
 * A worker panel with a file chosen keeps its page's drops: a second file
 * dropped anywhere on the page replaces the chosen one, through the panel's
 * own gates, and is said.
 *
 * WHAT SHIPPED (WP-07 review): the 13 panels render `file ? <chip/> :
 * <Dropzone pageTarget/>`, and the zone was the page's only target — so
 * once a file was chosen the page had none. A second PDF dropped on Protect
 * PDF opened the ticket dialog, which never offers the page's own tool: its
 * top rows were Compress, Sign and Edit. The chip is now the page's target
 * (`ChosenFileTarget`, verb "replace").
 *
 * Composed as the tool page composes it — the tool's identity (the page's
 * `data-tool-name` around the panel), the panel with the worker answering
 * ready, the real drop layer and live region, and a heading outside the
 * panel for the file to land on — over EVERY panel the page's registry
 * routes (`@/tests/worker-panel-dispatch`), each with the first tool
 * routed to it that takes a file. The source-level half (a
 * zone that is one branch of a condition leaves a target behind it, with
 * the zone's own `accept` and `refuse`) is `page-target-sites.test.ts`.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LiveRegion, resetAnnouncer } from "@/components/a11y/live-region";
import { DropLayer } from "@/components/intent/drop-layer";
import {
  activePageTarget,
  resetPageTargetsForTests,
} from "@/lib/intent/page-target";
import {
  EXTENSIONS_BY_FORMAT,
  MIME_BY_FORMAT,
} from "@/lib/jobs/mime-by-format";
import {
  fileOverCeilingMessage,
  toolFileCeilingBytes,
} from "@/lib/tools/file-ceilings";
import type { Tool } from "@/lib/tools/types";
import { resetTelemetry } from "@/lib/telemetry/track";
import { withAppRouter } from "@/tests/app-router";
import { READY_WORKER_STATUS as READY } from "@/tests/ready-worker-status";
import {
  catalogTool,
  panelComponent,
  panelDispatchArms,
} from "@/tests/worker-panel-dispatch";

const SUBJECTS = panelDispatchArms().flatMap((arm) => {
  const tool = arm.slugs
    .map(catalogTool)
    .find((t) => toolFileCeilingBytes(t) !== null);
  return tool ? [{ arm, tool, name: arm.component }] : [];
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  resetPageTargetsForTests();
  resetAnnouncer();
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A file of the tool's first format, named and typed as a browser would. */
function fileFor(tool: Tool, stem: string, size?: number): File {
  const format = tool.accept[0]!.toUpperCase();
  const ext = EXTENSIONS_BY_FORMAT[format]?.[0] ?? format.toLowerCase();
  const file = new File(
    [new Uint8Array([0x25, 0x50, 0x44, 0x46])],
    `${stem}.${ext}`,
    {
      type: MIME_BY_FORMAT[format]?.[0] ?? "",
    },
  );
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
}

function dropOn(el: Element, files: File[]) {
  const dataTransfer = {
    types: ["Files"],
    files,
    items: files.map((f) => ({ kind: "file", type: f.type })),
    dropEffect: "none",
  };
  for (const type of ["dragenter", "dragover", "drop"]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer });
    act(() => {
      el.dispatchEvent(event);
    });
  }
}

const liveText = () =>
  document.querySelector('[aria-live="polite"][aria-atomic="true"]')
    ?.textContent ?? "";

describe("health: the corpus is every panel the page routes", () => {
  it("13 or more panels, each with a file-taking tool", () => {
    expect(SUBJECTS.length).toBeGreaterThanOrEqual(13);
  });
});

describe.each(SUBJECTS)("$name", { timeout: 30_000 }, ({ arm, tool }) => {
  it("with a file chosen, a file dropped anywhere replaces it and is said; one it refuses is said there and replaces nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/worker/status"))
          return { ok: true, json: async () => READY } as Response;
        throw new TypeError("Failed to fetch");
      }),
    );
    const Panel = await panelComponent(arm);
    const { container } = render(
      withAppRouter(
        <>
          <h1>{tool.name}</h1>
          <div data-tool-panel data-tool-name={tool.name}>
            <Panel tool={tool} />
          </div>
          <DropLayer />
          <LiveRegion />
        </>,
      ),
    );
    const input = await waitFor(() => {
      const found =
        container.querySelector<HTMLInputElement>('input[type="file"]');
      if (!found) throw new Error(`${tool.slug} shows no file picker`);
      return found;
    });
    const first = fileFor(tool, "alpha");
    fireEvent.change(input, { target: { files: [first] } });
    expect(await screen.findByText(first.name)).toBeInTheDocument();
    // The zone is gone; the chip is the page's target now — once its box
    // (`ChosenFileLive`, fetched with the file it shows) is here: a cold
    // import under a loaded test run.
    await waitFor(() => expect(activePageTarget()?.verb).toBe("replace"), {
      timeout: 10_000,
    });
    expect(activePageTarget()?.name).toBe(tool.name);
    expect(activePageTarget()?.current).toBe(first.name);
    expect(container.querySelectorAll("[data-page-drop-target]")).toHaveLength(
      1,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    const second = fileFor(tool, "beta");
    dropOn(heading, [second]);
    expect(await screen.findByText(second.name)).toBeInTheDocument();
    expect(screen.queryByText(first.name)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(liveText()).toBe(
        `Replaced ${first.name} with ${second.name} in ${tool.name}.`,
      ),
    );

    // Its own gate: one byte over the ceiling is refused, in its words.
    const ceiling = toolFileCeilingBytes(tool)!;
    const big = fileFor(tool, "huge", ceiling + 1);
    dropOn(heading, [big]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(fileOverCeilingMessage(tool, ceiling + 1)!);
    expect(screen.getByText(second.name)).toBeInTheDocument();
  });
});
