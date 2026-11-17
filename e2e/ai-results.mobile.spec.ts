import { test, expect } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import {
  askThreeFills,
  axeViolations,
  mockChatWorker,
} from "./chat-citations-fixture";
import {
  clipboardText,
  expectNoSidewaysScroll,
  grantClipboard,
  nextDownload,
} from "./ai-results-fixture";

/**
 * Chat with PDF's Copy answer, Copy conversation and Markdown download on a
 * 375px touch phone (competitor audit #16, 2026-11-17): the buttons are full
 * width and reachable by a tap, nothing scrolls sideways, and what they carry
 * is read back where it lands. The desktop run is in ai-results.spec.ts.
 */

test.use({ viewport: { width: 375, height: 812 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await grantClipboard(page);
});

const LF = String.fromCharCode(10);

test("a tap copies the answer and the conversation, and saves the .md", async ({
  page,
}) => {
  const question = "Where is the rent?";
  const answer = "The rent is on page three [p.3].";
  await mockChatWorker(page, question, answer, [3]);
  await askThreeFills(page, question);
  const copy = page.getByRole("button", { name: "Copy answer" });
  await expect(copy).toBeVisible({ timeout: 20_000 });

  await copy.tap();
  await expect.poll(() => clipboardText(page)).toBe(answer);
  const conversation = page.getByRole("button", { name: "Copy conversation" });
  await conversation.tap();
  await expect
    .poll(async () =>
      (await clipboardText(page)).split(String.fromCharCode(13)).join(""),
    )
    .toBe(
      [`Q: ${question}`, "", `A: ${answer}`, "Cited pages: [p.3]"].join(LF),
    );
  const md = await nextDownload(page, () =>
    page.getByRole("button", { name: "Download conversation (.md)" }).tap(),
  );
  // The mocked package is named answer.zip (a real one is <stem>-answer.zip,
  // which the unit tests hold to <stem>-conversation.md).
  expect(md.name).toBe("answer-conversation.md");
  expect(md.bytes.toString("utf8")).toContain(
    `${answer}${LF}${LF}Cited pages: [p.3]`,
  );

  // Each button is a comfortable tap target (40px or taller), inside the viewport.
  for (const button of [copy, conversation]) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }
  await expectNoSidewaysScroll(page);
  expect(await axeViolations(page)).toEqual([]);
});
