// @vitest-environment jsdom
/**
 * `/workspace?tool=<slug>` reaches the rendered workspace, not only the helper.
 *
 * `/workspace` became static on this branch, so the deep link is read in the
 * browser: `WorkspaceClient` takes `window.location.search` after hydration
 * and hands it to `deepLinkedToolSlug`. The helper is unit-tested in
 * `pages-static.test.ts`, and review showed that was the only unit coverage:
 * changing the call to `deepLinkedToolSlug("", tools)` left every unit test
 * green, because none of them renders the component that makes the call. Only
 * the e2e spec saw it. This renders the client with a real query string and
 * reads the result where a visitor sees it: the tool surfaced as Suggested.
 *
 * The control is the same render with no query, which must surface nothing as
 * Suggested, so a component that always marks something cannot pass.
 */
import { cleanup, render } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { getPopularTools } from "@/lib/tools";
import { buildToolSummaries } from "./presenter";
import { WorkspaceClient } from "./workspace-client";

const tools = buildToolSummaries();
const popularSlugs = new Set(getPopularTools(6).map((t) => t.slug));
const popular = tools.filter((t) => popularSlugs.has(t.slug));
/** A real tool that is NOT in the popular list, so it can only come from the URL. */
const target = tools.find((t) => !popularSlugs.has(t.slug))!;

/** The real App Router context with an inert router: no `vi.mock` needed. */
const ROUTER = {
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
} as never;

function renderAt(search: string) {
  window.history.replaceState(null, "", `/workspace${search}`);
  return render(
    <AppRouterContext.Provider value={ROUTER}>
      <WorkspaceClient tools={tools} popular={popular} />
    </AppRouterContext.Provider>,
  );
}

function suggested(container: HTMLElement): string[] {
  return [...container.querySelectorAll('a[aria-current="true"]')].map(
    (a) => a.getAttribute("href") ?? "",
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("the workspace reads ?tool= after hydration", () => {
  it("the fixture tool is real and not already popular", () => {
    expect(target).toBeDefined();
    expect(popularSlugs.has(target.slug)).toBe(false);
  });

  it("surfaces the deep-linked tool as Suggested", () => {
    const { container } = renderAt(`?tool=${target.slug}`);
    expect(suggested(container)).toEqual([`/tools/${target.slug}`]);
  });

  it("control: with no query, nothing is Suggested", () => {
    const { container } = renderAt("");
    expect(suggested(container)).toEqual([]);
  });

  it("an unknown slug is ignored, not surfaced", () => {
    const { container } = renderAt("?tool=not-a-tool");
    expect(suggested(container)).toEqual([]);
  });
});
