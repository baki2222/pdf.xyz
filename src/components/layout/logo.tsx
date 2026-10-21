import Link from "next/link";
import {
  LOGO_ASPECT,
  LOGO_COLOURS,
  LOGO_DOT,
  LOGO_GLYPHS,
  LOGO_P_TRANSFORM,
  LOGO_VIEWBOX,
  P_BODY,
  P_FOLD,
  type LogoRole,
} from "@/lib/brand";
import { siteConfig } from "@/lib/site";
import { cn } from "@/lib/utils";
import { ActivityMark } from "./activity-mark";

/**
 * The pdf.xyz logo: the Folded P as the first letter of the name (`@/lib/brand`,
 * from the owner's brand pack). Inline SVG, so it is in the first paint at its
 * final size — 36px tall, the header's 56px band unchanged — and named
 * "pdf.xyz" for assistive technology.
 *
 * ONE DRAWING, BOTH SCHEMES. Each part's colour is `light-dark(light, dark)`
 * of the pack's two variants, so it follows the `color-scheme` of whatever
 * scope the logo sits in — the paper header and footer in either system
 * scheme, or an ink band — with no second SVG and no stylesheet bytes. The
 * paths paint `currentColor`, so where `light-dark()` is not understood the
 * logo falls back to the link's text colour, one colour like the pack's mono
 * variants; in forced colours `.brand-logo` (globals.css) makes it the
 * system's text colour.
 *
 * `live` (the masthead's): the P reports what the page is doing —
 * `ActivityMark`, fed by the activity bus (spec E.11, M16).
 *
 * WAS a 10px accent square beside the name set in Geist Mono — the
 * registration-mark lockup the pack replaced.
 */
const HEIGHT = 36;

function paint(role: LogoRole) {
  return {
    color: `light-dark(${LOGO_COLOURS.light[role]}, ${LOGO_COLOURS.dark[role]})`,
  };
}

export function Logo({
  href = "/",
  className,
  live = false,
}: {
  href?: string;
  className?: string;
  live?: boolean;
}) {
  const p = (
    <>
      <path
        className="reg-body"
        d={P_BODY}
        fillRule="evenodd"
        fill="currentColor"
        style={paint("mark")}
      />
      <path
        className="reg-fold"
        d={P_FOLD}
        fill="currentColor"
        style={paint("fold")}
      />
    </>
  );
  return (
    <Link href={href} className={cn("inline-flex shrink-0", className)}>
      <svg
        className="brand-logo"
        role="img"
        aria-label={siteConfig.name}
        viewBox={LOGO_VIEWBOX}
        width={Math.round(HEIGHT * LOGO_ASPECT)}
        height={HEIGHT}
        overflow="visible"
      >
        <g transform={LOGO_P_TRANSFORM}>
          {live ? (
            <ActivityMark className="reg-mark transition-transform duration-200">
              {p}
            </ActivityMark>
          ) : (
            p
          )}
        </g>
        {LOGO_GLYPHS.map((glyph) => (
          <path
            key={glyph.x}
            d={glyph.d}
            transform={`translate(${glyph.x} 0)`}
            fillRule="evenodd"
            fill="currentColor"
            style={paint(glyph.role)}
          />
        ))}
        <circle
          cx={LOGO_DOT.cx}
          cy={LOGO_DOT.cy}
          r={LOGO_DOT.r}
          fill="currentColor"
          style={paint("dot")}
        />
      </svg>
    </Link>
  );
}
