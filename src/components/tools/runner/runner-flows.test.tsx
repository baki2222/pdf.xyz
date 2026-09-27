// @vitest-environment jsdom
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
      const corpus = ["png", "PNG", "jpg", "JPG", "jpeg", "webp", "gif", "pdf"]
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

  it("a WebP named .png is refused when it is picked, by its real format", async () => {
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
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/"pic\.png" is a WebP image/);
    expect(screen.queryByText(/1 image$/)).toBeNull();
  });
});

describe("the hand-off badge names what was skipped truthfully for every tool", () => {
  it('does not call a skipped PDF "non-PDF" on a tool that takes images or text', () => {
    render(<HandoffLoadedBadge count={1} skipped={2} />);
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
