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
 * NOT IN ANY PAGE'S FIRST LOAD. Free of React and of the catalogue, and
 * fetched only when a page first needs it: by the drop layer on idle (or
 * with the first file), and by a target's registration on mount
 * (`usePageTarget`, which imports it). Nothing a page renders imports it
 * statically — the sheet reads a drag through `./drag` — so the layer and
 * every target reach the one copy through the same `import()`, and a
 * registration made on mount is in the stack before any delivery the layer
 * routes through that import (its callback was attached first). Was a static
 * import of every drop sheet, the hook and the guide desk: 1.2 KB raw in the
 * first load of every page with a drop target (WP-07 review, 2026-10-10).
 *
 * Module-level state (a stack and a set of listeners, never a single slot),
 * so tests start from {@link resetPageTargetsForTests} — vitest shares one
 * module cache.
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
  | { readonly kind: "refused"; readonly name: string }
  /**
   * The page is about a tool that takes the files but cannot be handed them
   * (it has no in-browser runner — a guide to PDF to Word): the fallback
   * offers that tool FIRST, as a row that says the files are added there,
   * and the tools that open them after it.
   */
  | { readonly kind: "stage"; readonly slug: string; readonly name: string };

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

/**
 * Register whatever `latest` holds at each question — a React surface's
 * target, re-rendered with new props (a name, a busy state) but registered
 * ONCE, so a re-render never moves it above a target that mounted after it
 * (the stack's last registration wins). Asked through `usePageTarget`.
 */
export function registerLatest(latest: {
  readonly current: PageTarget | null;
}): () => void {
  const now = () => latest.current;
  return registerPageTarget({
    get name() {
      return now()?.name ?? "";
    },
    get verb() {
      return now()?.verb ?? "open";
    },
    get current() {
      return now()?.current;
    },
    canReceive: () => now()?.canReceive() ?? false,
    takes: (file) => now()?.takes(file) ?? false,
    receive: (files, via) => now()?.receive(files, via),
    // Present only while the target has a picker of its own, so "Open
    // files" falls back to the page's when it has none.
    get pick() {
      return now()?.pick ? () => now()?.pick?.() : undefined;
    },
    arm: (on) => now()?.arm(on),
    element: () => now()?.element() ?? null,
  });
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

/** Empty every stack and listener (vitest shares one module cache). */
export function resetPageTargetsForTests(): void {
  targets.length = 0;
  fallbacks.length = 0;
  waiting.length = 0;
  listeners.clear();
}
