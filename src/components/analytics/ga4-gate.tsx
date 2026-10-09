"use client";

/**
 * The one place the consent decision becomes action. Renders nothing; watches
 * the stored decision and enables/disables GA4 accordingly. Mounted once in the
 * root layout, so a decision made anywhere (the banner, the privacy page's
 * choices control, another tab) takes effect everywhere without a reload.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAnalyticsConsent } from "@/lib/analytics/consent";
import { disableGa4, enableGa4, sendGa4PageView } from "@/lib/analytics/ga4";

export function Ga4Gate(): null {
  const consent = useAnalyticsConsent();
  // The PATH, never the URL: `usePathname()` carries no query string, which is
  // what keeps `?handoff=<token>` out of every page view.
  const pathname = usePathname();

  useEffect(() => {
    if (consent === "granted") enableGa4();
    else if (consent === "denied") disableGa4();
    // `null` (undecided) deliberately does nothing: basic consent mode means
    // the tag simply does not exist until an explicit yes.
  }, [consent]);

  // One page view per route, sent by us. The tag's own automatic page_view is
  // off (`send_page_view: false`) because it reports `location.href`.
  useEffect(() => {
    if (consent === "granted" && pathname) sendGa4PageView(pathname);
  }, [consent, pathname]);

  return null;
}
