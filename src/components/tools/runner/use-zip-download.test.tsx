// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { withoutComments } from "@/lib/tools/copy-surface";
import { ErrorNote } from "./runner-kit";
import {
  ZIP_FAILED_MESSAGE,
  ZIP_OUT_OF_MEMORY_MESSAGE,
  useZipDownload,
} from "./use-zip-download";

/**
 * Every "Download ZIP" button (PDF to image, Extract images, Split, batch
 * Compress) built its archive in a try/finally with no catch. When JSZip's
 * lazy chunk failed to load, or the archive would not fit in memory, the
 * button flipped back to its idle label, nothing downloaded, and the error
 * went to the console only. The user could not tell a failure from a slow
 * download.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({
  zip,
  save,
}: {
  zip: () => Promise<Blob>;
  save: () => void;
}) {
  const { zipping, zipError, downloadZip } = useZipDownload(zip, save);
  return (
    <div>
      <button type="button" onClick={() => void downloadZip([], "a.zip")}>
        {zipping ? "Preparing ZIP…" : "Download ZIP"}
      </button>
      {zipError && <ErrorNote message={zipError} />}
    </div>
  );
}

describe("useZipDownload — a failed ZIP is visible", () => {
  it("a rejecting build shows the error and returns the button to idle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const save = vi.fn();
    render(
      <Harness
        zip={() => Promise.reject(new Error("Loading chunk jszip failed"))}
        save={save}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("alert").textContent).toContain(ZIP_FAILED_MESSAGE);
    expect(screen.getByRole("button").textContent).toBe("Download ZIP");
    expect(save).not.toHaveBeenCalled();
  });

  it("an archive that did not fit in memory is not blamed on the connection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Harness
        zip={() =>
          Promise.reject(new RangeError("Array buffer allocation failed"))
        }
        save={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    const alert = screen.getByRole("alert").textContent;
    expect(alert).toContain(ZIP_OUT_OF_MEMORY_MESSAGE);
    expect(alert).not.toMatch(/connection/i);
  });

  it("control: a chunk that failed to load keeps the connection sentence", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Harness
        zip={() =>
          Promise.reject(
            new TypeError("Failed to fetch dynamically imported module"),
          )
        }
        save={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    const alert = screen.getByRole("alert").textContent;
    expect(alert).toContain(ZIP_FAILED_MESSAGE);
    expect(alert).not.toContain(ZIP_OUT_OF_MEMORY_MESSAGE);
  });

  it("control: a resolving build saves and shows no error", async () => {
    const save = vi.fn();
    render(
      <Harness zip={() => Promise.resolve(new Blob(["z"]))} save={save} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a retry clears the previous error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    render(
      <Harness
        zip={() =>
          fail
            ? Promise.reject(new Error("x"))
            : Promise.resolve(new Blob(["z"]))
        }
        save={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.queryByRole("alert")).not.toBeNull();
    fail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("every ZIP download in the UI goes through the hook, and shows its error", () => {
  const COMPONENTS = path.join(process.cwd(), "src", "components");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(dir, e.name))
        : /\.tsx?$/.test(e.name) && !e.name.includes(".test.")
          ? [path.join(dir, e.name)]
          : [],
    );
  const rel = (f: string) =>
    path.relative(process.cwd(), f).split(path.sep).join("/");
  const files = walk(COMPONENTS).map((f) => ({
    file: rel(f),
    source: withoutComments(readFileSync(f, "utf8")),
  }));

  /** A file that builds a ZIP by hand, or uses the hook without rendering its error. */
  function offends(source: string, file: string): string | null {
    if (/\bzipFiles\(/.test(source) && !file.endsWith("use-zip-download.ts"))
      return "calls zipFiles( directly";
    // A CALL (`= useZipDownload(`), not the hook's own definition.
    if (
      /=\s*useZipDownload\(/.test(source) &&
      !/<ErrorNote message=\{zipError\}/.test(source)
    )
      return "uses useZipDownload() but never renders zipError";
    return null;
  }

  it("health: the hook has at least the four known users", () => {
    const users = files.filter((f) => /\buseZipDownload\(\)/.test(f.source));
    expect(users.length).toBeGreaterThanOrEqual(4);
  });

  it("no offender", () => {
    const offenders = files
      .map((f) => [f.file, offends(f.source, f.file)] as const)
      .filter(([, why]) => why !== null);
    expect(offenders).toEqual([]);
  });

  it("positive control: a hand-built ZIP and an unrendered error are both flagged", () => {
    expect(
      offends(
        "try { const b = await zipFiles(x); } finally { done(); }",
        "a.tsx",
      ),
    ).toBe("calls zipFiles( directly");
    expect(offends("const { zipError } = useZipDownload();", "b.tsx")).toBe(
      "uses useZipDownload() but never renders zipError",
    );
  });
});
