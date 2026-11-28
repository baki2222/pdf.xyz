// @vitest-environment jsdom
/**
 * Audit page-numbers#2: the box behind the number, as a person reaches it.
 * The single-file editor and the batch each draw it into the file they hand
 * over; both checks decode the DOWNLOADED bytes (the box's fill before the
 * number's text, and the opacity its graphics state resolves to), not the
 * options the runner passed.
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
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { PageNumbersEditor } from "./page-numbers-runner";
import { PageNumbersBatch } from "./batch/page-numbers-batch";
import type { LoadedPdf } from "./use-single-pdf";

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
    return "blob:page-numbers-box";
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

async function pdfOfPages(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([300, 400]);
  return doc.save();
}

const pdfFile = (bytes: Uint8Array, name: string) =>
  new File([bytes.slice()], name, { type: "application/pdf" });

/**
 * Page 1's last box before its last text object: the fill colour, and the
 * /ca its `gs` resolves to (null when there is no box at all).
 */
async function boxOf(
  bytes: Uint8Array,
): Promise<{ fill: string; ca: number } | null> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  const ops = streams
    .map((s) =>
      new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode()),
    )
    .join("\n");
  const head = ops.slice(0, ops.lastIndexOf("BT"));
  const start = head.lastIndexOf("/GS");
  if (start < 0 || !/\bh\s+f\b/.test(head.slice(start))) return null;
  const seg = head.slice(start);
  const name = /^\/(\S+) gs/.exec(seg)![1]!;
  const ca = page.node
    .Resources()!
    .lookup(PDFName.of("ExtGState"), PDFDict)
    .lookup(PDFName.of(name), PDFDict)
    .lookup(PDFName.of("ca"), PDFNumber)
    .asNumber();
  const fill = /(\S+ \S+ \S+) rg/.exec(seg)![1]!;
  return { fill, ca };
}

describe("page-number box, from the editor and the batch (audit page-numbers#2)", () => {
  it(
    "the editor draws the box at the chosen opacity into the download",
    { timeout: 60_000 },
    async () => {
      const bytes = await pdfOfPages(2);
      const pdf: LoadedPdf = {
        file: pdfFile(bytes, "scan.pdf"),
        bytes,
        pageCount: 2,
        rotations: [0, 0],
        digitalSignatures: 0,
      };
      render(
        <Router>
          <PageNumbersEditor pdf={pdf} onReset={() => {}} />
        </Router>,
      );
      // Off until asked for: no opacity control yet.
      expect(screen.queryByLabelText("Box opacity")).toBeNull();
      fireEvent.click(
        screen.getByRole("checkbox", { name: /Box behind the number/ }),
      );
      fireEvent.change(screen.getByLabelText("Box opacity"), {
        target: { value: "50" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Add page numbers/ }));
      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: /Download numbered PDF/ },
          { timeout: 30_000 },
        ),
      );
      expect(downloads).toHaveLength(1);
      const out = new Uint8Array(await downloads[0]!.blob.arrayBuffer());
      const box = await boxOf(out);
      expect(box).not.toBeNull();
      expect(box!.fill).toBe("1 1 1");
      expect(box!.ca).toBeCloseTo(0.5);
    },
  );

  it(
    "the batch carries the box into every file",
    { timeout: 60_000 },
    async () => {
      render(
        <Router>
          <PageNumbersBatch
            files={[
              pdfFile(await pdfOfPages(1), "a.pdf"),
              pdfFile(await pdfOfPages(2), "b.pdf"),
            ]}
            onReset={() => {}}
            onSingle={() => {}}
            arrival={null}
          />
        </Router>,
      );
      fireEvent.click(
        screen.getByRole("checkbox", { name: /Box behind the number/ }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Number 2 PDFs" }));
      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: "Download all (2)" },
          { timeout: 30_000 },
        ),
      );
      await waitFor(() => expect(downloads).toHaveLength(1));
      const zip = await JSZip.loadAsync(
        await downloads.at(-1)!.blob.arrayBuffer(),
      );
      const names = Object.keys(zip.files);
      expect(names).toHaveLength(2);
      for (const name of names) {
        const box = await boxOf(await zip.file(name)!.async("uint8array"));
        expect(box, name).not.toBeNull();
        expect(box!.fill).toBe("1 1 1");
        expect(box!.ca).toBe(1);
      }
    },
  );

  it("the editor leaves the box off by default (control)", async () => {
    const bytes = await pdfOfPages(1);
    render(
      <Router>
        <PageNumbersEditor
          pdf={{
            file: pdfFile(bytes, "plain.pdf"),
            bytes,
            pageCount: 1,
            rotations: [0],
            digitalSignatures: 0,
          }}
          onReset={() => {}}
        />
      </Router>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add page numbers/ }));
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: /Download numbered PDF/ },
        { timeout: 30_000 },
      ),
    );
    const out = new Uint8Array(await downloads[0]!.blob.arrayBuffer());
    expect(await boxOf(out)).toBeNull();
  });
});
