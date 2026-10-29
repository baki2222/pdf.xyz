// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  sharedPdfWorker,
  withSharedWorker,
  type PdfWorkerLike,
} from "./pdfjs-worker";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/**
 * The shared pdf.js worker's lifecycle, against a stand-in `PDFWorker` with
 * pdfjs's own surface (`destroyed`, `promise`, `destroy()`). The composed
 * chain — one `pdf.worker` request per page in a real browser — is
 * `e2e/pdfjs-worker.spec.ts`; this pins the decisions it rests on.
 */

let made: FakeWorker[] = [];

class FakeWorker implements PdfWorkerLike {
  destroyed = false;
  readonly promise: Promise<void>;
  fail!: (e: Error) => void;
  constructor() {
    this.promise = new Promise<void>((resolve, reject) => {
      this.fail = reject;
      if (!FakeWorker.failNext) resolve();
    });
    FakeWorker.failNext = false;
    made.push(this);
  }
  static failNext = false;
  destroy() {
    this.destroyed = true;
  }
}

/** A different PDFWorker class: what a second copy of pdfjs would bring. */
class OtherWorker extends FakeWorker {}

afterEach(() => {
  // Leave no worker for the next test to adopt.
  for (const w of made) w.destroy();
  made = [];
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("sharedPdfWorker", () => {
  it("hands every caller the same worker", () => {
    const a = sharedPdfWorker(FakeWorker);
    const b = sharedPdfWorker(FakeWorker);
    expect(b).toBe(a);
    expect(made).toHaveLength(1);
  });

  it("recreates lazily after the worker is terminated", () => {
    const first = sharedPdfWorker(FakeWorker);
    first.destroy();
    // Nothing is built at the moment of death — only at the next use.
    expect(made).toHaveLength(1);
    const second = sharedPdfWorker(FakeWorker);
    expect(second).not.toBe(first);
    expect(second.destroyed).toBe(false);
    expect(made).toHaveLength(2);
    // And the new one is then shared in turn.
    expect(sharedPdfWorker(FakeWorker)).toBe(second);
  });

  it("forgets a worker that failed to start", async () => {
    FakeWorker.failNext = true;
    const broken = sharedPdfWorker(FakeWorker);
    broken.fail(new Error("worker script 404"));
    await expect(broken.promise).rejects.toThrow("404");
    await settle();
    const next = sharedPdfWorker(FakeWorker);
    expect(next).not.toBe(broken);
    expect(made).toHaveLength(2);
  });

  it("a late failure of a REPLACED worker does not drop the current one", async () => {
    FakeWorker.failNext = true;
    const old = sharedPdfWorker(FakeWorker);
    old.destroy();
    const current = sharedPdfWorker(FakeWorker);
    old.fail(new Error("late"));
    await old.promise.catch(() => {});
    await settle();
    expect(sharedPdfWorker(FakeWorker)).toBe(current);
  });

  it("does not hand a worker from another pdfjs copy to this one", () => {
    const a = sharedPdfWorker(FakeWorker);
    const b = sharedPdfWorker(OtherWorker);
    expect(b).not.toBe(a);
    expect(b).toBeInstanceOf(OtherWorker);
  });
});

describe("withSharedWorker", () => {
  const host = () => {
    const seen: unknown[] = [];
    const pdfjs = {
      PDFWorker: FakeWorker,
      getDocument(src: object) {
        seen.push(src);
        return { src };
      },
      version: "x",
    };
    return { pdfjs, seen };
  };

  it("opens every document in the one worker, and keeps the rest of the module", () => {
    const { pdfjs, seen } = host();
    const wrapped = withSharedWorker(pdfjs);
    wrapped.getDocument({ data: new Uint8Array(1) });
    wrapped.getDocument({ data: new Uint8Array(2) });
    const workers = seen.map((s) => (s as { worker: unknown }).worker);
    expect(workers[0]).toBeInstanceOf(FakeWorker);
    expect(workers[1]).toBe(workers[0]);
    expect(made).toHaveLength(1);
    expect(wrapped.version).toBe("x");
    expect(wrapped.PDFWorker).toBe(FakeWorker);
  });

  it("control: the unwrapped module would get no worker, so pdfjs makes one per document", () => {
    const { pdfjs, seen } = host();
    pdfjs.getDocument({ data: new Uint8Array(1) });
    expect((seen[0] as { worker?: unknown }).worker).toBeUndefined();
  });

  it("a caller's own worker is kept", () => {
    const { pdfjs, seen } = host();
    const own = new FakeWorker();
    withSharedWorker(pdfjs).getDocument({
      data: new Uint8Array(1),
      worker: own,
    });
    expect((seen[0] as { worker: unknown }).worker).toBe(own);
  });

  it("after the shared worker dies, the next document opens in a new one", () => {
    const { pdfjs, seen } = host();
    const wrapped = withSharedWorker(pdfjs);
    wrapped.getDocument({ data: new Uint8Array(1) });
    const first = (seen[0] as { worker: FakeWorker }).worker;
    first.destroy();
    wrapped.getDocument({ data: new Uint8Array(1) });
    const second = (seen[1] as { worker: FakeWorker }).worker;
    expect(second).not.toBe(first);
    expect(second.destroyed).toBe(false);
  });

  // The source guards over `getDocument` judge the callers, and do not read
  // the forwarder as a call site; this is the half they cannot see. With the
  // REAL defaults: a forward that dropped `wasmUrl` would decode JPEG2000 and
  // JBIG2 to nothing, silently, at every call site at once.
  it("forwards every option a caller writes, PDFJS_DOCUMENT_DEFAULTS included", () => {
    const { pdfjs, seen } = host();
    const data = new Uint8Array(4);
    const task = withSharedWorker(pdfjs).getDocument({
      data,
      ...PDFJS_DOCUMENT_DEFAULTS,
      password: "p",
    });
    const passed = seen[0] as Record<string, unknown>;
    expect(passed).toMatchObject({ ...PDFJS_DOCUMENT_DEFAULTS, password: "p" });
    expect(passed.data).toBe(data);
    expect(Object.keys(passed).sort()).toEqual(
      [
        ...Object.keys(PDFJS_DOCUMENT_DEFAULTS),
        "data",
        "password",
        "worker",
      ].sort(),
    );
    // And the task comes back to the caller, who awaits it.
    expect(task).toEqual({ src: passed });
  });

  it("bytes passed bare are left to pdfjs untouched", () => {
    const { pdfjs, seen } = host();
    const bytes = new Uint8Array(3);
    withSharedWorker(pdfjs).getDocument(bytes);
    expect(seen[0]).toBe(bytes);
  });
});
