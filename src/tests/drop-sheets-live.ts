import { waitFor } from "@testing-library/react";
import { DROP_ENGINE_MARK } from "@/lib/intent/drop-engine";
// THE ENGINE'S MODULE, LOADED WITH THIS ONE. A sheet fetches its engine
// through the registry's `import()` (`useDropBox`), so on a cold module
// cache its arrival was a module LOAD — a round trip to vitest's transform
// server — raced against `waitFor`'s 1 s default. On CI that load lost:
// "1 drop sheet(s) have no engine yet" turned 44164715213 and 44228410852
// red, in the first test of a fresh native-canvas fork. Loaded here, it is
// evaluated while the test FILE loads, outside every test and every wait,
// so a sheet's `import()` resolves from the module cache in microtasks
// (`drop-sheets-live.test.tsx` holds both halves of that).
import "@/lib/intent/page-target";

/**
 * How long a sheet's engine may take to arrive, once its module is loaded
 * (above): a React commit and a resolved `import()`. NOT a bound on the
 * module load, which is no longer inside the wait.
 *
 * Derived from CI, not from this machine. The cold arrival this replaces
 * took about 2 to 3 s in run 44228410852 (compress-runner.dom: its first two
 * tests failed at 1116 and 1016 ms, the third, 898 ms, saw the engine, so
 * at most 3.03 s), the worst on record. 4 s covers even that, should the warm-up above ever be
 * defeated (1.32x — twice it, 6 s, would not fit), and stays under vitest's
 * 5 s default test timeout, so a sheet whose engine never comes fails with
 * THIS message rather than "Test timed out", which names nothing.
 */
export const DROP_ENGINE_WAIT_MS = 4_000;

/**
 * Every drop sheet under `root` takes a release made on it. A sheet's
 * engine (`@/lib/intent/drop-engine`) arrives with the registry a moment
 * after the sheet mounts, and marks the box it takes; on a page, a release
 * in that moment is the drop layer's, which hands it back to the sheet
 * (`deliverFiles`). A test that renders a sheet with no layer drops after
 * this — as a person's hand arrives after the page.
 */
export function dropSheetsLive(root: ParentNode = document): Promise<void> {
  return waitFor(
    () => {
      const sheets = [...root.querySelectorAll("[data-drop-sheet]")];
      if (sheets.length === 0) throw new Error("no drop sheet is rendered");
      const waiting = sheets.filter((s) => !s.hasAttribute(DROP_ENGINE_MARK));
      if (waiting.length > 0)
        throw new Error(`${waiting.length} drop sheet(s) have no engine yet`);
    },
    { timeout: DROP_ENGINE_WAIT_MS },
  );
}
