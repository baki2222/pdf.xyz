// @vitest-environment jsdom
// @native-canvas
/**
 * A HAND-OFF opens every worker batch (batch plan P6), through each page's
 * OWN panel: the module the tool page mounts (`ownPanelModules`, read from
 * the page's dispatch), three Files carried exactly as `launchWithFiles`
 * carries them (the hand-off store, the tab's carry key, the tool's own
 * address), and the panel's own claim (`useStagedHandoff`).
 *
 * The composed chain, per slug: capability → claim → the panel's staged
 * callback → its fork → the batch list. Each link has a unit test of its
 * own; this is the one that fails when a panel's staged callback still takes
 * `files[0]` while everything around it is right. The SET is the
 * registration (`WORKER_BATCH_TOOLS`), each panel found from the page.
 *
 * For every registered tool, three carried files make:
 *   - the batch list with three rows, not the single-file panel;
 *   - no request to our server but the panel's status check — nothing is
 *     uploaded before Run.
 * HTML to PDF is the negative control: it shares EPUB to PDF's panel, has
 * no batch, and stages the first file alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { WORKER_BATCH_TOOLS } from "@/lib/batch/tools";
import {
  __setHandoffStoreForTests,
  HandoffStore,
  MemoryHandoffBackend,
  stashHandoff,
} from "@/lib/handoff";
import { carryHandoff } from "@/lib/handoff/carry";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import { ownPanelModules } from "@/tests/tool-panel-modules";

const EXTENSION: Record<string, { ext: string; type: string }> = {
  PDF: { ext: "pdf", type: "application/pdf" },
  DOCX: {
    ext: "docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  XLSX: {
    ext: "xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  PPTX: {
    ext: "pptx",
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  EPUB: { ext: "epub", type: "application/epub+zip" },
  HTML: { ext: "html", type: "text/html" },
};

function fileFor(tool: Tool, name: string): File {
  const format = tool.accept.find((f) => f in EXTENSION);
  if (!format) throw new Error(`${tool.slug}: no fixture for ${tool.accept}`);
  const { ext, type } = EXTENSION[format]!;
  return new File(["%PDF-1.7\n%%EOF\n"], `${name}.${ext}`, { type });
}

const { bySlug } = ownPanelModules();

async function panelFor(slug: string): Promise<ComponentType<{ tool: Tool }>> {
  const panel = bySlug.get(slug);
  if (!panel || panel.dispatch !== "worker")
    throw new Error(`${slug}: its page mounts no worker panel`);
  const mod = (await import(/* @vite-ignore */ panel.file)) as Record<
    string,
    ComponentType<{ tool: Tool }>
  >;
  const Panel = mod[panel.name];
  if (!Panel) throw new Error(`${panel.file} exports no ${panel.name}`);
  return Panel;
}

let requests: string[] = [];
beforeEach(() => {
  requests = [];
  window.sessionStorage.clear();
  __setHandoffStoreForTests(
    new HandoffStore({ backend: new MemoryHandoffBackend() }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/api/worker/status"))
        return new Response(JSON.stringify(READY_WORKER_STATUS), {
          headers: { "content-type": "application/json" },
        });
      throw new TypeError(`unexpected request before Run: ${url}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  __setHandoffStoreForTests(null);
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

/** Carry three of the tool's files to its page, as a launch does, and render it. */
async function carryThree(slug: string) {
  const tool = getToolBySlug(slug)!;
  const files = ["first", "second", "third"].map((n) => fileFor(tool, n));
  const id = await stashHandoff(slug, files, {
    origin: { kind: "workspace" },
  });
  expect(id, `${slug}: the hand-off was not stored`).not.toBeNull();
  const path = `/tools/${slug}`;
  expect(carryHandoff(path, id!)).toBe(true);
  window.history.replaceState(null, "", path);
  const Panel = await panelFor(slug);
  render(<Panel tool={tool} />);
  return files;
}

const SLUGS = Object.keys(WORKER_BATCH_TOOLS);

describe("a hand-off of three files to a worker batch", () => {
  it("health: the registration is the set walked, every slug with its own panel", () => {
    expect(SLUGS.length).toBeGreaterThanOrEqual(13);
    for (const slug of SLUGS) expect(bySlug.get(slug)?.dispatch).toBe("worker");
  });

  it.each(SLUGS)(
    "%s opens its batch list with all three, and sends nothing",
    async (slug) => {
      const files = await carryThree(slug);
      const list = await screen.findByRole(
        "list",
        { name: "Files in this batch" },
        { timeout: 5000 },
      );
      await waitFor(() =>
        expect(list.querySelectorAll(":scope > li")).toHaveLength(3),
      );
      for (const file of files) expect(list.textContent).toContain(file.name);
      // Positive control: the counter sees the panel's own status check.
      expect(requests.some((u) => u.includes("/api/worker/status"))).toBe(true);
      expect(
        requests.filter((u) => !u.includes("/api/worker/status")),
        "a request other than the status check before Run",
      ).toEqual([]);
    },
  );

  it("control: HTML to PDF, the same panel with no batch, stages the first file alone", async () => {
    await carryThree("html-to-pdf");
    await screen.findByText("first.html", undefined, { timeout: 5000 });
    expect(screen.queryByRole("list", { name: "Files in this batch" })).toBe(
      null,
    );
    expect(screen.queryByText("second.html")).toBeNull();
  });
});
