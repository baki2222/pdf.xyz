"use client";

/**
 * The reason beside a natural order (redesign E.9), and its undo: "Ordered
 * by the numbers in the file names (1, 2, 10) · Keep drop order". Drawn in
 * the list's own header, in the same commit as the files it is about, so it
 * arrives with them rather than after them.
 */
export function OrderNote({
  note,
  onKeep,
}: {
  note: string;
  onKeep: () => void;
}) {
  return (
    <span data-order-note="" className="text-muted text-xs">
      {note} ·{" "}
      <button
        type="button"
        onClick={onKeep}
        className="font-semibold underline underline-offset-2"
      >
        Keep drop order
      </button>
    </span>
  );
}
