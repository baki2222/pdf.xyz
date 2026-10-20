/**
 * Type size and measure for long-form reading: guides and the policy pages.
 *
 * Both used to set body copy at `text-sm` (14px) across a 768px column, which
 * is well over 100 characters a line. The comfortable range is roughly 60 to
 * 75. The measure is relative to the font size of the element it is set on,
 * so it goes on the same element as the font size.
 *
 * In `em`, not `ch`. The first fix was a 70ch max-width, and it changed nothing
 * a reader could count: `ch` is the advance of the digit zero, and Geist's is
 * 0.664 em against 0.47 em for an average character of its prose. "70ch" was
 * therefore a 744px column of about 100 characters a line, every guide and
 * both policy pages measured 97-102 on 2026-10-09. `ch` also follows the face
 * that is painting. The fallback's zero is Arial's (0.556 em), so on a first
 * visit the column was 635px until Geist arrived, then widened and moved every
 * paragraph below it (the first guide's late-font CLS, 0.0166). An `em` is
 * the same length in either face. 33 em holds about 70 characters.
 *
 * A comment is not a guard. `src/app/guides/guide-page.test.tsx` renders
 * every guide and both policy pages, and requires the body copy to carry an
 * `em` max-width and a size of at least 15px: the mechanism.
 * `e2e/reading-measure.spec.ts` counts the characters each line actually
 * holds, in the real face: the property.
 */
export const proseMeasure = "max-w-[33em] text-[15px] leading-7 sm:text-base";
