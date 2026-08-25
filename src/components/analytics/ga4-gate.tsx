"use client";

/**
 * The one place the consent decision becomes action. Renders nothing; watches
 * the stored decision and enables/disables GA4 accordingly. Mounted once in the
 * root layout, so a decision made anywhere (the banner, the privacy page's
 * choices control, another tab) takes effect everywhere without a reload.
 */

import { useEffect } from "react";
import { useAnalyticsConsent } from "@/lib/analytics/consent";
import { disableGa4, enableGa4 } from "@/lib/analytics/ga4";

export function Ga4Gate(): null {
  const consent = useAnalyticsConsent();

  useEffect(() => {
    if (consent === "granted") enableGa4();
    else if (consent === "denied") disableGa4();
    // `null` (undecided) deliberately does nothing: basic consent mode means
    // the tag simply does not exist until an explicit yes.
  }, [consent]);

  return null;
}
