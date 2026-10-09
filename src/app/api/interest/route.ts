/**
 * POST /api/interest — count one "notify me" click for a gated tool.
 *
 * The write half of the demand signal: the body carries a tool slug and
 * nothing else, and the effect is one `INCR` on a per-slug counter (see
 * `@/lib/interest/store`). This is the whole contract. `/privacy` §4
 * discloses it verbatim, and the Notify-me button says what pressing it
 * sends — the page, the button copy, and this route ship together.
 *
 * Abuse posture, in order:
 *  - **Guard first.** The click budget is a typed policy (`interest.note`)
 *    through the same distributed guard as every public write. A denial is a
 *    content-free 429 before the body is even read.
 *  - **The catalogue is the allowlist.** The slug must name a real tool, and
 *    the stored key is derived from the CATALOGUE's copy of the slug — not
 *    the caller's string — so the endpoint cannot be used to write an
 *    arbitrary key, and the key space is bounded by the compiled catalogue.
 *  - **Fail open, silent, but never secretly.** A missing or failing store
 *    never changes the response: the click is acknowledged 202 regardless,
 *    because a telemetry write must never affect the user's request. A
 *    failing store is still visible to the operator via the store module's
 *    throttled warn line.
 *
 * It reveals nothing back: no counts (the demand data is the operator's, not
 * the public's), no store state, no distinction between counted and
 * not-counted. `{ noted: true }` means "your ask was heard", which is true in
 * every branch — the button's own copy is the surface that says what was sent.
 */

import { ok } from "@/lib/jobs";
import { getToolBySlug } from "@/lib/tools";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { noteToolInterest } from "@/lib/interest/store";
import {
  readJsonBody,
  rejectCrossSite,
  respond,
  respondRateLimited,
} from "../_lib/http";
import { apiError } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // Cross-site browser writes are refused before anything else — including
  // the rate-limit charge they would otherwise spend (see rejectCrossSite).
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const limit = await enforceRateLimit("interest.note", request);
  if (!limit.allowed) return respondRateLimited(limit);

  const body = await readJsonBody(request);
  if (!body.ok) return respond(body.error);

  const slug = (body.value as { slug?: unknown }).slug;
  const tool = typeof slug === "string" ? getToolBySlug(slug) : undefined;
  if (!tool) {
    // Content-free: the offending string is never echoed, logged, or stored.
    return respond(apiError("invalid_request", "Unknown tool."));
  }

  // The catalogue's copy of the slug, not the caller's string — so the only
  // keys this endpoint can ever produce are the compiled catalogue's slugs.
  await noteToolInterest(tool.slug);

  return respond(ok({ noted: true }, 202));
}
