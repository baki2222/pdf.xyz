// @vitest-environment jsdom
/**
 * A worker panel's side of a hand-off, through the real claim (batch plan
 * P6): the files a hand-off carries reach the panel's `onFiles` as the
 * panel would get them from a drop — ALL of them for a panel with a batch,
 * which then opens its list, and the first for a panel without one.
 *
 * WAS the first file for every panel (`result.files.slice(0, 1)`), so a
 * hand-off of three PDFs to Repair PDF staged one and dropped two without a
 * word. The store is the in-memory one, the token is carried in this tab's
 * sessionStorage exactly as `launchWithFiles` carries it, and the page
 * address is the tool's own, so the claim runs as on the served page.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setHandoffStoreForTests,
  HandoffStore,
  MemoryHandoffBackend,
  stashHandoff,
} from "@/lib/handoff";
import { carryHandoff } from "@/lib/handoff/carry";
import { useStagedHandoff } from "./use-staged-handoff";

beforeEach(() => {
  window.sessionStorage.clear();
  __setHandoffStoreForTests(
    new HandoffStore({ backend: new MemoryHandoffBackend() }),
  );
});
afterEach(() => {
  cleanup();
  __setHandoffStoreForTests(null);
  window.history.replaceState(null, "", "/");
});

function Panel({
  slug,
  onFiles,
}: {
  slug: string;
  onFiles: (files: File[]) => void;
}) {
  return <>{useStagedHandoff(slug, "Run it", onFiles)}</>;
}

const pdf = (name: string) =>
  new File(["%PDF-1.7\n%%EOF\n"], name, { type: "application/pdf" });

/** Carry `files` to `slug`'s page as a launch does, open it, and render. */
async function arrive(slug: string, files: File[]) {
  const id = await stashHandoff(slug, files, {
    origin: { kind: "workspace" },
  });
  expect(id).not.toBeNull();
  const path = `/tools/${slug}`;
  expect(carryHandoff(path, id!)).toBe(true);
  window.history.replaceState(null, "", path);
  const onFiles = vi.fn<(files: File[]) => void>();
  render(<Panel slug={slug} onFiles={onFiles} />);
  await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
  return onFiles.mock.calls[0]![0].map((f) => f.name);
}

describe("useStagedHandoff", () => {
  const three = () => [pdf("jan.pdf"), pdf("feb.pdf"), pdf("mar.pdf")];

  it.each(["repair-pdf", "unlock-pdf", "ocr-pdf"])(
    "%s, a panel with a batch, gets every carried file",
    async (slug) => {
      expect(await arrive(slug, three())).toEqual([
        "jan.pdf",
        "feb.pdf",
        "mar.pdf",
      ]);
      // Its notice names where Run is, not the single-file button.
      expect(
        await screen.findByText(
          /nothing is uploaded until you press the button under the list\./,
        ),
      ).toBeInTheDocument();
    },
  );

  it("control: a panel with no batch still gets the first file only", async () => {
    expect(await arrive("summarize-pdf", three())).toEqual(["jan.pdf"]);
    expect(
      await screen.findByText(/nothing is uploaded until you press Run it\./),
    ).toBeInTheDocument();
  });

  it("one file to a panel with a batch names the panel's own button", async () => {
    expect(await arrive("repair-pdf", [pdf("one.pdf")])).toEqual(["one.pdf"]);
    expect(
      await screen.findByText(/nothing is uploaded until you press Run it\./),
    ).toBeInTheDocument();
  });
});
