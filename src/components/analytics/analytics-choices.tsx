"use client";

/**
 * The way back to the consent decision, embedded in the privacy policy's
 * cookies section. GDPR's requirement that withdrawing consent be as easy as
 * giving it is met by putting the switch inside the document people are sent
 * to when they ask about it.
 */

import { storeConsent, useAnalyticsConsent } from "@/lib/analytics/consent";
import { Button } from "@/components/ui/button";

const STATE_COPY = {
  granted: "Your current choice: analytics allowed.",
  // Not "nothing is loaded": withdrawing on a page where the tag already ran
  // cannot unload it. What IS true, and `disableGa4` does all of it: the tag
  // is switched off (Google's documented hard opt-out) and its cookies are
  // deleted; the next page load never fetches it at all.
  denied:
    "Your current choice: analytics declined. Google Analytics is switched off and its cookies are removed.",
  undecided:
    "You haven't decided yet — until you allow it, no analytics code loads.",
} as const;

export function AnalyticsChoices() {
  const consent = useAnalyticsConsent();

  return (
    <div className="border-line rounded-ctl mt-2 flex flex-col gap-3 border p-4">
      <p className="text-fg text-sm font-medium" aria-live="polite">
        {STATE_COPY[consent ?? "undecided"]}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={consent === "granted" ? "secondary" : "primary"}
          onClick={() => storeConsent("granted")}
        >
          Allow analytics
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => storeConsent("denied")}
        >
          Decline analytics
        </Button>
      </div>
    </div>
  );
}
