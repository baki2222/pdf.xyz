import type { CDPSession, Page } from "@playwright/test";

/**
 * Where things are, frame by frame — the instrument for "this never moves".
 *
 * A layout-shift total says THAT something moved, after the fact and summed
 * over everything; it cannot say what, or in which frame. These specs ask a
 * narrower question: did THIS element (the Download button, the runner under
 * the job's row) change position between two painted frames, and what else
 * changed in that frame. So every animation frame records, for each element
 * named, its position in the DOCUMENT — the offset chain, which neither a
 * scroll nor a transform changes (the result panel rises in with a
 * transform, and takes focus with a scroll; neither is a layout shift) —
 * and whether each selector named is present.
 *
 * Runs in the page's own `requestAnimationFrame`, so it samples exactly the
 * frames the browser paints, and keeps running across a client-side
 * navigation (Continue with is one).
 */

export interface FrameProbe {
  /**
   * Elements whose document position is read each frame: the first that
   * matches `selector` and contains `text`, or — with `closest` — the
   * nearest ancestor of it that matches (a card found by its title).
   */
  readonly tops: Readonly<
    Record<
      string,
      {
        readonly selector: string;
        readonly text?: string;
        readonly closest?: string;
      }
    >
  >;
  /** Selectors whose presence is read each frame. */
  readonly present: Readonly<Record<string, string>>;
}

export interface Frame {
  readonly t: number;
  readonly path: string;
  readonly tops: Readonly<Record<string, number | null>>;
  readonly present: Readonly<Record<string, boolean>>;
}

export async function startFrames(page: Page, probe: FrameProbe) {
  await page.evaluate((probe) => {
    const w = window as unknown as {
      __frames: unknown[];
      __framesStop?: boolean;
    };
    w.__frames = [];
    w.__framesStop = false;
    const find = (spec: {
      selector: string;
      text?: string;
      closest?: string;
    }) => {
      for (const el of document.querySelectorAll<HTMLElement>(spec.selector))
        if (!spec.text || (el.textContent ?? "").includes(spec.text))
          return spec.closest ? el.closest<HTMLElement>(spec.closest) : el;
      return null;
    };
    // The offset chain: layout position, untouched by transforms and scroll.
    const docTop = (el: HTMLElement) => {
      let top = 0;
      for (
        let node: HTMLElement | null = el;
        node;
        node = node.offsetParent as HTMLElement | null
      )
        top += node.offsetTop;
      return top;
    };
    const tick = (t: number) => {
      if (w.__framesStop) return;
      const tops: Record<string, number | null> = {};
      for (const [name, spec] of Object.entries(probe.tops)) {
        const el = find(spec);
        tops[name] = el ? docTop(el) : null;
      }
      const present: Record<string, boolean> = {};
      for (const [name, selector] of Object.entries(probe.present))
        present[name] = document.querySelector(selector) !== null;
      w.__frames.push({ t, path: location.pathname, tops, present });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, probe);
}

export async function stopFrames(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __frames: Frame[];
      __framesStop?: boolean;
    };
    w.__framesStop = true;
    return w.__frames;
  });
}

/**
 * Every frame from the first in which `name` exists: where it was. A frame
 * set in which it never appears is an instrument that saw nothing, and is
 * FATAL rather than a vacuous "it never moved".
 */
export function positionsFrom(frames: readonly Frame[], name: string) {
  const first = frames.findIndex((f) => f.tops[name] != null);
  if (first < 0)
    throw new Error(
      `"${name}" never appeared in ${frames.length} frames — the probe saw nothing`,
    );
  return {
    first,
    tops: frames.slice(first).map((f) => f.tops[name]),
  };
}

/** A slow phone's CPU and network, through the browser's own throttles. */
export async function throttle(
  page: Page,
  { cpu, latencyMs, kbps }: { cpu: number; latencyMs: number; kbps: number },
): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: latencyMs,
    downloadThroughput: kbps * 1024,
    uploadThroughput: kbps * 1024,
  });
  return cdp;
}
