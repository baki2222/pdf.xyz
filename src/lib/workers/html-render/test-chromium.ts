import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * A Chromium for the real-renderer tests, or null: `PDFXYZ_TEST_CHROMIUM_BIN`,
 * Playwright's cache, or one on PATH (GitHub's ubuntu runners ship
 * google-chrome). Callers `describe.skipIf(!bin)`, so a machine without one
 * reports the suite SKIPPED — visibly — never a pass it did not run.
 *
 * `onPath` is passed in (native.ts's `resolveOnPath`) rather than imported,
 * so this helper stays outside the Node-only worker closure that
 * `src/deploy/import-boundary.test.ts` pins.
 */
export function findChromium(
  onPath: (binary: string) => boolean,
): string | null {
  const pinned = process.env.PDFXYZ_TEST_CHROMIUM_BIN;
  if (pinned && existsSync(pinned)) return pinned;
  const caches = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "ms-playwright"),
    path.join(homedir(), ".cache", "ms-playwright"),
    path.join(homedir(), "Library", "Caches", "ms-playwright"),
  ].filter((d): d is string => !!d && existsSync(d));
  for (const cache of caches) {
    for (const dir of readdirSync(cache)
      .filter((d) => d.startsWith("chromium_headless_shell-"))
      .sort()
      .reverse()) {
      for (const sub of readdirSync(path.join(cache, dir))) {
        for (const exe of [
          "chrome-headless-shell.exe",
          "chrome-headless-shell",
        ]) {
          const candidate = path.join(cache, dir, sub, exe);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  }
  for (const name of [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
  ])
    if (onPath(name)) return name;
  return null;
}
