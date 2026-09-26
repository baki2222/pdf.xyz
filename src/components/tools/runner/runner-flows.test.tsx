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
