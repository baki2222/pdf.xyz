import { expect, type Page } from "@playwright/test";
import { uploadFiles, writeTempPdf } from "./helpers";
import {
  recordedShifts,
  startFrames,
  stopFrames,
  type Frame,
  type Shift,
} from "./frames";
import { shiftOfOurOwn } from "./stage-hold-probe";

/**
 * A tool page ARRIVED AT with files (a hand-off), read as a visit pays for
 * it: every `layout-shift` entry outside an input's window, and where the
 * runner's stage is in every painted frame of the page the files land on
 * (`./frames`, document positions, so a scroll is not a move).
 *
 * Two ways in, both of which reach the page long after any input window:
 *  - CONTINUE WITH from a result, on a line slowed by CDP (`latencyMs`), so
 *    the arriving page draws more than 500 ms after the click. On loopback
 *    it draws inside the click's window, and every shift is forgiven — the
 *    reason no test saw the job row's move before (PR #180 review);
 *  - a guide's DESK, a file released on the guide (a CDP drag of a real
 *    file): a drop opens no input window at all.
 *
 * Shared by `handoff-arrival.spec.ts` (desktop) and
 * `handoff-arrival.mobile.spec.ts` (a 390 x 844 touch phone).
 */

export const ARRIVAL_CLS_CEILING = 0.001;

const STAGE = { stage: { selector: "[data-runner-stage]" } } as const;
const PRESENT = {
  slot: "[data-ticket-rail-slot]",
  rail: "[data-ticket-rail]",
  bringing: '[data-runner-stage] [role="status"]',
  receipt: "[data-runner-stage] [data-receipt]",
} as const;

export interface Arrival {
  /** Every counted shift from the gesture on, summed. */
  readonly cls: number;
  readonly listed: string;
  /** The instrument's own shift, before the gesture: it is listening. */
  readonly own: readonly Shift[];
  /** The painted frames on the page the files arrived at. */
  readonly frames: readonly Frame[];
  /** When the gesture was made, and the first frame on the arriving page. */
  readonly at: number;
  readonly firstArrived: number;
}

function read(
  shifts: readonly Shift[],
  frames: readonly Frame[],
  at: number,
  ownAt: number,
  path: string,
): Arrival {
  const counted = shifts.filter((s) => !s.input && s.t >= at);
  const arrived = frames.filter((f) => f.path === path);
  return {
    cls: counted.reduce((sum, s) => sum + s.value, 0),
    listed:
      counted
        .map(
          (s) =>
            `${s.value.toFixed(4)} @${Math.round(s.t - at)}ms [${s.sources.join(" | ")}]`,
        )
        .join(" + ") || "none",
    own: shifts.filter((s) => s.t >= ownAt && s.t < at),
    frames: arrived,
    at,
    firstArrived: arrived[0]?.t ?? Number.NaN,
  };
}

/** Merge two PDFs, then Continue with Compress PDF on a slowed line. */
export async function continueHop(
  page: Page,
  { latencyMs }: { latencyMs: number },
): Promise<Arrival> {
  await page.goto("/tools/merge-pdf");
  await uploadFiles(page, [
    await writeTempPdf("alpha.pdf", 3),
    await writeTempPdf("beta.pdf", 2),
  ]);
  await expect(page.getByText("beta.pdf")).toBeVisible();
  await page.getByRole("button", { name: /merge 2 pdfs/i }).click();
  const row = page
    .getByRole("group", { name: "Continue with" })
    .getByRole("link", { name: /compress pdf/i });
  await expect(row).toBeVisible();
  await page.waitForTimeout(500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: latencyMs,
    downloadThroughput: 200 * 1024,
    uploadThroughput: 100 * 1024,
  });
  await startFrames(page, { tops: STAGE, present: PRESENT });
  const ownAt = await shiftOfOurOwn(page);
  const at = await page.evaluate(() => performance.now());
  await row.click();
  await expect(page).toHaveURL(/\/tools\/compress-pdf$/, { timeout: 30_000 });
  await settled(page, RECEIPT);
  const shifts = await recordedShifts(page);
  const frames = await stopFrames(page);
  return read(shifts, frames, at, ownAt, "/tools/compress-pdf");
}

/** A file released on a guide's prose: its desk opens the tool with it. */
export async function guideDrop(
  page: Page,
  {
    guide,
    tool,
    done = RECEIPT,
  }: { guide: string; tool: string; done?: string },
): Promise<Arrival> {
  await page.goto(`/guides/${guide}`);
  await page
    .locator("html[data-drop-layer]")
    .waitFor({ state: "attached", timeout: 30_000 });
  await expect(
    page.locator("[data-guide-desk] [data-page-drop-target]"),
  ).toHaveCount(1, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const file = await writeTempPdf("arrive.pdf", 2);
  await startFrames(page, { tops: STAGE, present: PRESENT });
  const ownAt = await shiftOfOurOwn(page);
  // On the article's prose, away from the desk: the page's target takes it.
  const spot = await page.evaluate(() => {
    const p = [...document.querySelectorAll("main p")].find((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.top > 80 &&
        r.bottom < innerHeight - 40 &&
        !el.closest("[data-guide-desk]")
      );
    });
    const r = (p ?? document.querySelector("main")!).getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.top + 10) };
  });
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [file], dragOperationsMask: 1 };
  const at = await page.evaluate(() => performance.now());
  await cdp.send("Input.dispatchDragEvent", {
    type: "dragEnter",
    ...spot,
    data,
  });
  await cdp.send("Input.dispatchDragEvent", {
    type: "dragOver",
    ...spot,
    data,
  });
  await cdp.send("Input.dispatchDragEvent", { type: "drop", ...spot, data });
  await expect(page).toHaveURL(new RegExp(`/tools/${tool}$`), {
    timeout: 30_000,
  });
  await settled(page, done);
  const shifts = await recordedShifts(page);
  const frames = await stopFrames(page);
  return read(shifts, frames, at, ownAt, `/tools/${tool}`);
}

/** What the arriving runner draws last: a result's receipt (Compress PDF). */
export const RECEIPT = "[data-runner-stage] [data-receipt]";
/** ...or an editor's file header (Edit PDF), its pages drawing after it. */
export const FILE_HEADER = "[data-runner-stage] [data-file-header]";

/** The arriving runner has drawn `done`, and a moment more. */
async function settled(page: Page, done: string) {
  await expect(page.locator(done).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(done === RECEIPT ? 800 : 1500);
}

/** Every document position the stage was painted at on the arriving page. */
export function stageTops(a: Arrival): number[] {
  return [
    ...new Set(
      a.frames.map((f) => f.tops.stage).filter((t): t is number => t != null),
    ),
  ];
}

/**
 * The job row's slot as the code before 2026-10-17 drew it — open only once
 * the job's steps are drawn into it — for the CONTROL: a stylesheet in every
 * document of the page.
 *
 * AND OPENED A BEAT LATE (2026-10-21). By 507b6383 the steps reached the
 * arriving page in the frame the sampler starts in, so the stage moved
 * before its first sample: CLS saw the move (401 -> 433) but the frames saw
 * one position, and the control read "no move" — vacuous, not red. The slot
 * now opens 300 ms after the steps arrive (a script sets the attribute the
 * stylesheet waits for), so the sampler is running when the stage moves.
 * The defect is the same one — the row opening with the steps — only
 * timed so the instrument can be shown to see it.
 */
export async function slotOpensWithTheSteps(page: Page) {
  await page.addInitScript(() => {
    const add = () => {
      const style = document.createElement("style");
      style.dataset.probe = "";
      style.textContent =
        "[data-ticket-rail-slot]:not([data-probe-open]){display:none !important}";
      document.head.append(style);
      const open = () => {
        for (const slot of document.querySelectorAll(
          "[data-ticket-rail-slot]:not([data-probe-open])",
        ))
          if (slot.querySelector("[data-ticket-rail]"))
            setTimeout(() => slot.setAttribute("data-probe-open", ""), 300);
      };
      new MutationObserver(open).observe(document.documentElement, {
        subtree: true,
        childList: true,
      });
      open();
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  });
}
