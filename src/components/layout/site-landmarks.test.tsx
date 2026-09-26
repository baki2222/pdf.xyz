// @vitest-environment jsdom
/**
 * Navigation landmarks, as a phone receives them.
 *
 * WHAT SHIPPED: the header's `<nav aria-label="Primary">` is `hidden md:flex`,
 * so below `md` it is display:none, and its replacement, the mobile menu, was
 * a plain `<div>`. On a phone the landmark rotor listed banner, main and
 * contentinfo, and no navigation, on every page without a breadcrumb. The
 * footer's link columns were not a landmark either. The open menu ignored
 * Escape and stayed open across back/forward navigation.
 *
 * "Visible on a phone" is read from the classes that decide it: an element
 * (or ancestor) carrying a bare `hidden` is display:none below `md` whatever
 * `md:` variant follows it, while `md:hidden` hides only at `md` and up.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { describe, expect, it } from "vitest";
import { footerNav, primaryNav } from "@/lib/site";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

const ROUTER = {
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
} as never;

function at(pathname: string, children: ReactNode) {
  return (
    <PathnameContext.Provider value={pathname}>
      <AppRouterContext.Provider value={ROUTER}>
        {children}
      </AppRouterContext.Provider>
    </PathnameContext.Provider>
  );
}

function shownOnPhone(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if ((n.getAttribute("class") ?? "").split(/\s+/).includes("hidden")) {
      return false;
    }
  }
  return true;
}

/** Navigation landmarks a phone exposes, with the hrefs inside each. */
function phoneNavs(root: HTMLElement): string[][] {
  return [...root.querySelectorAll("nav, [role=navigation]")]
    .filter(shownOnPhone)
    .map((nav) =>
      [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? ""),
    );
}

const toggle = () => screen.getByRole("button", { name: /menu/i });

describe("the header on a phone", () => {
  it("the phone filter sees the desktop nav as hidden (the control)", () => {
    const { container } = render(at("/", <SiteHeader />));
    // Menu closed: the only nav is the desktop one, and it is `hidden`.
    expect(container.querySelectorAll("nav").length).toBeGreaterThan(0);
    expect(phoneNavs(container)).toEqual([]);
  });

  it("the open menu is a navigation landmark holding every primary link", () => {
    const { container } = render(at("/", <SiteHeader />));
    fireEvent.click(toggle());
    const navs = phoneNavs(container);
    expect(navs).toHaveLength(1);
    for (const item of primaryNav) expect(navs[0]).toContain(item.href);
  });

  it("Escape closes the menu and returns focus to the toggle", () => {
    const { container } = render(at("/", <SiteHeader />));
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const link = container.querySelector<HTMLAnchorElement>("#mobile-menu a");
    link?.focus();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("#mobile-menu")).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it("a route change closes the menu, whatever caused it", () => {
    const { container, rerender } = render(at("/", <SiteHeader />));
    fireEvent.click(toggle());
    expect(container.querySelector("#mobile-menu")).not.toBeNull();
    // Back/forward: no link click, only a new pathname.
    rerender(at("/tools", <SiteHeader />));
    expect(container.querySelector("#mobile-menu")).toBeNull();
    // And it still opens on the new route.
    fireEvent.click(toggle());
    expect(container.querySelector("#mobile-menu")).not.toBeNull();
  });
});

describe("the footer", () => {
  it("its link columns are a navigation landmark", () => {
    const { container } = render(at("/", <SiteFooter />));
    const hrefs = footerNav.flatMap((c) =>
      c.items.flatMap((i) => (i.href ? [i.href] : [])),
    );
    // Health check on the corpus the loop below runs over.
    expect(hrefs.length).toBeGreaterThan(10);
    const navs = phoneNavs(container);
    const covering = navs.filter((links) =>
      hrefs.every((h) => links.includes(h)),
    );
    expect(covering).toHaveLength(1);
  });
});
