// @vitest-environment jsdom
// @native-canvas
/**
 * A digitally signed PDF gets a warning before Run in every single-file tool
 * that saves a PDF — and in no tool that does not.
 *
 * The audit (at 67e8d0f) found it on Sign PDF: counter-signing a contract the
 * other party signed through DocuSign or Adobe Sign rewrote the whole file, so
 * the counterparty's signature stopped verifying, and nothing said so. The same
 * full rewrite is in every client tool behind SinglePdfRunner, so the notice
 * lives there, and this file holds the whole set to it.
 *
 * THE CORPUS IS DERIVED, NOT TYPED. Every slug in the runner registry is
 * rendered through the real dispatcher; the ones that mount SinglePdfRunner
 * (seen by its `data-single-pdf-runner` marker) are the subjects. What each one
 * SHOULD do comes from the catalog's `outputs` for that slug — the same list
 * the tool page advertises — not from this file.
 *
 * SCOPE, stated because the title used to claim more: the subjects are the
 * tools that load ONE file through `useSinglePdf`. Multi-file and batch paths
 * (Merge, Compress's batch mode, other multi-file runners) also rewrite a
 * possibly signed input in full, and do NOT warn — a known gap this file does
 * not cover. `subjects.length < supportedToolSlugs.length` below is that
 * exclusion, not a pass over them.
 *
 * The chain is composed end to end: a signed file goes through the Dropzone's
 * real input, the hook's real read and detector, and the notice is read back
 * from the rendered page.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withAppRouter } from "@/tests/app-router";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { getToolBySlug } from "@/lib/tools";
import { signedPdf } from "@/tests/signed-pdf";
import { ToolRunner } from "./tool-runner";
import { runnerMounted } from "@/tests/runner-mounted";

// The router comes from its context (`withAppRouter`), not a module mock:
// under isolate:false a runner another file imported first stays cached bound
// to the real `next/navigation`, and a mock here would never reach it.

afterEach(() => {
  cleanup();
});

const asFile = (bytes: Uint8Array, name: string) =>
  new File([bytes.slice().buffer], name, { type: "application/pdf" });

async function unsignedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

/** Render a tool's runner, load `file`, and report what the reader sees. */
async function openIn(slug: string, file: File) {
  const kind = getRunnerKind(slug)!;
  const { container, unmount } = render(
    withAppRouter(<ToolRunner kind={kind} slug={slug} />),
  );
  try {
    // The runner is a `next/dynamic` loader: until it has rendered, EVERY
    // tool looks like "not a single-file runner", and the corpus floor below
    // is what caught that on 2026-10-09 (0 subjects).
    await runnerMounted(container);
    if (!container.querySelector('[data-single-pdf-runner="empty"]')) {
      return { single: false as const };
    }
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input, `${slug}: the dropzone's file input`).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(
      () =>
        expect(
          container.querySelector('[data-single-pdf-runner="loaded"]'),
          `${slug}: the file loaded`,
        ).not.toBeNull(),
      { timeout: 5000 },
    );
    const notice = container.querySelector("[data-signed-input-notice]");
    return { single: true as const, notice: notice?.textContent ?? null };
  } finally {
    unmount();
  }
}

describe("signed-input notice across every single-file tool", () => {
  it("warns exactly where a single-file tool saves a PDF", async () => {
    const signed = await signedPdf({ signatures: 2 });
    const plain = await unsignedPdf();
    const subjects: { slug: string; writesPdf: boolean }[] = [];

    for (const slug of supportedToolSlugs) {
      const tool = getToolBySlug(slug);
      expect(tool, `${slug} is in the catalog`).toBeDefined();
      const writesPdf = tool!.outputs.includes("PDF");

      const onSigned = await openIn(slug, asFile(signed, "contract.pdf"));
      if (!onSigned.single) continue;
      subjects.push({ slug, writesPdf });

      if (writesPdf) {
        expect(onSigned.notice, `${slug} warns`).not.toBeNull();
        expect(onSigned.notice).toMatch(/carries 2 certificate signatures/);
        expect(onSigned.notice).toMatch(
          /those signatures will no longer verify/,
        );
      } else {
        expect(onSigned.notice, `${slug} saves no PDF`).toBeNull();
      }

      // Control: the same tool, an unsigned file — no notice.
      const onPlain = await openIn(slug, asFile(plain, "plain.pdf"));
      expect(onPlain.single && onPlain.notice, `${slug} unsigned`).toBeNull();
    }

    // The corpus is what it should be: most of the registry, including the
    // tool the defect was found on, and BOTH directions exercised.
    expect(subjects.length).toBeGreaterThanOrEqual(15);
    expect(subjects.length).toBeLessThan(supportedToolSlugs.length);
    expect(subjects.map((s) => s.slug)).toContain("sign-pdf");
    // Compress reaches the hook without SinglePdfRunner; it is a subject too.
    expect(subjects.map((s) => s.slug)).toContain("compress-pdf");
    expect(subjects.filter((s) => s.writesPdf).length).toBeGreaterThan(10);
    expect(subjects.filter((s) => !s.writesPdf).length).toBeGreaterThan(0);
  }, 60_000);

  it("says one signature in the singular", async () => {
    const res = await openIn(
      "sign-pdf",
      asFile(await signedPdf({ signatures: 1 }), "one.pdf"),
    );
    expect(res.single && res.notice).toMatch(
      /carries 1 certificate signature\. .*that signature will no longer verify/,
    );
  });
});

/* ------------------------------------------------------------------ *
 *  Every consumer of the hook, found by walking the tree
 * ------------------------------------------------------------------ */

const COMPONENTS = join(process.cwd(), "src", "components");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe("every component that loads a PDF through useSinglePdf shows the notice", () => {
  it("renders SignedInputNotice wherever the hook's result is rendered", () => {
    // The rendered sweep above reaches a runner through the registry. A
    // component that calls the hook some other way would get the signature
    // count and could drop it, so the hook's call sites are held too.
    // A CALL, not the definition in use-single-pdf.ts.
    const calls = /(?<!function\s+)\buseSinglePdf\(/;
    const consumers = sourceFiles(COMPONENTS)
      .filter((path) => calls.test(readFileSync(path, "utf8")))
      .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"));
    // Health: the walk found the shared runner and the one direct caller.
    // An empty list would pass the loop below vacuously.
    expect(consumers.length).toBeGreaterThanOrEqual(2);
    expect(consumers).toContain(
      "src/components/tools/runner/single-pdf-runner.tsx",
    );
    for (const path of consumers) {
      expect(
        /<SignedInputNotice\b/.test(readFileSync(path, "utf8")),
        `${path} renders the signed-input notice`,
      ).toBe(true);
    }
  });
});
