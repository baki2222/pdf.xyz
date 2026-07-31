/**
 * Quote one argument for the shell that will actually parse it.
 *
 * Anything handed to a tool that runs a command *string* (rather than an argv
 * array) goes through a different shell per platform: `/bin/sh` on POSIX,
 * `cmd.exe` on Windows. The two do not agree on what a quote is. `cmd.exe` does
 * not treat `'` as quoting at all, so a POSIX-quoted path with a space in it —
 * `'C:\Program Files\nodejs\node.exe'` — is split straight back into separate
 * tokens and the spawn fails before the real command ever starts.
 *
 * Kept in one place because it is asserted from tests as well as used at
 * runtime: when the rule lived in both, changing it in one left the other
 * quietly asserting the old behaviour on the platform CI does not run.
 */
export function shellQuote(value: string): string {
  return process.platform === "win32"
    ? `"${value.replace(/"/g, '""')}"`
    : `'${value.replace(/'/g, `'\\''`)}'`;
}
