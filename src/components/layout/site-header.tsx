import { Container } from "@/components/ui/container";
import { Logo } from "@/components/layout/logo";
import { PaletteTrigger } from "@/components/intent/palette-trigger";
import { MobileMenu } from "./mobile-menu";
import { NavLinks } from "./nav-links";
import { OpenFilesButton } from "./open-files-button";

/**
 * Masthead (D.1). A SERVER shell with client islands: the links (current by
 * path and query), the palette's trigger, "Open files" and the phone's menu.
 * It carries the paper theme scope itself because it renders outside every
 * page's own wrapper: an opaque paper band with a hairline rule, on every
 * route. No blur, no translucency — a masthead, not a glass strip.
 *
 *   1440  pdf.xyz │ All tools  AI tools  Guides  Workspace  Pricing │ [⌕ Find a tool or guide  Ctrl K] [⊕ Open files]
 *    768  pdf.xyz │ All tools  AI tools  Guides  Workspace          │ [⌕] [⊕ Open files]
 *    390  pdf.xyz                                     [⌕] [⊕] [☰]
 *
 * Below `md` the desktop `<nav>` is display:none, and the menu's dialog is
 * the page's navigation (a landmark named "Menu"). The header renders NO
 * file input — "Open files" opens the page's own picker — so the first file
 * input on any page is that page's (G.5 trap 3, site-landmarks.test.tsx).
 * Its height is `--sf-header-h`, which the scroll padding also reads
 * (scroll-behavior.test.ts). Scrolled off the top, its rule lifts (M17,
 * `data-masthead`); its logo's P reports the page's activity (M16).
 */
export function SiteHeader() {
  return (
    <header
      data-masthead
      className="bg-canvas border-line sticky top-0 z-50 border-b"
    >
      <Container className="flex h-[var(--sf-header-h)] items-center gap-6">
        <Logo live />

        <nav className="hidden items-center gap-5 md:flex" aria-label="Primary">
          <NavLinks variant="bar" />
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <PaletteTrigger />
          <OpenFilesButton />
          <MobileMenu />
        </div>
      </Container>
    </header>
  );
}
