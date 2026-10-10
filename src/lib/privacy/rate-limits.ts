/**
 * What /privacy says about rate limiting, in both of the states the limiter
 * can be in — and which one it renders, chosen by the flag the limiter reads.
 *
 * The windows are the limiter's own (`RATE_LIMIT_POLICIES`), so a policy that
 * grows a longer window moves the sentence with it.
 */
import { RATE_LIMIT_POLICIES } from "@/lib/ratelimit/policy";
import { PER_CLIENT_KEYING_DISCLOSED } from "./keying";

/** `n` and its unit, singular when `n` is 1. */
function quantity(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** A window in the largest whole unit that states it exactly. */
function windowText(seconds: number): string {
  if (seconds % 86_400 === 0) return quantity(seconds / 86_400, "day");
  if (seconds % 3_600 === 0) return quantity(seconds / 3_600, "hour");
  if (seconds % 60 === 0) return quantity(seconds / 60, "minute");
  return quantity(seconds, "second");
}

/** The longest window any policy counts over. */
export const LONGEST_RATE_LIMIT_WINDOW = windowText(
  Math.max(...Object.values(RATE_LIMIT_POLICIES).map((p) => p.windowSeconds)),
);

/** Every visitor counted together: today's state. */
const SHARED = `To keep the service available, we count requests in fixed time windows of up to ${LONGEST_RATE_LIMIT_WINDOW} and refuse them once a limit is reached. Today every visitor's requests are counted together, in shared counters that hold no identifier, so nothing about you is stored to do this. Each counter resets when its window ends.`;

/** Each address counted separately: what switching keying on would mean. */
const PER_CLIENT = `To keep the service available, we count requests per network address in fixed time windows of up to ${LONGEST_RATE_LIMIT_WINDOW} and refuse them once a limit is reached. The address itself is not stored: it is turned into a salted, one-way hash, which is kept with its counter until the window ends and then expires. Everyone who shares one address, such as an office or a café, shares one count.`;

/** The sentence /privacy §4 renders, for the state the limiter is in. */
export const RATE_LIMIT_DISCLOSURE = PER_CLIENT_KEYING_DISCLOSED
  ? PER_CLIENT
  : SHARED;

/**
 * What a "Notify me" press adds to the limiter, for §4's bullet about it:
 * nothing to say while the counters are shared.
 *
 * It read "The press also counts toward the rate limit for your network
 * address, kept as a hash as described above." until review (2026-10-10),
 * when the disclosed counterfactual (the flag flipped, privacy-truth run)
 * put the bullet at 640 characters, past §4's 600-character bound. The
 * per-client sentence above already says what is hashed and for how long.
 */
export const INTEREST_RATE_LIMIT_NOTE = PER_CLIENT_KEYING_DISCLOSED
  ? " It also counts toward the per-address rate limit above."
  : "";
