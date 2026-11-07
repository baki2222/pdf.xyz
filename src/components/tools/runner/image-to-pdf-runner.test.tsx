// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { JPEG_30X20 } from "@/tests/jpeg-fixtures";
import { withAppRouter } from "@/tests/app-router";
import { ImageToPdfRunner } from "./image-to-pdf-runner";

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

/** Both tools the runner serves, each with an image its picker takes. */
const KINDS = [
  { kind: "jpg", ext: "jpg", type: "image/jpeg", bytes: JPEG_30X20 },
  { kind: "png", ext: "png", type: "image/png", bytes: PNG_1X1 },
] as const;

async function mount(
  k: (typeof KINDS)[number],
  names: string[],
): Promise<void> {
  const { container } = render(
    withAppRouter(<ImageToPdfRunner kind={k.kind} />),
  );
  const files = names.map(
    (name) => new File([new Uint8Array(k.bytes)], name, { type: k.type }),
  );
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files },
  });
  await screen.findByText(names[0]!, undefined, { timeout: 4_000 });
}

/** The cards' order, read from the file names they show. */
const order = () =>
  screen.getAllByText(/^[a-z0-9]+\.(jpg|png)$/).map((node) => node.textContent);

/** The card a file's name sits on: what a person grabs to drag it. */
const card = (name: string) => screen.getByText(name).closest("[draggable]");

/**
 * Audit #42 (2026-11-06): every image card drew a GripVertical drag handle,
 * and nothing on it could be dragged — moving image 30 to the front took 29
 * clicks of "Move up". Every card's buttons were also named the same ("Move
 * up", "Move down", "Remove") whatever image they moved, and "Move up" on the
 * first card still cleared the natural-order note though nothing moved.
 */
describe.each(KINDS)("$kind to PDF · reordering images", (k) => {
  const a = `alpha.${k.ext}`;
  const b = `bravo.${k.ext}`;
  const c = `charlie.${k.ext}`;

  it("a card can be dragged onto another's place", async () => {
    await mount(k, [a, b, c]);
    expect(order()).toEqual([a, b, c]);
    const from = card(c);
    const to = card(a);
    // Health: the cards are draggable at all, so the drop below is real.
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    fireEvent.dragStart(from!);
    fireEvent.dragOver(to!);
    fireEvent.drop(to!);
    fireEvent.dragEnd(from!);
    expect(order()).toEqual([c, a, b]);
  });

  it("each card's buttons name the image they act on", async () => {
    await mount(k, [a, b]);
    for (const name of [a, b]) {
      expect(
        screen.getByRole("button", { name: `Move ${name} earlier` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `Move ${name} later` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `Remove ${name}` }),
      ).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: `Move ${b} earlier` }));
    expect(order()).toEqual([b, a]);
  });

  it("an arrow that moves nothing leaves the natural-order note in place", async () => {
    // Dropped out of number order, so the list is sorted and says so.
    const names = [`p10.${k.ext}`, `p2.${k.ext}`, `p1.${k.ext}`];
    await mount(k, names);
    expect(order()).toEqual([`p1.${k.ext}`, `p2.${k.ext}`, `p10.${k.ext}`]);
    expect(screen.getByText(/keep drop order/i)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: `Move p1.${k.ext} earlier` }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: `Move p10.${k.ext} later` }),
    );
    expect(screen.getByText(/keep drop order/i)).toBeInTheDocument();
    // Control: a move that does move something clears it.
    fireEvent.click(
      screen.getByRole("button", { name: `Move p2.${k.ext} earlier` }),
    );
    expect(screen.queryByText(/keep drop order/i)).toBeNull();
  });
});
