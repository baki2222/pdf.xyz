import type { ReactElement } from "react";
import { vi } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * Render `ui` inside the App Router's own context, with a router whose
 * navigation methods are spies.
 *
 * WHY NOT `vi.mock("next/navigation")`. Under `isolate: false` a module is
 * evaluated once per worker and cached. A runner that reaches `useRouter`
 * (every single-PDF runner, through `use-tool-handoff`) is imported by many
 * test files; if any of them runs first, the runner is cached bound to the
 * REAL `next/navigation`, and a later file's mock never reaches it — its test
 * then fails with "invariant expected app router to be mounted", depending on
 * which files share a worker. It did, at the merge of the tools lanes with
 * the copy lanes (edit-runner.test.tsx, green alone, red in the full run).
 * `useRouter` reads this context, so providing it works whatever is cached.
 */
export function withAppRouter(ui: ReactElement): ReactElement {
  const router = {
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };
  return (
    <AppRouterContext.Provider value={router as never}>
      {ui}
    </AppRouterContext.Provider>
  );
}
