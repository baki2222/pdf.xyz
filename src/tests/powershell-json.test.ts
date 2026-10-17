// @vitest-environment node
/**
 * The PowerPoint instruments read PowerPoint's answers as JSON over Windows
 * PowerShell's stdout, and that stdout is not UTF-8 unless it is told to be.
 *
 * THE HISTORY: measured 2026-10-11 during the pdf-to-powerpoint gate.
 * `pnpm prove:pptx-opens --file` on a deck exported from a real user's
 * document said CANNOT CONCLUDE ("Bad control character in string literal in
 * JSON") about a deck PowerPoint had just opened and printed to PDF. Its
 * arrows had crossed the pipe as U+001A, and its en dashes as hyphens, without
 * a word.
 * The instrument had passed every run before, because its own subject is ASCII:
 * it verified the deck the AUTHOR built, never one a reader has.
 *
 * So: one helper owns the spawn and the encoding, every script that spawns
 * PowerShell is found by walking the tree (never by name) and must go through
 * it, and on Windows the helper is run for real beside a control that runs the
 * same script the old way and must lose the characters.
 *
 * The first fix set `[Console]::OutputEncoding` to UTF-8. Its own control
 * caught what was wrong with it: the control came back in code page 65001,
 * because the setter changes the console the script shares with its parent —
 * a terminal, in real use. That fix is gone; the last test here is why.
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  asciiJsonScript,
  parsePowerShellJson,
  runPowerShellJson,
} from "./powershell-json";

const ROOT = process.cwd();
const NL = String.fromCharCode(10);
const HELPER = path.join("src", "tests", "powershell-json.ts");
const THIS_TEST = path.join("src", "tests", "powershell-json.test.ts");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(c|m)?(t|j)sx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Source that starts a Windows PowerShell process. */
const SPAWNS_POWERSHELL = /["'`]powershell(\.exe)?["'`]/i;
/** Source that carries a PowerShell script answering in JSON. */
const PS_JSON_SCRIPT = /ConvertTo-Json/;

const SOURCES = ["scripts", "src"]
  .flatMap((d) => walk(path.join(ROOT, d)))
  .map((f) => path.relative(ROOT, f));

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("PowerShell's JSON reaches Node as UTF-8", () => {
  it("HEALTH: the walk sees the tree, and the detectors fire on a known positive", () => {
    // A walk that quietly lost a directory would make every check below pass.
    expect(SOURCES.length).toBeGreaterThan(500);
    expect(SOURCES).toContain(path.join("scripts", "prove-pptx-opens.ts"));
    expect(
      SPAWNS_POWERSHELL.test('execFileSync("powershell.exe", ["-File"])'),
    ).toBe(true);
    expect(SPAWNS_POWERSHELL.test('execFileSync("pwsh-like", [])')).toBe(false);
    expect(PS_JSON_SCRIPT.test("$r | ConvertTo-Json -Compress")).toBe(true);
  });

  it("only the helper starts PowerShell: no script parses its stdout on its own", () => {
    const spawners = SOURCES.filter(
      (f) => f !== THIS_TEST && SPAWNS_POWERSHELL.test(read(f)),
    );
    expect(spawners).toEqual([HELPER]);
  });

  it("every script that answers in JSON imports the helper", () => {
    const scripts = SOURCES.filter(
      (f) => f !== HELPER && f !== THIS_TEST && PS_JSON_SCRIPT.test(read(f)),
    );
    // Bounded both ways: an empty set is vacuous, and a large one means the
    // detector has started matching something other than embedded scripts.
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    expect(scripts.length).toBeLessThanOrEqual(10);
    const without = scripts.filter(
      (f) =>
        !/import\s*\{[^}]*\brunPowerShellJson\b[^}]*\}\s*from\s*["']@\/tests\/powershell-json["']/.test(
          read(f),
        ),
    );
    expect(without).toEqual([]);
  });

  it("keeps a param block first, as PowerShell requires, and wraps the rest", () => {
    const wrapped = asciiJsonScript(
      [
        "",
        "param([string]$A, [string]$B)",
        "$x = 1",
        "$x | ConvertTo-Json",
      ].join(NL),
    ).split(NL);
    expect(wrapped[1]).toBe("param([string]$A, [string]$B)");
    expect(wrapped[2]).toBe("$__pdfxyzJson = & {");
    expect(wrapped.slice(3, 5)).toEqual(["$x = 1", "$x | ConvertTo-Json"]);
    expect(wrapped.at(-1)?.startsWith("[regex]::Replace($__pdfxyzJson, ")).toBe(
      true,
    );
    expect(asciiJsonScript("$x = 1").split(NL)[0]).toBe("$__pdfxyzJson = & {");
    expect(() =>
      asciiJsonScript(["param(", "  [string]$A", ")", "$x = 1"].join(NL)),
    ).toThrow(/one line/);
  });

  it("names a legacy code page instead of reporting a JSON position", () => {
    expect(() =>
      parsePowerShellJson(`noise {"t":"a${String.fromCharCode(0x1a)}b"}`),
    ).toThrow(/legacy code page/);
    // A JSON escape, spelled with char codes so no tool on the way can turn
    // it into the character it names.
    const escaped = `{"t":"${String.fromCharCode(0x5c)}u2192"}`;
    expect(
      parsePowerShellJson<{ t: string }>(`WARNING: x${NL}${escaped}`).t,
    ).toBe(String.fromCharCode(0x2192));
  });
});

const WINDOWS = process.platform === "win32";
const windows = describe.skipIf(!WINDOWS);

windows(
  WINDOWS
    ? "PowerShell's JSON through a real Windows PowerShell"
    : "PowerShell's JSON through a real Windows PowerShell (SKIPPED: not Windows)",
  () => {
    // An arrow (what the user's deck lost), an en dash (what it silently
    // flattened) and a Bengali letter (no legacy code page has one).
    const WANT = "a" + String.fromCharCode(0x2192, 0x2013, 0x0985);
    const SCRIPT = [
      "param([string]$Lead)",
      "$t = $Lead + [string][char]0x2192 + [string][char]0x2013 + [string][char]0x0985",
      "@{ t = $t; cp = [Console]::OutputEncoding.CodePage } | ConvertTo-Json -Compress",
    ].join(NL);

    function rawRun(file: string, args: string[] = ["-Lead", "a"]): string {
      return execFileSync(
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
        { encoding: "utf8", timeout: 60_000 },
      );
    }
    /** The shared console's output code page, read by a raw PowerShell. */
    function codePage(dir: string): number {
      const file = path.join(dir, "cp-read.ps1");
      writeFileSync(file, "[Console]::OutputEncoding.CodePage", "utf8");
      const cp = Number(rawRun(file, []).trim());
      expect(Number.isInteger(cp)).toBe(true);
      return cp;
    }
    /** Set it: the very side effect the helper must not have. */
    function setCodePage(dir: string, cp: number): void {
      const file = path.join(dir, "cp-set.ps1");
      writeFileSync(
        file,
        [
          "param([int]$Cp)",
          "[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding($Cp)",
        ].join(NL),
        "utf8",
      );
      rawRun(file, ["-Cp", String(cp)]);
    }
    /**
     * Run `fn` with the console on code page 437, whatever it was before (an
     * earlier test, or a defect in the helper, may have left it on 65001),
     * and put the original back after. Without this the control is blind in
     * exactly the run that needs it: measured, a helper that set the console
     * to UTF-8 left 65001 behind, and the next two tests read that as "this
     * machine is UTF-8 already" and passed.
     */
    function onLegacyConsole(fn: (dir: string) => void): void {
      const dir = mkdtempSync(path.join(os.tmpdir(), "ps-json-"));
      const original = codePage(dir);
      try {
        setCodePage(dir, 437);
        expect(codePage(dir)).toBe(437);
        fn(dir);
      } finally {
        setCodePage(dir, original);
      }
    }

    it("the helper carries every character across", () => {
      onLegacyConsole((dir) => {
        const got = runPowerShellJson<{ t: string; cp: number }>(
          SCRIPT,
          ["-Lead", "a"],
          { dir, name: "probe.ps1", timeout: 60_000 },
        );
        expect(got.t).toBe(WANT);
      });
    }, 90_000);

    it("POSITIVE CONTROL: the same script without the helper loses them", () => {
      onLegacyConsole((dir) => {
        const file = path.join(dir, "control.ps1");
        writeFileSync(file, SCRIPT, "utf8");
        const out = rawRun(file);
        expect(out).toContain('"cp":437');
        expect(out).not.toContain(WANT);
      });
    }, 90_000);

    it("leaves the console's code page as it found it", () => {
      onLegacyConsole((dir) => {
        runPowerShellJson(SCRIPT, ["-Lead", "a"], {
          dir,
          name: "probe.ps1",
          timeout: 60_000,
        });
        expect(codePage(dir)).toBe(437);
      });
    }, 90_000);
  },
);
