/**
 * Where a file lands when it is dropped or pasted anywhere on a page, and
 * what "Open files" opens.
 *
 * Every page has at most one TARGET — the surface a file arriving on the
 * page belongs to: the home desk, a tool's drop zone (or, with a document
 * already open in its editor, the editor, which the file replaces), the
 * workspace's drop panel, a guide's desk, an open ticket dialog. Surfaces
 * register while they are mounted, and the LAST registration is the
 * page's: an editor that opens over its drop zone, or a dialog over the
 * page, takes over until it leaves, and the one before is the target again.
 *
 * A page with no target, a target at work on a file, or a target that
 * opens none of the files arriving, hands them to the FALLBACK instead —
 * the drop layer's ticket dialog, which says what does open them. So no
 * file dropped on any page is opened by the browser in the tab, and none
 * lands where it cannot be used.
 *
 * Free of React and of the catalogue: the drop layer that routes through
 * this is in every page's first load. Module-level state (a stack and a set
 * of listeners, never a single slot), so tests start from
 * {@link resetPageTargetsForTests} — vitest shares one module cache.
 */
import type { TicketVia } from "./ticket";

/** How files arrived: picked, dropped, pasted, picked before hydration, or from the header. */
export type DropVia = TicketVia;

/** What a release does there — the verb the drop layer's veil says. */
export type TargetVerb = "add" | "open" | "replace" | "check";

/** A file as a drag describes it before release: a name and a type, often blank. */
export interface FileKind {
  readonly name: string;
  readonly type: string;
}

export interface PageTarget {
  /** Who receives, as the veil names it: "Merge PDF", "the workspace". */
  readonly name: string;
  readonly verb: TargetVerb;
  /** `replace`: the file a release replaces, by name. */
  readonly current?: string;
  /** False while it is at work on a file: nothing may land mid-run. */
  canReceive(): boolean;
  /** Whether it opens this kind of file — read before the bytes are. */
  takes(file: FileKind): boolean;
  /** Files that landed on the page, handled as a drop on the target itself. */
  receive(files: File[], via: DropVia): void;
  /** Its own picker, for "Open files"; without one the page's is used. */
  pick?(): void;
  /** Drawn as where a held file will land, or not. */
  arm(on: boolean): void;
  /** Its box on the screen, for the veil to leave clear. */
  element(): HTMLElement | null;
}

/** Why files went to the fallback rather than the page's target. */
export type Unrouted =
  | { readonly kind: "none" }
  | { readonly kind: "busy"; readonly name: string }
  | { readonly kind: "refused"; readonly name: string };

export interface PageFallback {
  receive(files: File[], via: DropVia, why: Unrouted): void;
  /** The page's own picker, whose files are routed like a drop. */
  pick(): void;
}

export type Route =
  | { readonly to: "target"; readonly target: PageTarget }
  | { readonly to: "fallback"; readonly why: Unrouted };

interface Entry<T> {
  readonly value: T;
}

const targets: Entry<PageTarget>[] = [];
/** Files for the fallback before one registered: handed over when it does. */
const waiting: { files: File[]; via: DropVia; why: Unrouted }[] = [];
const fallbacks: Entry<PageFallback>[] = [];
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of [...listeners]) listener();
};

function push<T>(
  stack: Entry<T>[],
  value: T,
  changed: () => void = () => {},
): () => void {
  // An object per registration, so registering the same target twice is two
  // registrations, each removed by its own call.
  const entry: Entry<T> = { value };
  stack.push(entry);
  changed();
  return () => {
    const at = stack.indexOf(entry);
    if (at < 0) return;
    stack.splice(at, 1);
    changed();
  };
}

const top = <T>(stack: readonly Entry<T>[]): T | null =>
  stack.length > 0 ? stack[stack.length - 1]!.value : null;

/** Make `target` the page's while it is registered; returns the unregister. */
export function registerPageTarget(target: PageTarget): () => void {
  return push(targets, target, notify);
}

/** The page's target: the last one registered, or null. */
export function activePageTarget(): PageTarget | null {
  return top(targets);
}

/** Hear every target registration and departure; returns the unsubscribe. */
export function subscribeTargets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Where files go that the page's target does not take (the drop layer). */
export function registerFallback(fallback: PageFallback): () => void {
  const off = push(fallbacks, fallback);
  // Files that landed before the page's fallback was here are its first:
  // the drop layer fetches it on idle, and a file can be quicker.
  for (const w of waiting.splice(0)) fallback.receive(w.files, w.via, w.why);
  return off;
}

/**
 * Where files of these kinds would go now. Asked twice per drag: with what
 * the drag describes (often only types, sometimes nothing — a file with no
 * name and no type is not held against the target), for the veil; and with
 * the files themselves, on release.
 */
export function routeFor(files: readonly FileKind[]): Route {
  const target = activePageTarget();
  if (!target) return { to: "fallback", why: { kind: "none" } };
  if (!target.canReceive())
    return { to: "fallback", why: { kind: "busy", name: target.name } };
  if (files.length > 0 && !files.some((file) => target.takes(file)))
    return { to: "fallback", why: { kind: "refused", name: target.name } };
  return { to: "target", target };
}

/**
 * Hand files that arrived on the page to wherever they belong. The target
 * receives ALL of them when it takes any — as a drop on it would, so its
 * own refusal says which it kept; otherwise the fallback, told why — or,
 * when the fallback has not registered yet, they wait for it.
 */
export function deliverFiles(
  files: File[],
  via: DropVia,
): "target" | "fallback" | "waiting" | "nowhere" {
  if (files.length === 0) return "nowhere";
  const route = routeFor(files);
  if (route.to === "target") {
    route.target.receive(files, via);
    return "target";
  }
  return deliverToFallback(files, via, route.why);
}

/**
 * Straight to the fallback, for a surface that has already decided the
 * files are not its own (a guide's desk whose tool opens none of them).
 */
export function deliverToFallback(
  files: File[],
  via: DropVia,
  why: Unrouted,
): "fallback" | "waiting" | "nowhere" {
  if (files.length === 0) return "nowhere";
  const fallback = top(fallbacks);
  if (!fallback) {
    waiting.push({ files, via, why });
    return "waiting";
  }
  fallback.receive(files, via, why);
  return "fallback";
}

/**
 * "Open files": the target's own picker when it has one and can take a
 * file now; otherwise the page's, whose files are routed like a drop.
 */
export function requestFilePick(): "target" | "fallback" | "nowhere" {
  const target = activePageTarget();
  if (target?.pick && target.canReceive()) {
    target.pick();
    return "target";
  }
  const fallback = top(fallbacks);
  if (!fallback) return "nowhere";
  fallback.pick();
  return "fallback";
}

/**
 * Does this drag carry files (not text, not a link)? Here, not beside the
 * drop sheet: the drop layer asks it on every page, and the sheet is not on
 * every page. A browser lists
 * "Files" among the drag's types from the moment it enters; a drop event
 * built by hand (every test that fires one) may list the files alone.
 */
export function carriesFiles(event: {
  dataTransfer: Pick<DataTransfer, "types" | "files"> | null;
}): boolean {
  const transfer = event.dataTransfer;
  if (!transfer) return false;
  if (transfer.types && Array.from(transfer.types).includes("Files"))
    return true;
  return (transfer.files?.length ?? 0) > 0;
}

/** Empty every stack and listener (vitest shares one module cache). */
export function resetPageTargetsForTests(): void {
  targets.length = 0;
  fallbacks.length = 0;
  waiting.length = 0;
  listeners.clear();
}
