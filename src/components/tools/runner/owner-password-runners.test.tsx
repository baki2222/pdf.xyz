// @vitest-environment jsdom
// @native-canvas
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
import { PDFDocument } from "pdf-lib";
import { getRunnerKind } from "@/lib/pdf/registry";
import { PDF_NEEDS_PASSWORD_MESSAGE } from "@/lib/pdf/encryption";
import {
  OWNER_PASSWORD_BUTTON,
  OWNER_PASSWORD_LABEL,
  type OwnerPasswordTool,
} from "@/lib/pdf/owner-password-copy";
import {
  AES256_BOTH_PASSWORDS_FIXTURE,
  AES256_NO_GRANT_FIXTURE,
  FIXTURE_OPEN_PASSWORD,
  NO_ASSEMBLE_COPY_FIXTURE,
  OPEN_PASSWORD_RESTRICTED_FIXTURE,
  RESTRICTED_FIXTURE_DIR,
  readRestrictedFixture,
  type GrantFixture,
} from "@/tests/restricted-pdf-fixtures";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ToolRunner } from "./tool-runner";
import { runnerMounted } from "@/tests/runner-mounted";
import {
  OWNER_OPENED_NOTE,
  OWNER_PASSWORD_HINT,
  OWNER_WRONG_PASSWORD,
  PASSWORD_OPENED_NOTE,
  ownerRefusalMessage,
  ownerWithheldMessage,
} from "./owner-password";

/**
 * The owner-password field of Merge PDF, Extract Pages, Delete Pages,
 * Rotate PDF and Extract Images (competitor-audit backlog #11), through each
 * page's own runner: a real File dropped, the refusal, the field, the
 * password typed, the tool's own buttons, and the Blob handed to the
 * browser, read back.
 *
 * THE RULE: only the owner password opens the file here. The open password
 * of a file whose author restricts it is refused with the reason; a wrong
 * one says it is not the owner password; with none, the refusal points at
 * the field. And the password goes nowhere: not into storage, not over
 * the network, not left in the field.
 */

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

let downloads: Blob[] = [];
let stored: string[] = [];
let fetched: string[] = [];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
beforeEach(() => {
  downloads = [];
  stored = [];
  fetched = [];
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) downloads.push(obj);
    return `blob:owner-password-test/${downloads.length}`;
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    stored.push(`${key}=${value}`);
  });
  vi.stubGlobal("fetch", (input: unknown) => {
    fetched.push(String(input));
    return Promise.reject(new Error("no network in this test"));
  });
});
afterEach(() => {
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pdfFile(bytes: Uint8Array, name: string): File {
  return new File([bytes.slice()], name, { type: "application/pdf" });
}

/** An unencrypted two-page PDF: the grant fixtures' base. */
const PLAIN = new Uint8Array(
  readFileSync(path.join(RESTRICTED_FIXTURE_DIR, "grant-base.pdf")),
);

async function mount(slug: OwnerPasswordTool, files: File[]) {
  const kind = getRunnerKind(slug);
  expect(kind, slug).toBeTruthy();
  const { container } = render(
    <Router>
      <ToolRunner kind={kind!} slug={slug} />
    </Router>,
  );
  await runnerMounted(container);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the dropzone file input").not.toBeNull();
  fireEvent.change(input!, { target: { files } });
  return screen.findByLabelText(OWNER_PASSWORD_LABEL, undefined, {
    timeout: 15_000,
  });
}

async function submit(field: HTMLElement, password: string) {
  fireEvent.change(field, { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: OWNER_PASSWORD_BUTTON }));
  // Cleared before the check returns.
  expect((field as HTMLInputElement).value).toBe("");
}

async function download(name: RegExp): Promise<Uint8Array> {
  const button = await screen.findByRole(
    "button",
    { name },
    { timeout: 20_000 },
  );
  const before = downloads.length;
  fireEvent.click(button);
  expect(downloads).toHaveLength(before + 1);
  return new Uint8Array(await downloads.at(-1)!.arrayBuffer());
}

async function run(name: RegExp) {
  const button = await screen.findByRole(
    "button",
    { name },
    { timeout: 15_000 },
  );
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

async function viewer(bytes: Uint8Array, password = "") {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = lib.getDocument({ data: bytes.slice(), password, verbosity: 0 });
  const doc = await task.promise;
  try {
    const rotations: number[] = [];
    for (let i = 1; i <= doc.numPages; i += 1)
      rotations.push((await doc.getPage(i)).rotate);
    return { permissions: await doc.getPermissions(), rotations };
  } finally {
    await task.destroy();
  }
}

/** Open the tool on `fixture` and type its owner password: the tool's work. */
async function ownerOpens(slug: OwnerPasswordTool, fixture: GrantFixture) {
  const files =
    slug === "merge-pdf"
      ? [
          pdfFile(PLAIN, "first.pdf"),
          pdfFile(readRestrictedFixture(fixture.file), "locked.pdf"),
        ]
      : [pdfFile(readRestrictedFixture(fixture.file), "locked.pdf")];
  const field = await mount(slug, files);
  expect(screen.getByText(OWNER_PASSWORD_HINT[slug])).toBeTruthy();
  await submit(field, "not-the-owner-password");
  await screen.findByText(OWNER_WRONG_PASSWORD, undefined, { timeout: 15_000 });
  await submit(field, fixture.owner);
  const note = await screen.findByText(OWNER_OPENED_NOTE[slug], undefined, {
    timeout: 15_000,
  });
  // The form is gone; the focus is on what replaced it, not on <body>.
  await waitFor(() =>
    expect(document.activeElement).toBe(note.closest("[data-owner-opened]")),
  );
}

const FIXTURES = [AES256_NO_GRANT_FIXTURE, NO_ASSEMBLE_COPY_FIXTURE] as const;

describe("the owner password, typed under a restricted file's refusal", () => {
  for (const fixture of FIXTURES) {
    it(`merge-pdf - ${fixture.file}: the decrypted copy joins the merge; the merged PDF has no encryption`, async () => {
      await ownerOpens("merge-pdf", fixture);
      await run(/^merge/i);
      const out = await download(/download merged pdf/i);
      // pdf-lib refuses any /Encrypt: loading it proves there is none.
      expect((await PDFDocument.load(out)).getPageCount()).toBe(
        2 + fixture.pageCount,
      );
    }, 60_000);

    it(`extract-pages - ${fixture.file}: extracts into a new PDF with no encryption`, async () => {
      await ownerOpens("extract-pages", fixture);
      fireEvent.click(screen.getByRole("button", { name: "Select all" }));
      await run(/^extract 2 pages$/i);
      const out = await download(/^download pdf$/i);
      expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
    }, 60_000);

    it(`remove-pages - ${fixture.file}: deletes a page into a new PDF with no encryption`, async () => {
      await ownerOpens("remove-pages", fixture);
      fireEvent.click(screen.getByRole("button", { name: "Odd pages" }));
      await run(/^delete 1 page$/i);
      const out = await download(/^download pdf$/i);
      expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
    }, 60_000);

    it(`rotate-pdf - ${fixture.file}: rotated under the author's own encryption, grant and owner password kept`, async () => {
      const original = readRestrictedFixture(fixture.file);
      await ownerOpens("rotate-pdf", fixture);
      fireEvent.click(screen.getByRole("button", { name: /^right$/i }));
      await run(/apply rotation/i);
      const out = await download(/download rotated pdf/i);
      // An incremental update onto the original: every byte of it kept.
      expect(out.subarray(0, original.length)).toEqual(original);
      await expect(PDFDocument.load(out)).rejects.toThrow();
      const read = await viewer(out);
      expect(read.permissions).toEqual(fixture.permissions);
      expect(read.rotations).toEqual([90, 90]);
    }, 60_000);

    it(`extract-images - ${fixture.file}: the picture comes out; the PDF is not changed`, async () => {
      await ownerOpens("extract-images", fixture);
      await run(/^extract images$/i);
      const out = await download(/^download image$/i);
      expect([...out.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }, 60_000);
  }

  for (const slug of [
    "merge-pdf",
    "extract-pages",
    "remove-pages",
    "rotate-pdf",
    "extract-images",
  ] as const)
    it(`${slug}: a file with BOTH passwords: refused as today, the field under it; the open password is refused with the reason; the owner password opens it`, async () => {
      const fixture = AES256_BOTH_PASSWORDS_FIXTURE;
      const locked = pdfFile(readRestrictedFixture(fixture.file), "both.pdf");
      const field = await mount(
        slug,
        slug === "merge-pdf" ? [pdfFile(PLAIN, "first.pdf"), locked] : [locked],
      );
      // INVERTED 2026-11-17 (review): this pinned PDF_NEEDS_PASSWORD_MESSAGE
      // ("Remove the password with Unlock PDF first, then try again") over
      // a field that says to type the owner password here. The refusal now
      // points at the field; the tool-wide sentence is gone from the page.
      expect(
        screen.getAllByText(
          ownerRefusalMessage(
            slug,
            "needs-password",
            slug === "merge-pdf" ? "both.pdf" : undefined,
          ),
          { exact: false },
        ).length,
      ).toBeGreaterThan(0);
      expect(
        screen.queryAllByText(PDF_NEEDS_PASSWORD_MESSAGE, { exact: false }),
      ).toEqual([]);
      // The field is not inside a live region: a wrong password announces
      // its own error, not the whole refusal again.
      expect(field.closest("[role=alert]")).toBeNull();
      await submit(field, FIXTURE_OPEN_PASSWORD);
      await screen.findByText(
        /That password opens this PDF, but it is not the owner password/,
        undefined,
        { timeout: 15_000 },
      );
      expect(screen.queryByText(OWNER_OPENED_NOTE[slug])).toBeNull();
      await submit(field, fixture.owner);
      await screen.findByText(OWNER_OPENED_NOTE[slug], undefined, {
        timeout: 15_000,
      });
    }, 60_000);

  for (const slug of ["rotate-pdf", "extract-images"] as const)
    it(`${slug}: the OPEN password serves when the author grants what the tool does; nothing is lifted`, async () => {
      const fixture = OPEN_PASSWORD_RESTRICTED_FIXTURE; // grants 1024 and 16
      const original = readRestrictedFixture(fixture.file);
      const field = await mount(slug, [pdfFile(original, "granted.pdf")]);
      await submit(field, FIXTURE_OPEN_PASSWORD);
      const note = await screen.findByText(
        PASSWORD_OPENED_NOTE[slug],
        undefined,
        { timeout: 15_000 },
      );
      await waitFor(() =>
        expect(document.activeElement).toBe(
          note.closest("[data-owner-opened]"),
        ),
      );
      if (slug === "rotate-pdf") {
        fireEvent.click(screen.getByRole("button", { name: /^right$/i }));
        await run(/apply rotation/i);
        const out = await download(/download rotated pdf/i);
        expect(out.subarray(0, original.length)).toEqual(original);
        await expect(PDFDocument.load(out)).rejects.toThrow();
        const read = await viewer(out, FIXTURE_OPEN_PASSWORD);
        expect(read.permissions).toEqual(fixture.permissions);
        expect(read.rotations).toEqual([90, 90]);
      } else {
        await run(/^extract images$/i);
        const out = await download(/^download image$/i);
        expect([...out.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      }
    }, 60_000);

  it("the withheld message keeps labels that hold their own 'and' or 'or' apart", () => {
    const words = ownerWithheldMessage({
      print: true,
      copy: false,
      modify: false,
      annotate: false,
      fillForms: false,
      accessibility: true,
      assemble: false,
    });
    expect(words).toContain(
      "copying text and images; changing the document; adding comments and annotations; filling in forms; and inserting, rotating or deleting pages",
    );
    // No such label: the plain list.
    expect(
      ownerWithheldMessage({
        print: false,
        copy: true,
        modify: false,
        annotate: true,
        fillForms: true,
        accessibility: true,
        assemble: true,
      }),
    ).toContain("printing and changing the document");
  });

  it("the password goes nowhere: no storage write, no request, nothing left in a field", async () => {
    await ownerOpens("rotate-pdf", AES256_NO_GRANT_FIXTURE);
    const typed = [AES256_NO_GRANT_FIXTURE.owner, "not-the-owner-password"];
    for (const value of typed) {
      expect(stored.some((s) => s.includes(value))).toBe(false);
      expect(fetched.some((u) => u.includes(value))).toBe(false);
      expect(document.body.innerHTML.includes(value)).toBe(false);
    }
    expect(window.location.href.includes(typed[0]!)).toBe(false);
  }, 60_000);
});
