import { waitFor } from "@testing-library/react";
import { DROP_ENGINE_MARK } from "@/lib/intent/drop-engine";

/**
 * Every drop sheet under `root` takes a release made on it. A sheet's
 * engine (`@/lib/intent/drop-engine`) arrives with the registry a moment
 * after the sheet mounts, and marks the box it takes; on a page, a release
 * in that moment is the drop layer's, which hands it back to the sheet
 * (`deliverFiles`). A test that renders a sheet with no layer drops after
 * this — as a person's hand arrives after the page.
 */
export function dropSheetsLive(root: ParentNode = document): Promise<void> {
  return waitFor(() => {
    const sheets = [...root.querySelectorAll("[data-drop-sheet]")];
    if (sheets.length === 0) throw new Error("no drop sheet is rendered");
    const waiting = sheets.filter((s) => !s.hasAttribute(DROP_ENGINE_MARK));
    if (waiting.length > 0)
      throw new Error(`${waiting.length} drop sheet(s) have no engine yet`);
  });
}
