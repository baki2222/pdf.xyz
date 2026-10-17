import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Run a Windows PowerShell script whose output is ONE `ConvertTo-Json`
 * object, and parse that object. The two PowerPoint instruments
 * (`scripts/prove-pptx-opens.ts`, `scripts/measure-pptx-fidelity.ts`) go
 * through here, and `powershell-json.test.ts` holds every script that spawns
 * PowerShell to it.
 *
 * WHY: Windows PowerShell 5.1 writes to a pipe in the console's code page, not
 * UTF-8. Every character that code page lacks reaches Node as a substitute —
 * U+001A, which `JSON.parse` refuses as a raw control character, or a silent
 * lookalike. Measured 2026-10-11 on a real user's document exported by the
 * faithful engine: `prove:pptx-opens --file` said CANNOT CONCLUDE about a deck
 * PowerPoint had opened fine, because its arrows (U+2192) arrived as U+001A,
 * and its en dashes, silently, as hyphens. The instrument's own subject is
 * ASCII, so it had never met one.
 *
 * HOW, and why not the obvious fix: setting `[Console]::OutputEncoding` to
 * UTF-8 does work, but it calls SetConsoleOutputCP on the console the script
 * SHARES with whoever started it — measured: the next PowerShell started from
 * the same Node process came up in code page 65001. Run from a terminal, that
 * would leave the user's terminal changed. So the script's output is made
 * pure ASCII instead: every non-ASCII UTF-16 unit becomes a JSON `\uXXXX`
 * escape, which `JSON.parse` turns back into the same character, under any
 * code page, changing nothing outside the script.
 */
const ASCII_JSON_TAIL = [
  "} | Out-String -Width 2147483647",
  "[regex]::Replace($__pdfxyzJson, '[^\\x00-\\x7F]', { param($m) '\\u{0:x4}' -f [int][char]$m.Value })",
].join("\n");

/**
 * `script`, with its body run in a script block whose output is collected and
 * re-emitted as ASCII. PowerShell requires `param(...)` to come first, so a
 * leading one-line param block stays outside; its parameters are visible to
 * the body as before.
 */
export function asciiJsonScript(script: string): string {
  const lines = script.split("\n");
  const at = lines.findIndex((l) => l.trim() !== "");
  let head: string[] = [];
  let body = lines;
  if (at >= 0 && /^\s*param\s*\(/i.test(lines[at]!)) {
    // A param block that closes on its own line is the only shape these
    // scripts use; anything else is refused rather than guessed at.
    if (!/\)\s*$/.test(lines[at]!))
      throw new Error("asciiJsonScript: param(...) must fit on one line");
    head = lines.slice(0, at + 1);
    body = lines.slice(at + 1);
  }
  return [...head, "$__pdfxyzJson = & {", ...body, ASCII_JSON_TAIL].join("\n");
}

/** Parse the JSON object at the end of PowerShell's stdout. */
export function parsePowerShellJson<T>(stdout: string): T {
  const json = stdout.slice(stdout.indexOf("{"));
  // U+001A is what an unencodable character becomes on the way out. Name it,
  // rather than leave JSON.parse to report a position in a document.
  if (json.includes("\u001a"))
    throw new Error(
      "PowerShell's output reached Node through a legacy code page (U+001A substitutes); the script was not run through asciiJsonScript",
    );
  return JSON.parse(json) as T;
}

/**
 * Write `script` (made to answer in ASCII) to `dir/name`, run it with Windows
 * PowerShell and `args`, and parse its JSON.
 */
export function runPowerShellJson<T>(
  script: string,
  args: string[],
  options: { dir: string; name: string; timeout: number },
): T {
  const file = path.join(options.dir, options.name);
  writeFileSync(file, asciiJsonScript(script), "utf8");
  const stdout = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      file,
      ...args,
    ],
    { encoding: "utf8", timeout: options.timeout },
  );
  return parsePowerShellJson<T>(stdout);
}
