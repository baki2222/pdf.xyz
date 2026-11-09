/**
 * The words a too-large file is refused in, and the megabyte figure they
 * state: ONE definition for the page's stated ceiling
 * (`toolFileCeilingMb`, `./file-ceilings`), its refusal
 * (`fileOverCeilingMessage`) and the worker panels' pick check
 * (`pickRefusal`, `@/lib/uploads/pick-check`).
 *
 * A leaf, on purpose (2026-11-09): the pick check is in every worker tool
 * page's first load and now receives the ceiling as a number from the
 * server, so it needs these words without `./file-ceilings` and the tables
 * behind it (every runner kind's ceiling, every worker engine's tool list).
 */

const MIB = 1024 * 1024;

/**
 * A ceiling in whole megabytes — the unit every surface states it in. Every
 * constant it is given is an exact multiple of a mebibyte today, so this
 * neither rounds a cap up (advertising bytes the gate refuses) nor down.
 */
export function ceilingMegabytes(bytes: number): number {
  return Math.round(bytes / MIB);
}

/** What a panel says when a picked file is over `toolName`'s ceiling. */
export function ceilingRefusal(toolName: string, bytes: number): string {
  return `This file is larger than ${ceilingMegabytes(bytes)} MB, the most ${toolName} accepts.`;
}
