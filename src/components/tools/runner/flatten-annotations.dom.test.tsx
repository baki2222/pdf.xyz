// @vitest-environment jsdom
/**
 * Audit flatten-pdf#3, as a person reaches it: Flatten PDF's editor and its
 * batch both offer "Also flatten comments and markup", off by default. Each
 * check decodes the DOWNLOADED bytes: the page's /Annots after the run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import JSZip from "jszip";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { FlattenEditor } from "./flatten-runner";
import { FlattenBatch } from "./batch/flatten-batch";

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};
function Router({ children }: { children: ReactNode }) {
  return (
    <AppRouterContext.Provider value={router as never}>
      {children}
    </AppRouterContext.Provider>
  );
}

let downloads: { name: string; blob: Blob }[] = [];
let pending: Blob | null = null;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
beforeEach(() => {
  downloads = [];
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) pending = obj;
    return "blob:flatten-annotations";
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (pending) downloads.push({ name: this.download, blob: pending });
    pending = null;
  });
});
afterEach(() => {
  cleanup();
  resetAnnouncer();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

/** No form at all: a stamp and an ink mark with appearances, and a link. */
async function markedUpPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  const ctx = doc.context;
  const ap = (w: number, h: number) =>
    ctx.register(
      ctx.flateStream(`0 g 0 0 ${w} ${h} re f`, {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, w, h],
      }),
    );
  const refs = [
    ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Stamp",
        Rect: [40, 400, 160, 440],
        AP: ctx.obj({ N: ap(120, 40) }),
      }),
    ),
    ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Ink",
        Rect: [200, 400, 260, 440],
        InkList: [[200, 400, 260, 440]],
        AP: ctx.obj({ N: ap(60, 40) }),
      }),
    ),
    ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [40, 300, 160, 320],
        A: ctx.obj({ S: "URI", URI: PDFString.of("https://example.com/") }),
      }),
    ),
  ];
  page.node.set(PDFName.of("Annots"), ctx.obj(refs));
  return doc.save();
}

async function subtypes(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"));
  if (!(annots instanceof PDFArray)) return [];
  return annots
    .asArray()
    .map((r) => doc.context.lookup(r) as PDFDict)
    .map((d) => d.get(PDFName.of("Subtype"))!.toString().slice(1))
    .sort();
}

const file = (bytes: Uint8Array, name: string) =>
  new File([bytes.slice()], name, { type: "application/pdf" });

describe("Also flatten comments and markup (audit flatten-pdf#3)", () => {
  it(
    "the editor counts the markup, and with the box ticked the download keeps only the link",
    { timeout: 60_000 },
    async () => {
      const bytes = await markedUpPdf();
      render(
        <Router>
          <FlattenEditor
            pdf={{
              file: file(bytes, "notes.pdf"),
              bytes,
              pageCount: 1,
              rotations: [0],
              digitalSignatures: 0,
            }}
            onReset={() => {}}
          />
        </Router>,
      );
      await screen.findByText(/2 comments or markup annotations/);
      const box = screen.getByRole("checkbox", {
        name: /Also flatten comments and markup/,
      });
      expect((box as HTMLInputElement).checked).toBe(false);
      fireEvent.click(box);
      fireEvent.click(screen.getByRole("button", { name: /^Flatten/ }));
      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: /Download flattened PDF/ },
          { timeout: 30_000 },
        ),
      );
      await waitFor(() => expect(downloads).toHaveLength(1));
      expect(downloads[0]!.name).toBe("notes-flattened.pdf");
      const out = new Uint8Array(await downloads[0]!.blob.arrayBuffer());
      expect(await subtypes(out)).toEqual(["Link"]);
    },
  );

  it(
    "unticked (the default), the editor re-saves with the markup still live",
    { timeout: 60_000 },
    async () => {
      const bytes = await markedUpPdf();
      render(
        <Router>
          <FlattenEditor
            pdf={{
              file: file(bytes, "notes.pdf"),
              bytes,
              pageCount: 1,
              rotations: [0],
              digitalSignatures: 0,
            }}
            onReset={() => {}}
          />
        </Router>,
      );
      await screen.findByText(/2 comments or markup annotations/);
      fireEvent.click(screen.getByRole("button", { name: /Re-save PDF/ }));
      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: /^Download PDF$/ },
          { timeout: 30_000 },
        ),
      );
      await waitFor(() => expect(downloads).toHaveLength(1));
      const out = new Uint8Array(await downloads[0]!.blob.arrayBuffer());
      expect(await subtypes(out)).toEqual(["Ink", "Link", "Stamp"]);
    },
  );

  it(
    "the batch carries the option into every file",
    { timeout: 60_000 },
    async () => {
      const bytes = await markedUpPdf();
      render(
        <Router>
          <FlattenBatch
            files={[file(bytes, "a.pdf"), file(bytes, "b.pdf")]}
            onReset={() => {}}
            onSingle={() => {}}
            arrival={null}
          />
        </Router>,
      );
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: /Also flatten comments and markup/,
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Flatten 2 PDFs" }));
      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: "Download all (2)" },
          { timeout: 30_000 },
        ),
      );
      await waitFor(() => expect(downloads).toHaveLength(1));
      const zip = await JSZip.loadAsync(await downloads[0]!.blob.arrayBuffer());
      const names = Object.keys(zip.files).sort();
      expect(names).toEqual(["a-flattened.pdf", "b-flattened.pdf"]);
      for (const name of names)
        expect(
          await subtypes(await zip.file(name)!.async("uint8array")),
          name,
        ).toEqual(["Link"]);
    },
  );
});
