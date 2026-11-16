/**
 * The rollback check: did the worker confirm it read ONLY the pages the
 * person chose?
 *
 * A request naming pages can reach an image that predates page selection
 * (the route admits it only while a fresh heartbeat proves the key, but a
 * fleet can change between admission and processing). Such an image ignores
 * the unknown option and summarizes the document's prefix — and nothing in
 * its result is false, it just does not say which pages it read. The panel
 * therefore compares what it SENT with what the result ECHOES
 * (`truncation.pagesSent`, re-bounded by `buildAiResultMeta`) and warns
 * unless they agree.
 *
 * Agreement is not mere presence: an echo naming pages the person did not
 * choose must warn too, never render as a confident sentence. Both sides are
 * canonical spans (`./page-spans-option`), so equality is exact.
 *
 * Pure, type-only imports: it ships with the panel.
 */

import type { PageSpan } from "@/lib/pdf/page-spans";
import type { AiWindowMeta } from "./ai-results";

/**
 * True only when `window.pagesSent` is present and either deep-equals `sent`
 * or, when `window.truncated`, is a prefix clip of it: every span equal to
 * `sent`'s except the last, whose start is equal and whose end is no later.
 */
export function selectionConfirmed(
  sent: readonly PageSpan[],
  window: Pick<AiWindowMeta, "truncated" | "pagesSent"> | null | undefined,
): boolean {
  const echoed = window?.pagesSent;
  if (!echoed || echoed.length === 0 || sent.length === 0) return false;
  if (echoed.length > sent.length) return false;
  const lastIndex = echoed.length - 1;
  for (let i = 0; i < echoed.length; i += 1) {
    const [a, b] = echoed[i]!;
    const [sa, sb] = sent[i]!;
    if (a !== sa) return false;
    if (i < lastIndex) {
      if (b !== sb) return false;
      continue;
    }
    // The last echoed span: whole unless truncated, when it may end early.
    if (window.truncated === true ? b > sb || b < a : b !== sb) return false;
  }
  // Untruncated, every chosen span must be echoed, not only a prefix of them.
  return window.truncated === true || echoed.length === sent.length;
}
