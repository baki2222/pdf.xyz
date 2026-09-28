"use client";

/**
 * Mounted once on every tool page. Renders nothing; it does two things:
 *
 *  1. Declares which tool this page runs ({@link enterToolPage}), so the run
 *     outcomes reported from the shared run hook and the job clients name the
 *     right tool without either of them importing the catalog.
 *  2. Sends `tool_viewed` — and sends it to a sink that EXISTS. GA4 is enabled
 *     from the root layout's effect, and React runs a child's effects before
 *     its parent's, so on a fresh load with consent already given this
 *     component mounts while the sink is still the no-op default. The event
 *     is therefore sent again, once, when a real sink is first configured —
 *     the same moment GA4 records the page view itself.
 */

import { useEffect } from "react";
import type { ToolCapability } from "@/lib/jobs/types";
import {
  isTelemetryConfigured,
  onTelemetryConfigured,
  track,
} from "@/lib/telemetry/track";
import { enterToolPage } from "@/lib/telemetry/tool-outcome";

export function ToolTelemetry({
  toolSlug,
  capability,
}: {
  toolSlug: string;
  capability: ToolCapability;
}): null {
  useEffect(() => {
    const leave = enterToolPage({ toolSlug, capability });
    const viewed = () => track({ name: "tool_viewed", toolSlug, capability });

    viewed();
    let unsubscribe = () => {};
    if (!isTelemetryConfigured()) {
      unsubscribe = onTelemetryConfigured(() => {
        unsubscribe();
        viewed();
      });
    }
    return () => {
      unsubscribe();
      leave();
    };
  }, [toolSlug, capability]);

  return null;
}
