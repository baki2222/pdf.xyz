"use client";

/**
 * The analytics consent ask. Renders only while the visitor has never
 * answered; either button stores a decision and the banner is gone for good
 * (the privacy page's choices control is the way back).
 *
 * Two properties are deliberate and load-bearing:
 *
 *  - It appears only after hydration (`useMounted` below). The server snapshot
 *    of the decision is always `null`, so rendering on that would put the
 *    banner in every visitor's served HTML — including the ones who already
 *    declined, who would watch it flash and vanish on every page.
 *  - Decline is the same size, weight, and reach as Accept. A consent that is
 *    harder to refuse than to give is not consent.
 */

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { storeConsent, useAnalyticsConsent } from "@/lib/analytics/consent";
import { Button } from "@/components/ui/button";

const emptySubscribe = () => () => {};

/** True after hydration; false in SSR HTML. No effect, no setState-in-effect. */
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function ConsentBanner() {
  const mounted = useMounted();
  const consent = useAnalyticsConsent();

  if (!mounted || consent !== null) return null;

  return (
    <section
      aria-label="Analytics consent"
      className="bg-canvas border-line-strong fixed right-4 bottom-4 left-4 z-[90] mx-auto max-w-xl rounded-[3px] border p-4 shadow-lg sm:left-auto sm:mx-0"
    >
      <p className="text-fg text-sm leading-relaxed">
        <span className="font-semibold">Analytics, only if you say yes.</span>{" "}
        We&rsquo;d like to use Google Analytics to count visits and see which
        tools help. Nothing loads and nothing is sent unless you allow it —
        declining changes nothing about how the site works.{" "}
        <Link
          href="/privacy#cookies"
          className="text-muted hover:text-fg underline underline-offset-2"
        >
          Details in the privacy policy
        </Link>
        .
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => storeConsent("granted")}>
          Allow analytics
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => storeConsent("denied")}
        >
          No thanks
        </Button>
      </div>
    </section>
  );
}
