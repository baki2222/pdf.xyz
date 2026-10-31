/**
 * The file-size presets every "fit under N KB" control offers (2026-10-31):
 * Compress PDF's Target size and JPG / PNG to PDF's Max file size read this
 * ONE list, so the two panels cannot drift apart.
 *
 * KB is 1,024 bytes, the unit every size on the site is printed in
 * (`formatBytes`), so "under your 200 KB limit" compares like with like.
 * Some upload portals count 1 KB as 1,000 bytes; the guides say so.
 */
export const KB = 1024;
export const MB = 1024 * KB;

/** A size as the panels name it: whole MB when it is one, else KB. */
export function sizeLabel(bytes: number): string {
  if (bytes % MB === 0) return `${bytes / MB} MB`;
  return `${Math.round(bytes / KB)} KB`;
}

/** The sizes application portals ask for most. */
export const SIZE_PRESETS: readonly { bytes: number; label: string }[] = [
  100 * KB,
  200 * KB,
  500 * KB,
  MB,
].map((bytes) => ({ bytes, label: sizeLabel(bytes) }));
