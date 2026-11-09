// @vitest-environment node
/**
 * OCR inside Translate (audit translate-pdf#3) is admitted by `POST /api/jobs`
 * only while the RUNNING worker proves it on a fresh heartbeat — and the
 * refusal comes before the allowance is charged.
 *
 * Why the route, and not only the panel: the worker image is published
 * separately from the web tier (CLAUDE.md rule 5). An image built before the
 * feature IGNORES the OCR request (its translate parser never heard of it)
 * and refuses the scan as having no text — after the allowance was taken. So
 * an OCR request reaching that worker is money spent on a job that cannot
 * work.
 *
 * Driven through the real route on the wired deployment (`@/tests/wired-job-route`):
 * the real adapter queues into an in-memory Redis that also holds the
 * heartbeat the route reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { PDF_TO_WORD_RTL_REFUSAL } from "@/lib/jobs/ocr";
import {
  TRANSLATE_OCR_NOT_RUNNING_MESSAGE,
  translateOcrMissingPacksMessage,
} from "@/lib/jobs/translate-ocr";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import {
  enforceAiCharacterAllowance,
  resetRateLimitGuardForTests,
} from "@/lib/ratelimit/guard";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import {
  buildHeartbeat,
  emptyCapabilities,
  serializeHeartbeat,
  type HeartbeatCapabilities,
} from "@/lib/workers/heartbeat";
import {
  publishHeartbeat,
  unwireJobRoute,
  wireJobRoute,
  type WiredJobRoute,
} from "@/tests/wired-job-route";
import { POST } from "./route";

const CLIENT_IP = "203.0.113.31";
let route: WiredJobRoute;

function beat(
  caps: Partial<HeartbeatCapabilities>,
  at = Date.now(),
  drop?: keyof HeartbeatCapabilities,
): string {
  const record = JSON.parse(
    serializeHeartbeat(
      buildHeartbeat({
        mode: "loop",
        capabilities: { ...emptyCapabilities(), ...caps },
        at,
      }),
    ),
  ) as { capabilities: Record<string, unknown> };
  if (drop) delete record.capabilities[drop];
  return JSON.stringify(record);
}

function submit(options: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request("http://localhost/api/jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": CLIENT_IP,
      },
      body: JSON.stringify({
        tool: "translate-pdf",
        inputs: ["f_translateocr0001"],
        options: { targetLanguage: "en", ...options },
      }),
    }),
  );
}

/** Is the whole day's allowance still there? (A refusal spends nothing.) */
async function wholeDayLeft(): Promise<boolean> {
  const decision = await enforceAiCharacterAllowance(
    AI_CHARACTER_ALLOWANCE,
    new Request("http://localhost/api/jobs", {
      method: "POST",
      headers: { "x-forwarded-for": CLIENT_IP },
    }),
  );
  return decision.allowed;
}

beforeEach(() => {
  resetRateLimitGuardForTests();
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  route = wireJobRoute();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  unwireJobRoute();
});

const OCR = { ocr: true, languages: ["deu"] };

describe("POST /api/jobs admits OCR inside Translate only on the running worker's proof", () => {
  it("a fresh heartbeat proving translateOcr AND ocr: the job is created", async () => {
    await publishHeartbeat(
      route,
      beat({ translateOcr: true, ocr: true, ocrLanguages: ["eng", "deu"] }),
    );
    const response = await submit(OCR);
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    expect(route.heartbeatReads()).toBeGreaterThan(0);
  });

  // A LANGUAGE THE RUNNING WORKER LACKS (review finding, money lens). OCR's
  // own installed-pack check on the worker refuses it before any work — after
  // the route had reserved a third of the day, which nothing gives back. The
  // packs are on the same fresh heartbeat the route already reads.
  it("a pack the running worker does not report: 422 naming it, BEFORE the allowance is charged", async () => {
    await publishHeartbeat(
      route,
      beat({ translateOcr: true, ocr: true, ocrLanguages: ["eng"] }),
    );
    const response = await submit({ ocr: true, languages: ["eng", "deu"] });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      translateOcrMissingPacksMessage(["German"]),
    );
    expect(body.error.message).toContain("German");
    expect(body.error.message).not.toContain("English");
    expect(await wholeDayLeft(), "the refusal charged the allowance").toBe(
      true,
    );
  });

  it("an image whose OCR reports NO packs admits no OCR language", async () => {
    // `probeInstalledOcrLanguages` always returns an array, so on an image new
    // enough to publish translateOcr an empty list means "none installed" —
    // the worker's own check then refuses every language.
    await publishHeartbeat(route, beat({ translateOcr: true, ocr: true }));
    const response = await submit(OCR);
    expect(response.status).toBe(422);
    expect(await wholeDayLeft()).toBe(true);
  });

  it("control: the default language is admitted when the worker reports it", async () => {
    await publishHeartbeat(
      route,
      beat({ translateOcr: true, ocr: true, ocrLanguages: ["eng"] }),
    );
    const response = await submit({ ocr: true });
    expect(response.status, await response.clone().text()).toBeLessThan(300);
  });

  it.each([
    ["no heartbeat at all", null],
    ["an image that never published translateOcr", "drop"],
    ["translateOcr without OCR itself", "no-ocr"],
    ["a stale heartbeat", "stale"],
  ] as const)(
    "%s: refused BEFORE the allowance is charged",
    async (_name, shape) => {
      if (shape === "drop")
        await publishHeartbeat(
          route,
          beat({ translateOcr: true, ocr: true }, Date.now(), "translateOcr"),
        );
      else if (shape === "no-ocr")
        await publishHeartbeat(route, beat({ translateOcr: true, ocr: false }));
      else if (shape === "stale")
        await publishHeartbeat(
          route,
          beat({ translateOcr: true, ocr: true }, Date.now() - 24 * 3_600_000),
        );
      const response = await submit(OCR);
      expect(response.status).toBe(501);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toBe(TRANSLATE_OCR_NOT_RUNNING_MESSAGE);
      expect(await wholeDayLeft(), "the refusal charged the allowance").toBe(
        true,
      );
    },
  );

  it("control: a translate job WITHOUT an OCR request is untouched by the check", async () => {
    // No heartbeat, which would refuse an OCR request.
    const response = await submit({});
    expect(response.status, await response.clone().text()).toBeLessThan(300);
  });

  it("a right-to-left OCR language is refused by the option parser, before the heartbeat or the charge", async () => {
    await publishHeartbeat(
      route,
      beat({ translateOcr: true, ocr: true, ocrLanguages: ["eng", "heb"] }),
    );
    const response = await submit({ ocr: true, languages: ["heb"] });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe(PDF_TO_WORD_RTL_REFUSAL);
    expect(await wholeDayLeft()).toBe(true);
  });
});
