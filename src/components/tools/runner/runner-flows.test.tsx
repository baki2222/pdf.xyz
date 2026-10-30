// @vitest-environment jsdom
// @native-canvas
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  OBJSTM_FIXTURE_TEXT,
  OWNER_ONLY_OBJSTM_PDF_BASE64,
  OWNER_ONLY_PDF_BASE64,
  USER_PASSWORD_PDF_BASE64,
} from "@/tests/fixtures-encrypted";
import { PdfToTextRunner } from "./pdf-to-text-runner";
import { TextToPdfRunner } from "./text-to-pdf-runner";
import { MarkdownToPdfRunner } from "./markdown-to-pdf-runner";
import { ImageToPdfRunner } from "./image-to-pdf-runner";
import { isImageAllowedForKind } from "@/lib/pdf/image-to-pdf";
import { HandoffLoadedBadge } from "./handoff-notice";
import { RotateRunner } from "./rotate-runner";
import { OrganizeRunner } from "./organize-runner";
import { documentLevelState, wholeDocumentPdf } from "@/tests/whole-document";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";

/**
 * Whole runners, driven the way a person drives them: pick a file, press the
 * button, read what comes back, press "Start over". Each case here failed on
 * the code before it — the unit under each (a reader, a hook's `reset`) was
 * correct on its own and simply never reached by the component.
 */

const router = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

function renderRunner(ui: ReactNode) {
  return render(
    <AppRouterContext.Provider value={router as never}>
      {ui}
    </AppRouterContext.Provider>,
  );
}

function pick(container: HTMLElement, files: File[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input rendered");
  fireEvent.change(input, { target: { files } });
}

const fileOf = (base64: string, name: string, type: string) =>
  new File([Buffer.from(base64, "base64")], name, { type });

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const JPG_1X1 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8Qf//Z";

// jsdom has no object URLs; the image runner previews every pick with one.
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
beforeAll(() => {
  URL.createObjectURL = () => "blob:preview";
  URL.revokeObjectURL = () => {};
});
afterAll(() => {
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});
afterEach(cleanup);

describe("PDF to Text reads a restricted (owner-only) PDF end to end", () => {
  it("opens it, shows its pages, and extracts its text", async () => {
    const { container } = renderRunner(<PdfToTextRunner />);
    pick(container, [
      fileOf(OWNER_ONLY_PDF_BASE64, "statement.pdf", "application/pdf"),
    ]);
    await screen.findAllByText(/3 pages/, undefined, { timeout: 10_000 });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /extract/i }));
    await screen.findByText("Text extracted", undefined, { timeout: 10_000 });
    expect(container.textContent).toContain("OWNER-P2");
  }, 30_000);

  it("and one whose page tree is in an encrypted object stream", async () => {
    // The shape modern generators write, and the one pdf-lib's
    // ignoreEncryption cannot read (see encryption.test.ts).
    const { container } = renderRunner(<PdfToTextRunner />);
    pick(container, [
      fileOf(OWNER_ONLY_OBJSTM_PDF_BASE64, "e-invoice.pdf", "application/pdf"),
    ]);
    await screen.findAllByText(/3 pages/, undefined, { timeout: 10_000 });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /extract/i }));
    await screen.findByText("Text extracted", undefined, { timeout: 10_000 });
    for (const text of OBJSTM_FIXTURE_TEXT) {
      expect(container.textContent).toContain(text);
    }
  }, 30_000);

  it("NEGATIVE CONTROL: a PDF that needs a password is refused as one", async () => {
    const { container } = renderRunner(<PdfToTextRunner />);
    pick(container, [
      fileOf(USER_PASSWORD_PDF_BASE64, "locked.pdf", "application/pdf"),
    ]);
    const alert = await screen.findByRole("alert", undefined, {
      timeout: 10_000,
    });
    expect(alert.textContent).toMatch(/password-protected/);
    expect(alert.textContent).not.toMatch(/No password given/);
  }, 30_000);
});

/**
 * A PDF whose pages carry `texts` — an empty string is a page with no text
 * layer at all (a scanned sheet, a blank separator).
 */
async function pagesPdf(texts: readonly string[]): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of texts) {
    const page = doc.addPage([300, 300]);
    if (text) page.drawText(text, { x: 40, y: 200, size: 14, font });
  }
  return new File([new Uint8Array(await doc.save())], "mixed.pdf", {
    type: "application/pdf",
  });
}

async function extractThrough(file: File) {
  const { container } = renderRunner(<PdfToTextRunner />);
  pick(container, [file]);
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: /extract text/i },
      { timeout: 10_000 },
    ),
  );
  await screen.findByRole("group", undefined, { timeout: 10_000 });
  return container;
}

/**
 * A partly scanned document — signed pages, a stapled-in scan — came out as
 * "Text extracted: 18,402 characters from 40 pages" when twelve of the forty
 * contributed nothing, and the TXT joins the survivors with the same blank
 * line as a paragraph break, so nothing downstream shows where they were.
 * Read at the result panel, which is what the person reads.
 */
describe("PDF to Text says which pages gave no text", () => {
  const MIXED = ["ALPHA-TEXT", "", "", "DELTA-TEXT", ""] as const;
  const blank = MIXED.flatMap((text, i) => (text ? [] : [i + 1]));
  const withText = MIXED.length - blank.length;

  it("the summary counts the pages text came from, and a note names the rest", async () => {
    // Health check: the fixture really is mixed.
    expect(blank).toEqual([2, 3, 5]);
    const container = await extractThrough(await pagesPdf(MIXED));
    expect(container.textContent).toContain(
      `from ${withText} of ${MIXED.length} pages`,
    );
    const note = screen.getByRole("status");
    expect(note.textContent).toContain("Pages 2–3, 5");
    expect(note.textContent).toMatch(/no selectable text/i);
    const ocr = note.querySelector("a");
    expect(ocr?.getAttribute("href")).toBe("/tools/ocr-pdf");
    // The text that WAS there is still delivered.
    expect(container.textContent).toContain("DELTA-TEXT");
  }, 30_000);

  it("CONTROL: every page has text — no note, and the plain page count", async () => {
    const all = ["ALPHA-TEXT", "BRAVO-TEXT"];
    const container = await extractThrough(await pagesPdf(all));
    expect(container.textContent).toContain(`from ${all.length} pages`);
    expect(container.textContent).not.toMatch(/ of \d+ pages/);
    expect(screen.queryByRole("status")).toBeNull();
  }, 30_000);

  it("no page has text — the OCR pointer is a real link, with no stale hedge", async () => {
    const container = await extractThrough(await pagesPdf(["", ""]));
    expect(container.textContent).toContain("No selectable text found");
    expect(container.textContent).not.toMatch(/when OCR is enabled/);
    const links = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(links).toContain("/tools/ocr-pdf");
  }, 30_000);
});

describe('"Start over" returns to the input, not to the finished result', () => {
  it("Text to PDF", async () => {
    renderRunner(<TextToPdfRunner />);
    fireEvent.change(screen.getByPlaceholderText(/plain text here/), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create pdf/i }));
    await screen.findByText("PDF created", undefined, { timeout: 10_000 });
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(screen.queryByText("PDF created")).toBeNull());
    const box =
      screen.getByPlaceholderText<HTMLTextAreaElement>(/plain text here/);
    expect(box.value).toBe("");
  });

  it("Markdown to PDF", async () => {
    const { container } = renderRunner(<MarkdownToPdfRunner />);
    const box = container.querySelector("textarea");
    if (!box) throw new Error("no Markdown editor rendered");
    fireEvent.change(box, { target: { value: "# Title" } });
    fireEvent.click(screen.getByRole("button", { name: /create pdf/i }));
    await screen.findByText("PDF created", undefined, { timeout: 10_000 });
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(screen.queryByText("PDF created")).toBeNull());
    expect(container.querySelector("textarea")?.value).toBe("");
  });

  for (const kind of ["png", "jpg"] as const) {
    it(`${kind.toUpperCase()} to PDF`, async () => {
      const label = kind.toUpperCase();
      const { container } = renderRunner(<ImageToPdfRunner kind={kind} />);
      // A rejected pick first, so the old "x: Choose … images only." note is
      // on screen to be cleared too.
      pick(container, [new File(["x"], "notes.txt", { type: "text/plain" })]);
      await screen.findByText(/notes\.txt/);
      pick(container, [
        kind === "png"
          ? fileOf(PNG_1X1, "shot.png", "image/png")
          : fileOf(JPG_1X1, "photo.jpg", "image/jpeg"),
      ]);
      await screen.findByText(/1 image$/);
      fireEvent.click(screen.getByRole("button", { name: /create pdf/i }));
      await screen.findByText(`${label} PDF created`, undefined, {
        timeout: 10_000,
      });
      fireEvent.click(screen.getByRole("button", { name: "Start over" }));
      await screen.findByText(`Drop ${label} images here, or`);
      expect(screen.queryByText(`${label} PDF created`)).toBeNull();
      expect(screen.queryByText(/notes\.txt/)).toBeNull();
    });
  }
});

describe("the image tools take a mixed batch, and judge files by their bytes", () => {
  for (const kind of ["png", "jpg"] as const) {
    it(`${kind.toUpperCase()} to PDF converts a PNG and a JPG together`, async () => {
      const { container } = renderRunner(<ImageToPdfRunner kind={kind} />);
      pick(container, [
        fileOf(PNG_1X1, "shot.png", "image/png"),
        fileOf(JPG_1X1, "photo.jpg", "image/jpeg"),
      ]);
      await screen.findByText(/2 images$/);
      expect(screen.queryByRole("alert")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /create pdf/i }));
      await screen.findByText(/^2 images · /, undefined, { timeout: 10_000 });
    });
  }

  /** The HTML `accept` rule: `.ext` by name, `type/*` by prefix, else exact. */
  const acceptAdmits = (accept: string, file: { name: string; type: string }) =>
    accept
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .some((token) =>
        token.startsWith(".")
          ? file.name.toLowerCase().endsWith(token)
          : token.endsWith("/*")
            ? file.type.startsWith(token.slice(0, -1))
            : file.type === token,
      );

  it("POSITIVE CONTROL: the accept rule reads names, wildcards and types", () => {
    expect(acceptAdmits("image/png,.png", { name: "a.PNG", type: "" })).toBe(
      true,
    );
    expect(acceptAdmits("image/*", { name: "a", type: "image/gif" })).toBe(
      true,
    );
    expect(
      acceptAdmits("image/png,.png", { name: "a.jpg", type: "image/jpeg" }),
    ).toBe(false);
  });

  for (const kind of ["png", "jpg"] as const) {
    it(`${kind.toUpperCase()} to PDF: the file picker offers exactly what a pick accepts`, () => {
      // What the BROWSER is handed: the rendered input's accept attribute.
      const { container } = renderRunner(<ImageToPdfRunner kind={kind} />);
      const accept =
        container
          .querySelector<HTMLInputElement>('input[type="file"]')
          ?.getAttribute("accept") ?? "";
      // bmp, tiff, heic and avif joined 2026-10-30, when webp and gif became
      // formats the runner takes: the refused half must not shrink.
      const corpus = [
        ...["png", "PNG", "jpg", "JPG", "jpeg", "webp", "gif", "bmp"],
        ...["tiff", "heic", "avif", "pdf"],
      ]
        .flatMap((ext) => [
          { name: `a.${ext}`, type: "" },
          { name: "a", type: `image/${ext.toLowerCase()}` },
        ])
        .concat([{ name: "a", type: "application/pdf" }]);
      const verdicts = corpus.map((file) => ({
        file,
        picker: acceptAdmits(accept, file),
        check: isImageAllowedForKind(kind, file),
      }));
      // Health check: the corpus holds both answers, so equality is not vacuous.
      expect(verdicts.filter((v) => v.check).length).toBeGreaterThan(3);
      expect(verdicts.filter((v) => !v.check).length).toBeGreaterThan(3);
      expect(verdicts.filter((v) => v.picker !== v.check)).toEqual([]);
    });
  }

  for (const kind of ["png", "jpg"] as const) {
    it(`${kind.toUpperCase()} to PDF: a file that cannot be read is named, and the rest of the batch still loads`, async () => {
      // A file moved or deleted after it was picked, or a cloud-drive
      // placeholder that is not on disk: the browser rejects the read. Before
      // the fix one such file rejected the whole Promise.all — nothing was
      // added, "Loading 2 images…" stayed on screen forever, and Create PDF
      // stayed disabled even for images already in the list.
      const { container } = renderRunner(<ImageToPdfRunner kind={kind} />);
      const gone = fileOf(PNG_1X1, "gone.png", "image/png");
      Object.defineProperty(gone, "arrayBuffer", {
        value: () => Promise.reject(new DOMException("gone", "NotFoundError")),
      });
      pick(container, [fileOf(PNG_1X1, "shot.png", "image/png"), gone]);

      await screen.findByText(/1 image$/);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("gone.png");
      expect(alert.textContent).toContain(
        "Could not read this file — pick it again.",
      );
      expect(screen.queryByText(/^Loading \d+ image/)).toBeNull();
      expect(
        screen.getByRole("button", { name: /create pdf/i }),
      ).not.toBeDisabled();
    });
  }

  // HISTORY: "a WebP named .png is refused…" until 2026-10-30, when WebP
  // became a format both image tools convert. A HEIC is refused the same way.
  it("a HEIC named .png is refused when it is picked, by its real format", async () => {
    const { container } = renderRunner(<ImageToPdfRunner kind="png" />);
    const heic = new Uint8Array([
      0,
      0,
      0,
      0x18,
      ...Buffer.from("ftypheic"),
      0,
      0,
      0,
      0,
    ]);
    pick(container, [new File([heic], "pic.png", { type: "image/png" })]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/"pic\.png" is a HEIC image/);
    expect(screen.queryByText(/1 image$/)).toBeNull();
  });

  it("a WebP named .png is taken when it is picked: it is listed, not refused", async () => {
    const { container } = renderRunner(<ImageToPdfRunner kind="png" />);
    const webp = new Uint8Array([
      ...Buffer.from("RIFF"),
      0x1a,
      0,
      0,
      0,
      ...Buffer.from("WEBPVP8 "),
      0,
      0,
    ]);
    pick(container, [new File([webp], "pic.png", { type: "image/png" })]);
    await screen.findByText(/1 image$/);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the hand-off badge names what was skipped truthfully for every tool", () => {
  it('does not call a skipped PDF "non-PDF" on a tool that takes images or text', () => {
    render(
      <HandoffLoadedBadge
        origin={{ kind: "workspace" }}
        count={1}
        skipped={2}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toContain(
      "2 files this tool can't open were skipped.",
    );
    expect(status.textContent).not.toMatch(/non-PDF/);
  });
});

describe("Rotate PDF downloads the whole document, turned", () => {
  // Read at the download, not at the engine: the runner builds the plan it
  // sends, and "removes nothing" is a property of THAT plan. Measured at
  // 8e270e8, the downloaded file had lost the attachment, the XMP stream, the
  // tag tree and the custom /Info key of a file the user only rotated.
  it("keeps every catalog and /Info entry, the attachment, XMP and tags", async () => {
    const bytes = await wholeDocumentPdf();
    const input = await documentLevelState(bytes);
    const downloads: Blob[] = [];
    const previous = URL.createObjectURL;
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (blob instanceof Blob && blob.type === "application/pdf") {
        downloads.push(blob);
      }
      return "blob:download";
    };
    try {
      const { container } = renderRunner(<RotateRunner />);
      pick(container, [
        new File([bytes.slice()], "ledger.pdf", { type: "application/pdf" }),
      ]);
      await screen.findAllByText(/3 pages/, undefined, { timeout: 10_000 });
      fireEvent.click(screen.getByRole("button", { name: "Right" }));
      fireEvent.click(screen.getByRole("button", { name: /apply rotation/i }));
      await screen.findByText("PDF rotated", undefined, { timeout: 10_000 });
      fireEvent.click(
        screen.getByRole("button", { name: /download rotated pdf/i }),
      );
      expect(downloads).toHaveLength(1);
      const output = await documentLevelState(
        new Uint8Array(await downloads[0]!.arrayBuffer()),
      );
      // The runner did what the user asked...
      expect(output.rotations).toEqual(input.rotations.map((r) => r + 90));
      // ...and nothing else.
      expect(output.catalogKeys).toEqual(input.catalogKeys);
      expect(output.info).toEqual(input.info);
      expect(output.attachments).toEqual(input.attachments);
      expect(output.xmpTitle).toBe(input.xmpTitle);
      expect(output.marked).toBe(true);
      // Health check: the input really carried each of them.
      expect(Object.keys(input.attachments)).toHaveLength(1);
      expect(input.xmpTitle).not.toBeNull();
    } finally {
      URL.createObjectURL = previous;
    }
  }, 30_000);
});

describe("Organize PDF downloads the whole document when it removes no page", () => {
  // The same plan Rotate PDF sends — every page, in order, one turned — built
  // by the OTHER runner that can send it. The engine test ("one page turned")
  // proves organizePages keeps document-level state for that plan; this reads
  // the file a person downloads from the Organize tool, so a runner that
  // built a different plan (or called a different engine) could not pass.
  it("keeps every catalog and /Info entry, the attachment, XMP and tags", async () => {
    const bytes = await wholeDocumentPdf();
    const input = await documentLevelState(bytes);
    const downloads: Blob[] = [];
    const previous = URL.createObjectURL;
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (blob instanceof Blob && blob.type === "application/pdf") {
        downloads.push(blob);
      }
      return "blob:download";
    };
    try {
      const { container } = renderRunner(<OrganizeRunner />);
      pick(container, [
        new File([bytes.slice()], "ledger.pdf", { type: "application/pdf" }),
      ]);
      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: "Rotate page 1 right" },
          { timeout: 10_000 },
        ),
      );
      fireEvent.click(screen.getByRole("button", { name: /apply & export/i }));
      await screen.findByText("Pages organized", undefined, {
        timeout: 10_000,
      });
      fireEvent.click(
        screen.getByRole("button", { name: /download organized pdf/i }),
      );
      expect(downloads).toHaveLength(1);
      const output = await documentLevelState(
        new Uint8Array(await downloads[0]!.arrayBuffer()),
      );
      // The runner did what the user asked...
      expect(output.rotations).toEqual(
        input.rotations.map((r, i) => (i === 0 ? r + 90 : r)),
      );
      // ...and nothing else.
      expect(output.catalogKeys).toEqual(input.catalogKeys);
      expect(output.info).toEqual(input.info);
      expect(output.attachments).toEqual(input.attachments);
      expect(output.xmpTitle).toBe(input.xmpTitle);
      expect(output.marked).toBe(true);
      // Health check: the input really carried each of them.
      expect(Object.keys(input.attachments)).toHaveLength(1);
      expect(input.xmpTitle).not.toBeNull();
    } finally {
      URL.createObjectURL = previous;
    }
  }, 30_000);
});

describe("Organize PDF inserts a blank page where the tile says", () => {
  // The reducer test proves the plan; this reads the file the Download button
  // hands over, so a runner that dropped `blank` on the way to the engine (or
  // sized it from the wrong page) could not pass.
  it("Insert blank page after page 1 → page 2 of the download is empty and page 1's size as shown", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // Page 1 is stored 400×250 and turned a quarter, so a reader sees it
    // 250 wide and 400 tall; page 2 is a different size again.
    const first = doc.addPage([400, 250]);
    first.setRotation(degrees(90));
    first.drawText("ONE", { x: 20, y: 40, size: 12, font });
    doc.addPage([300, 300]).drawText("TWO", { x: 20, y: 40, size: 12, font });
    const bytes = await doc.save();
    const downloads: Blob[] = [];
    const previous = URL.createObjectURL;
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (blob instanceof Blob && blob.type === "application/pdf") {
        downloads.push(blob);
      }
      return "blob:download";
    };
    try {
      const { container } = renderRunner(<OrganizeRunner />);
      pick(container, [
        new File([bytes.slice()], "gaps.pdf", { type: "application/pdf" }),
      ]);
      const insert = await screen.findByRole(
        "button",
        { name: "Insert blank page after page 1" },
        { timeout: 10_000 },
      );
      // The sizes arrive after the board; the button waits for them.
      await waitFor(() => expect(insert).not.toHaveAttribute("aria-disabled"));
      fireEvent.click(insert);
      expect(screen.getByText("Blank page", { exact: true })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /apply & export/i }));
      await screen.findByText("Pages organized", undefined, {
        timeout: 10_000,
      });
      fireEvent.click(
        screen.getByRole("button", { name: /download organized pdf/i }),
      );
      expect(downloads).toHaveLength(1);
      const out = await PDFDocument.load(
        new Uint8Array(await downloads[0]!.arrayBuffer()),
      );
      const pages = out.getPages();
      expect(pages).toHaveLength(3);
      const shown = pages.map((p) => {
        const { width, height } = p.getSize();
        return p.getRotation().angle % 180 === 90
          ? [height, width]
          : [width, height];
      });
      expect(shown).toEqual([
        [250, 400],
        [250, 400],
        [300, 300],
      ]);
      // The inserted page carries no content stream at all.
      expect(pages[1]!.node.Contents()).toBeUndefined();
      expect(pages[0]!.node.Contents()).toBeDefined();
    } finally {
      URL.createObjectURL = previous;
    }
  }, 30_000);
});

/**
 * A picked .txt or .md file reaches the editor as the text its author wrote.
 *
 * Both runners used `file.text()`, which is UTF-8 or nothing: a Windows-1252
 * note showed up as "caf� �q�" and a Notepad "Unicode" save as U+FFFD plus a
 * NUL between every letter, and "PDF created" followed either way. This reads
 * what the USER sees — the editor's value and the notes beside it — through
 * the real file input, rather than calling the decoder the runner is supposed
 * to use.
 */
describe("Text and Markdown to PDF read a file in the encoding it was saved in", () => {
  const FFFD = String.fromCharCode(0xfffd);
  // "café “q”" as Windows-1252 — the bytes from the finding, verbatim.
  const CP1252 = [0x63, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x71, 0x94];
  const UTF16LE_BOM = [0xff, 0xfe, ...Buffer.from("Hi café", "utf16le")];

  const runners = [
    {
      name: "Text to PDF",
      ui: () => <TextToPdfRunner />,
      file: "note.txt",
      type: "text/plain",
    },
    {
      name: "Markdown to PDF",
      ui: () => <MarkdownToPdfRunner />,
      file: "note.md",
      type: "text/markdown",
    },
  ];

  for (const runner of runners) {
    it(`${runner.name}: Windows-1252 and UTF-16 files, and a warning for U+FFFD`, async () => {
      const { container } = renderRunner(runner.ui());
      const box = () => {
        const el = container.querySelector("textarea");
        if (!el) throw new Error("no editor rendered");
        return el;
      };

      pick(container, [
        new File([new Uint8Array(CP1252)], runner.file, { type: runner.type }),
      ]);
      await waitFor(() => expect(box().value).toBe("café “q”"));
      expect(box().value).not.toContain(FFFD);
      // The guess is named where the user checks the text, and NOT as an error.
      const note = await screen.findByText(/read as Windows-1252/);
      expect(note.closest('[role="alert"]')).toBeNull();

      pick(container, [
        new File([new Uint8Array(UTF16LE_BOM)], runner.file, {
          type: runner.type,
        }),
      ]);
      await waitFor(() => expect(box().value).toBe("Hi café"));
      expect(box().value).not.toContain(String.fromCharCode(0));
      // A declared encoding is not a guess, so the Windows-1252 note is gone.
      expect(screen.queryByText(/read as Windows-1252/)).toBeNull();

      // Second, independent bound: damaged text however it arrived is flagged.
      expect(screen.queryByText(/could not be read/)).toBeNull();
      fireEvent.change(box(), { target: { value: `caf${FFFD} ok` } });
      await screen.findByText(/1 character in this text could not be read/);
    }, 30_000);
  }
});
