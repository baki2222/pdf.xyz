// The child half of the hang runner's protocol (see ./bounded.ts): a child
// script prints exactly one `@@RESULT <json>` line when it settles.
//
// A module of its own so a child script never imports ./bounded, which
// spawns processes (`node:child_process`). The import-boundary guard closes
// over everything that statically imports a spawner, and child scripts are
// spawned, never spawners.
export const RESULT_PREFIX = "@@RESULT ";

/** Print the settled value from inside a child script. */
export function reportResult(value: unknown): void {
  console.log(`${RESULT_PREFIX}${JSON.stringify(value ?? null)}`);
}
