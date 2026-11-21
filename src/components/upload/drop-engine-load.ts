/**
 * THE ONE PATH A DROP BOX'S ENGINE COMES BY. `useDropBox` fetches its engine
 * (`attachDropBox`) through this, and so does the test helper that warms the
 * engine before a test renders a sheet (`src/tests/drop-sheets-live.ts`).
 * One loader, two callers: if the hook's engine ever moves to another module,
 * the warm-up moves with it, because it no longer names a module of its own
 * (`drop-sheets-live.test.tsx` counts both calls through a spy on this file).
 */
export const loadDropEngine = () => import("@/lib/intent/page-target");
