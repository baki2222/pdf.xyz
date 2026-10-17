/**
 * A drop target's `accept`, read for files that arrived without a picker.
 *
 * A module of its own, not the registry's (`./page-target`): the drop
 * layer that routes through the registry is in every page's first load, and
 * this is needed only by the surfaces that ARE targets — the drop sheet and
 * an open editor.
 */
import type { FileKind } from "./page-target";

/**
 * What an `accept` attribute admits, read the way a browser's picker reads
 * it — a MIME type, a `type/*` family, or a `.ext` name — for a file that
 * arrived some other way (a drop, a paste), which nothing filtered.
 *
 * Generous where it cannot tell: an empty `accept` takes anything; a file
 * with neither name nor type (a drag the browser does not describe) is not
 * held against it; and a file with no type, judged by an accept that names
 * no extensions, is let through for the target to decide, as a drop on it
 * would have been.
 */
export function takesByAccept(accept: string): (file: FileKind) => boolean {
  const tokens = accept
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const names = tokens.filter((token) => token.startsWith("."));
  const types = tokens.filter((token) => !token.startsWith("."));
  return (file) => {
    if (tokens.length === 0) return true;
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    if (!type && !name) return true;
    if (
      type &&
      types.some((t) =>
        t.endsWith("/*") ? type.startsWith(t.slice(0, -1)) : type === t,
      )
    )
      return true;
    if (name && names.some((ext) => name.endsWith(ext))) return true;
    return !type && names.length === 0;
  };
}
