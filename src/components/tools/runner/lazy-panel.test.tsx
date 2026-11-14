// @vitest-environment jsdom
import { Component, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SRC, rel } from "@/tests/tool-panel-modules";
import { isTestFile, walkFiles } from "@/tests/chunk-markers";
import { lazyPanel, type PanelProps } from "./lazy-panel";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * A shared-kind editor that is not in its page's first load can fail to
 * arrive (a dropped connection, a deploy that replaced the chunk). As
 * shipped in 2887e5a2, `Panel` fell back to `React.lazy`, which THROWS a
 * failed import to the nearest error boundary: on a flaky network the whole
 * tool became "This tool hit an unexpected snag" (review of 6376d6da,
 * reproduced with the three n-up editor chunks aborted in a served build).
 * A failed pdf-lib chunk on the same page shows an inline message and keeps
 * the page usable; the editor's failure now does the same, with a way to
 * try again that fetches the chunk anew.
 */

afterEach(cleanup);

const pdf = { file: new File(["x"], "a.pdf") } as unknown as LoadedPdf;

function Editor({ pdf: p }: PanelProps) {
  return <p>editor for {p.file.name}</p>;
}

class Boundary extends Component<{ children: ReactNode }, { hit: boolean }> {
  override state = { hit: false };
  static getDerivedStateFromError() {
    return { hit: true };
  }
  override render() {
    return this.state.hit ? <p>boundary</p> : this.props.children;
  }
}

/** A loader that fails `failures` times, then resolves. */
function flaky(failures: number) {
  let calls = 0;
  const load = () => {
    calls++;
    return calls <= failures
      ? Promise.reject(new Error("Loading chunk 3667 failed."))
      : Promise.resolve(Editor);
  };
  return { load, calls: () => calls };
}

describe("lazyPanel", () => {
  it("a chunk that fails to load is an inline message, not the error boundary, and Try again loads it", async () => {
    const { load, calls } = flaky(2);
    const { Panel, prepare } = lazyPanel(load, "Opening the editor…");
    await prepare().catch(() => {}); // the parse's attempt fails too
    render(
      <Boundary>
        <Panel pdf={pdf} onReset={() => {}} />
      </Boundary>,
    );
    expect(screen.getByText("Opening the editor…")).toBeTruthy();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/editor didn.t load/i);
    expect(screen.queryByText("boundary")).toBeNull();
    expect(calls()).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("editor for a.pdf")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(calls()).toBe(3);
  });

  it("control: once prepare has resolved, the editor draws on the first frame — no opening line", async () => {
    const { load } = flaky(0);
    const { Panel, prepare } = lazyPanel(load, "Opening the editor…");
    await prepare();
    render(<Panel pdf={pdf} onReset={() => {}} />);
    expect(screen.getByText("editor for a.pdf")).toBeTruthy();
    expect(screen.queryByText("Opening the editor…")).toBeNull();
  });

  it("without prepare, the opening line shows until the chunk lands", async () => {
    const { load } = flaky(0);
    const { Panel } = lazyPanel(load, "Opening the editor…");
    render(<Panel pdf={pdf} onReset={() => {}} />);
    expect(screen.getByText("Opening the editor…")).toBeTruthy();
    await act(async () => {});
    expect(screen.getByText("editor for a.pdf")).toBeTruthy();
  });
});

/**
 * As first shipped, the editor's chunks were requested only at the pick,
 * beside the parse's own: nine requests at once, and over HTTP/1.1 the last
 * three queued behind the six-connection limit — about +100 ms from pick to
 * a usable editor at 200 ms latency (review of 6376d6da). `useIntent` starts
 * the fetch at the first sign a file is coming.
 */
describe("lazyPanel's useIntent", () => {
  function Stage({ intent }: { intent: () => void }) {
    intent();
    return (
      <>
        <div data-runner-stage="">
          <button type="button">browse</button>
        </div>
        <a href="#elsewhere">elsewhere</a>
      </>
    );
  }

  it("a press in the runner's stage fetches the editor once; a press elsewhere does not", async () => {
    const { load, calls } = flaky(0);
    const { useIntent } = lazyPanel(load, "Opening…");
    render(<Stage intent={useIntent} />);
    fireEvent.pointerDown(screen.getByText("elsewhere"));
    expect(calls()).toBe(0);
    fireEvent.pointerDown(screen.getByText("browse"));
    fireEvent.focusIn(screen.getByText("browse"));
    expect(calls()).toBe(1);
    await act(async () => {});
  });

  it("a file dragged or pasted anywhere on the page fetches it", () => {
    for (const type of ["dragEnter", "paste"] as const) {
      const { load, calls } = flaky(0);
      const { useIntent } = lazyPanel(load, "Opening…");
      render(<Stage intent={useIntent} />);
      fireEvent[type](screen.getByText("elsewhere"));
      expect(calls(), type).toBe(1);
      cleanup();
    }
  });

  it("a failed early fetch is forgotten: the parse's prepare asks again, and the panel draws", async () => {
    const { load, calls } = flaky(1);
    const { useIntent, prepare, Panel } = lazyPanel(load, "Opening…");
    render(<Stage intent={useIntent} />);
    fireEvent.pointerDown(screen.getByText("browse"));
    await act(async () => {});
    expect(calls()).toBe(1);
    await prepare();
    expect(calls()).toBe(2);
    cleanup();
    render(<Panel pdf={pdf} onReset={() => {}} />);
    expect(screen.getByText("editor for a.pdf")).toBeTruthy();
  });
});

describe("every lazyPanel's drop box calls its useIntent", () => {
  it("each `const X = lazyPanel(…)` under src/components has an `X.useIntent()` in its file", () => {
    const sites: string[] = [];
    const missing: string[] = [];
    for (const file of walkFiles(
      path.join(SRC, "components"),
      (n) => /\.tsx?$/.test(n) && !isTestFile(n),
    )) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/const (\w+) = lazyPanel\(/g)) {
        sites.push(`${rel(file)}:${m[1]}`);
        if (!text.includes(`${m[1]}.useIntent()`))
          missing.push(`${rel(file)}:${m[1]}`);
      }
    }
    // 5 on 2026-11-14 (n-up, booklet, metadata, remove-annotations,
    // bookmarks): a floor, so a reader that finds nothing cannot pass.
    expect(sites.length).toBeGreaterThanOrEqual(5);
    expect(missing).toEqual([]);
  });
});
