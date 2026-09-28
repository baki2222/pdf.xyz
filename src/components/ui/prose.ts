/**
 * Type size and measure for long-form reading: guides and the policy pages.
 *
 * Both used to set body copy at `text-sm` (14px) across a 768px column, which
 * is well over 100 characters a line. The comfortable range is roughly 60 to
 * 75. The measure is in `ch`, and `ch` is relative to the font of the element
 * it is set on, so it goes on the same element as the font size.
 *
 * A comment is not a guard: `src/app/guides/guide-page.test.tsx` renders
 * every guide and both policy pages and requires the body copy to carry a
 * `ch` max-width and a size of at least 15px.
 */
export const proseMeasure = "max-w-[70ch] text-[15px] leading-7 sm:text-base";
