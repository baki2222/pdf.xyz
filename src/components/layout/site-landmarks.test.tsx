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
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { footerNav, primaryNav } from "@/lib/site";
import { GUIDE_META } from "@/lib/guides/meta.generated";
import { RECENTS_STORAGE_KEY } from "@/lib/intent/recents-key";
import {
  categories,
  getAllToolSlugs,
  getToolBySlug,
  toolCount,
} from "@/lib/tools";
import { CATEGORY_PATH_PREFIX, categoryHref } from "@/lib/tools/category-href";
import { announceLocation } from "@/lib/location-search";
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

function at(pathname: string, children: ReactNode, search = "") {
  // The header reads the query from the address (not useSearchParams, which
  // bails a prerendered page's boundary out of the server render).
  window.history.replaceState(
    null,
    "",
    `${pathname}${search ? `?${search}` : ""}`,
  );
  return (
    <PathnameContext.Provider value={pathname}>
      <AppRouterContext.Provider value={ROUTER}>
        {children}
      </AppRouterContext.Provider>
    </PathnameContext.Provider>
  );
}

beforeAll(() => {
  // jsdom has <dialog> but not its modal API; the browser's is what ships.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => {
  localStorage.clear();
});

function shownOnPhone(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if ((n.getAttribute("class") ?? "").split(/\s+/).includes("hidden")) {
      return false;
    }
    // A closed <dialog> is display:none whatever its classes say.
    if (n instanceof HTMLDialogElement && !n.open) return false;
  }
  return true;
}

/** Navigation landmarks a phone exposes, with the hrefs inside each. */
function phoneNavs(root: ParentNode): string[][] {
  return [...root.querySelectorAll("nav, [role=navigation]")]
    .filter(shownOnPhone)
    .map((nav) =>
      [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? ""),
    );
}

const toggle = () => screen.getByRole("button", { name: "Open menu" });
const menu = () =>
  document.querySelector<HTMLDialogElement>("dialog#mobile-menu");

describe("the header on a phone", () => {
  it("the phone filter sees the desktop nav as hidden (the control)", () => {
    const { container } = render(at("/", <SiteHeader />));
    // Menu closed: the only nav is the desktop one, and it is `hidden`.
    expect(container.querySelectorAll("nav").length).toBeGreaterThan(0);
    expect(phoneNavs(document)).toEqual([]);
  });

  it("the open menu is a dialog with a navigation landmark named Menu, holding every primary link", () => {
    render(at("/", <SiteHeader />));
    fireEvent.click(toggle());
    expect(menu()?.open).toBe(true);
    const navs = phoneNavs(document);
    expect(navs).toHaveLength(1);
    for (const item of primaryNav) expect(navs[0]).toContain(item.href);
    // Named "Menu", so it never duplicates the desktop "Primary".
    const nav = within(menu()!).getByRole("navigation");
    expect(nav.getAttribute("aria-label")).toBe("Menu");
    // And it ends on the full-width "Open workspace".
    expect(
      within(menu()!).getByRole("link", { name: "Open workspace" }),
    ).toBeTruthy();
  });

  it("Escape closes the menu and returns focus to the toggle", () => {
    render(at("/", <SiteHeader />));
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const link = menu()!.querySelector<HTMLAnchorElement>("a");
    link?.focus();
    act(() => {
      fireEvent.keyDown(menu()!, { key: "Escape" });
    });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(menu()?.open).toBe(false);
    expect(phoneNavs(document)).toEqual([]);
    expect(document.activeElement).toBe(toggle());
  });

  it("a route change closes the menu, whatever caused it", () => {
    const { rerender } = render(at("/", <SiteHeader />));
    fireEvent.click(toggle());
    expect(menu()?.open).toBe(true);
    // Back/forward: no link click, only a new pathname.
    rerender(at("/tools", <SiteHeader />));
    expect(menu()?.open).toBe(false);
    expect(document.activeElement).toBe(toggle());
    // And it still opens on the new route.
    fireEvent.click(toggle());
    expect(menu()?.open).toBe(true);
  });

  it("lists recent tools only when this browser has some", async () => {
    render(at("/", <SiteHeader />));
    fireEvent.click(toggle());
    // None stored: no section at all (not an empty heading).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(within(menu()!).queryByText("Recent tools")).toBeNull();
    act(() => {
      fireEvent.keyDown(menu()!, { key: "Escape" });
    });

    localStorage.setItem(
      RECENTS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        items: [{ slug: "merge-pdf", at: 1 }],
      }),
    );
    fireEvent.click(toggle());
    const name = getToolBySlug("merge-pdf")!.name;
    const recent = await within(menu()!).findByRole("list", {
      name: "Recent tools",
    });
    expect(
      within(recent).getByRole("link", { name }).getAttribute("href"),
    ).toBe("/tools/merge-pdf");
    await waitFor(() =>
      expect(within(menu()!).getByText("Recent tools")).toBeTruthy(),
    );
  });
});

describe("the header", () => {
  it("renders no file input, ever (G.5 trap 3)", () => {
    const { container } = render(at("/", <SiteHeader />));
    fireEvent.click(toggle());
    expect(container.querySelectorAll("input").length).toBe(0);
    expect(document.querySelectorAll('input[type="file"]').length).toBe(0);
  });

  it("has an Open files button and a palette trigger with its shortcut", () => {
    render(at("/", <SiteHeader />));
    expect(screen.getByRole("button", { name: "Open files" })).toBeTruthy();
    const trigger = screen.getByRole("button", {
      name: "Find a tool or guide",
    });
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Control+K Meta+K");
    // "Explore tools" is gone (D.1).
    expect(screen.queryByText("Explore tools")).toBeNull();
  });

  it("on /tools?category=ai only AI tools carries aria-current", () => {
    render(at("/tools", <SiteHeader />, "category=ai"));
    const primary = screen.getByRole("navigation", { name: "Primary" });
    const current = [...primary.querySelectorAll("[aria-current]")].map(
      (a) => a.textContent,
    );
    expect(current).toEqual(["AI tools"]);
    expect(
      within(primary)
        .getByRole("link", { name: "AI tools" })
        .getAttribute("href"),
    ).toBe(categoryHref("ai"));
  });

  it("follows a query the page rewrites in place (the /tools explorer's chips)", () => {
    render(at("/tools", <SiteHeader />));
    const primary = screen.getByRole("navigation", { name: "Primary" });
    const current = () =>
      [...primary.querySelectorAll("[aria-current]")].map((a) => a.textContent);
    expect(current()).toEqual(["All tools"]);
    // What the explorer does on a chip: replaceState, then announce it.
    act(() => {
      window.history.replaceState(null, "", "/tools?category=ai");
      announceLocation();
    });
    expect(current()).toEqual(["AI tools"]);
  });

  it("control: on plain /tools it is All tools", () => {
    render(at("/tools", <SiteHeader />));
    const primary = screen.getByRole("navigation", { name: "Primary" });
    const current = [...primary.querySelectorAll("[aria-current]")].map(
      (a) => a.textContent,
    );
    expect(current).toEqual(["All tools"]);
  });
});

describe("the footer", () => {
  /*
   * ONE COMPACT FOOTER (owner, 2026-10-23). The footer was two link blocks:
   * the columns — one of them, "Categories", listing every category — and
   * under them the tools band, every tool under the SAME category names
   * again. On a phone the columns stacked one above another, 1,927px of
   * footer. Each category is named once now: the band's group heading links
   * its landing page, and the columns carry everything else.
   *
   * WAS "its link columns are a navigation landmark": ONE nav covering every
   * `footerNav` href, the Categories column's included. Inverted: the
   * columns' landmark covers every href that is not a category page, the
   * band covers every category page, and each category page is linked once.
   */
  const footerHrefs = footerNav.flatMap((c) =>
    c.items.flatMap((i) => (i.href ? [i.href] : [])),
  );
  const isCategory = (href: string) => href.startsWith(CATEGORY_PATH_PREFIX);

  it("its link columns are a navigation landmark, and the band links the categories", () => {
    const { container } = render(at("/", <SiteFooter />));
    // Health checks on the corpus the loops below run over: both halves.
    expect(footerHrefs.filter((h) => !isCategory(h)).length).toBeGreaterThan(6);
    expect(footerHrefs.filter(isCategory)).toHaveLength(categories.length);
    const navs = phoneNavs(container);
    const covering = navs.filter((links) =>
      footerHrefs.filter((h) => !isCategory(h)).every((h) => links.includes(h)),
    );
    expect(covering).toHaveLength(1);
    const band = screen.getByRole("navigation", { name: "Tools by category" });
    const bandHrefs = [...band.querySelectorAll("a")].map(
      (a) => a.getAttribute("href") ?? "",
    );
    for (const c of categories)
      expect(bandHrefs, c.id).toContain(categoryHref(c.id));
  });

  it("names each category once: no category page is linked twice", () => {
    const { container } = render(at("/", <SiteFooter />));
    const categoryLinks = [...container.querySelectorAll("a")]
      .map((a) => a.getAttribute("href") ?? "")
      .filter(isCategory);
    expect(categoryLinks.length).toBe(categories.length);
    expect(new Set(categoryLinks).size).toBe(categoryLinks.length);
  });

  it("no heading in the footer is a mono capital kicker", () => {
    const { container } = render(at("/", <SiteFooter />));
    const marked = [
      ...container.querySelectorAll<HTMLElement>("h2, h3, summary"),
    ].filter((el) =>
      /(^|\s)(kicker|font-mono|uppercase)(\s|$)/.test(el.className),
    );
    // Health: there are headings to read.
    expect(
      container.querySelectorAll("h2, h3, summary").length,
    ).toBeGreaterThan(categories.length);
    expect(marked.map((el) => el.textContent)).toEqual([]);
  });

  it("a Guides column: the first five guides, then All guides", () => {
    render(at("/", <SiteFooter />));
    const footer = screen.getByRole("contentinfo");
    const heading = within(footer).getByRole("heading", { name: "Guides" });
    const list = heading.parentElement!.querySelector("ul")!;
    const hrefs = [...list.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(GUIDE_META.length).toBeGreaterThan(5);
    expect(hrefs).toEqual([
      ...GUIDE_META.slice(0, 5).map((g) => `/guides/${g.slug}`),
      "/guides",
    ]);
    expect(list.lastElementChild?.textContent).toBe("All guides");
  });

  it("a Tools band links every tool exactly once, by category, in closed <details>", () => {
    render(at("/", <SiteFooter />));
    const band = screen.getByRole("navigation", { name: "Tools by category" });
    const hrefs = [...band.querySelectorAll("a")]
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => /^\/tools\/[a-z0-9-]+$/.test(h));
    // Health: the catalogue is real.
    expect(toolCount).toBeGreaterThanOrEqual(40);
    expect(hrefs).toHaveLength(toolCount);
    expect([...new Set(hrefs)].sort()).toEqual(
      getAllToolSlugs()
        .map((s) => `/tools/${s}`)
        .sort(),
    );
    const details = [...band.querySelectorAll("details")];
    expect(details).toHaveLength(categories.length);
    // Closed on arrival (a phone sees eight headings); the links are in the DOM.
    expect(details.filter((d) => d.open)).toEqual([]);
  });
});

/**
 * One name, one destination (WCAG 2.4.4 and 3.2.4).
 *
 * WHAT SHIPPED: the footer carried two links named "Privacy" — the Company
 * column's to the homepage's privacy section (`/#privacy`), the bottom row's
 * to the privacy policy (`/privacy`). A screen reader's links list showed
 * "Privacy" twice with nothing to tell them apart, and a sighted reader
 * clicking the first expecting the policy got a marketing section.
 *
 * Read across the chrome every page carries — the header (with its menu
 * open, so the phone's links count) and the footer — so a name reused in
 * either for a different place is caught, not only the footer's.
 */
describe("the chrome's links", () => {
  /** Accessible name → the distinct places links with that name go. */
  function destinationsByName(root: HTMLElement): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const a of root.querySelectorAll("a[href]")) {
      const name = (a.getAttribute("aria-label") ?? a.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (!name) continue;
      const href = new URL(a.getAttribute("href")!, "https://pdf.xyz").href;
      out.set(name, (out.get(name) ?? new Set()).add(href));
    }
    return out;
  }

  const ambiguous = (byName: Map<string, Set<string>>) =>
    [...byName]
      .filter(([, hrefs]) => hrefs.size > 1)
      .map(([name, hrefs]) => `${name} → ${[...hrefs].sort().join(" | ")}`);

  function chrome(): HTMLElement {
    const { container } = render(
      at(
        "/",
        <>
          <SiteHeader />
          <SiteFooter />
        </>,
      ),
    );
    fireEvent.click(toggle());
    return container;
  }

  it("health check: the header and the footer both rendered their links", () => {
    expect(destinationsByName(chrome()).size).toBeGreaterThan(20);
  });

  it("no two links share a name and go to different places", () => {
    expect(ambiguous(destinationsByName(chrome()))).toEqual([]);
  });

  it("positive control: the pair that shipped is reported", () => {
    const root = document.createElement("div");
    root.innerHTML = `<a href="/#privacy">Privacy</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/terms">Terms</a>`;
    expect(ambiguous(destinationsByName(root))).toEqual([
      "Privacy → https://pdf.xyz/#privacy | https://pdf.xyz/privacy",
    ]);
  });
});
