/**
 * What makes a DROP BOX take a file — a drop sheet, an open editor, the
 * chip of a chosen file: its drag states, its claim on a release, and its
 * place as the page's target. Attached to the box once the page's drop
 * runtime is here (`./page-target` binds it as `attachDropBox`, and
 * `useDropBox` in `@/components/upload/use-drop-box` asks for it as the box
 * mounts), never shipped with the page.
 *
 * WHY IT IS NOT THE BOXES' OWN CODE. A tool page's drop zone, its open
 * editor and its chosen file are each in that page's first load. As first
 * merged, each carried this itself: the sheet as React state and handlers
 * with the registration and the `accept` reader, the editor and the chip as
 * targets built in place — 2.4 KB gz on every tool page against the
 * redesign's 0.8 for the whole of WP-07 there (G.1; WP-07 re-review). The
 * boxes now render what they are made of; this arrives in the registry's
 * chunk, fetched by the drop layer on idle and by the first box as it
 * mounts — through the same `import()` as every registration, so the order
 * boxes registered in is the order they mounted in.
 *
 * BEFORE IT ARRIVES NOTHING IS LOST. A file released on a box that has no
 * engine yet is not claimed by it, so the drop layer takes it, and hands it
 * to the registry once that is here, with WHERE it was released — and by
 * then this engine is attached to the box (its `import()` was asked for
 * first, so its callback ran first). The registry gives a release on a box
 * to that box's {@link DropEngine.take}, which decides exactly as the box's
 * own drop listener would have: what it takes, it takes, and the rest is
 * routed like a release anywhere else. What is missing for that moment is
 * only the highlight.
 *
 * DOM, not React: the states are attributes the stylesheet reads
 * (`data-over`, `data-armed`, `data-drop-refuses`), set on the box, which
 * React renders without them and so never resets. The listeners are
 * native, on the box itself, so they run before the drop layer's on
 * `window` — which reads `defaultPrevented` (a box took the release) and
 * `data-drop-refuses` (a sheet does not take what is held) from them — and
 * a box inside another (Sign PDF's signature-image zone, inside its open
 * editor) hears a release before the box around it.
 */
import { takesByAccept } from "./accept-match";
import { carriesFiles, describeDrag } from "./drag";
import type { DropVia, FileKind, PageTarget, TargetVerb } from "./page-target";

/** How a box asks to be the page's drop target. */
export interface BoxTarget {
  /**
   * Who receives, as the page's veil names it: "Merge PDF", "the workspace".
   * Absent on a tool page's own boxes: the tool the page is, as the page
   * names it — `data-tool-name` around its runner and its panel — so no
   * box is told by hand, and none carries the name in its code.
   */
  readonly name?: string;
  readonly verb: TargetVerb;
  /** `replace`: the file a release replaces, by name. */
  readonly current?: string;
  /** Asked at the moment of each drop; false while its owner is at work. */
  readonly canReceive?: () => boolean;
  /**
   * Whether it opens this kind of file; default: its `accept`, read as the
   * browser's picker reads it. A surface that says what it cannot use (the
   * desk's ticket, the workspace's "couldn't be staged") takes everything.
   */
  readonly takes?: (file: FileKind) => boolean;
}

/** A box, as its latest render describes it — read at every question. */
export interface DropBox {
  /** What it takes, as an `accept` attribute says it. */
  readonly accept: string;
  /** Be the page's drop target (`./page-target`), or null. */
  readonly target: BoxTarget | null;
  /**
   * The box's one path in: a release on it, or files the page hands it.
   * Every file the page hands a target arrives here when it takes any of
   * them — the box keeps what it takes and says why it refused the rest.
   */
  readonly emit: (files: readonly File[], via: DropVia) => void;
  /** Its own picker, for "Open files"; without one the page's is used. */
  readonly pick?: () => void;
  /** A file is on its way: warm what is next. */
  readonly intent?: () => void;
}

/**
 * Count enters and leaves, so crossing from the box onto one of its own
 * children (a `dragleave` on the parent, a `dragenter` on the child) does
 * not read as the file leaving. Reset by a drop, a drag that ends, or the
 * window losing focus. The zones before the drop sheet cleared their state
 * on every `dragleave`, and flickered as a file moved over their text.
 */
export function createDragDepth(onChange: (inside: boolean) => void) {
  let depth = 0;
  return {
    enter() {
      depth += 1;
      if (depth === 1) onChange(true);
    },
    leave() {
      depth = Math.max(0, depth - 1);
      if (depth === 0) onChange(false);
    },
    reset() {
      if (depth === 0) return;
      depth = 0;
      onChange(false);
    },
    get depth() {
      return depth;
    },
  };
}

/**
 * Set on every box this engine is attached to, while it is: said on the
 * page, so a test (and anyone debugging) can tell a box takes its own
 * drops, as the layer marks `<html>` once it listens. Defined here alone —
 * `lazy-chunks.test.ts` reads it as this module's mark, and finds it in no
 * page's first load.
 */
export const DROP_ENGINE_MARK = "data-drop-engine";

/** Whether the page's drop layer is listening (it marks `<html>` once it is). */
const layerListening = () =>
  document.documentElement.hasAttribute("data-drop-layer");

/** The tool a tool page is about, as the page names it around its boxes. */
export function toolNameAt(box: Element | null): string | null {
  return (
    box?.closest("[data-tool-name]")?.getAttribute("data-tool-name") ?? null
  );
}

/** `accept` read once per distinct value, not once per question. */
const readAccept = new Map<string, (file: FileKind) => boolean>();
function byAccept(accept: string) {
  let takes = readAccept.get(accept);
  if (!takes) readAccept.set(accept, (takes = takesByAccept(accept)));
  return takes;
}

export interface DropEngine {
  /**
   * A release on the box, decided as its drop listener decides one: true
   * when the box took the files (they went through its `emit`, as a drop),
   * false when they are not its and the page routes them.
   */
  take(files: readonly File[]): boolean;
  detach(): void;
}

/**
 * Make `root` take what is dropped on it, and — while `latest` names a
 * target — be its page's target through `register` (the registry's
 * `registerLatest`). Returns the engine: `take`, the decision a release on
 * the box gets (for a release the drop layer caught before the engine was
 * here), and `detach` — listeners, registration and the states it drew,
 * all gone.
 *
 * WHAT IT TAKES, IT TAKES; WHAT IT DOES NOT, IT LEAVES TO THE PAGE. A drag
 * of files the box does not take (a JPG over Rotate PDF's PDF zone, a PDF
 * over Sign PDF's signature-image zone), or any file while its owner is at
 * work, neither lights the box nor is claimed by it on release: the drop
 * goes on — to the box around it, if there is one, and then to the page's
 * drop layer, which routes it as it routes a release anywhere else. The
 * answer for the drag and for the release is one predicate (`fits`), and
 * the page's route asks the target the same two questions (`routeFor`).
 * With no layer listening (a box rendered alone) the box keeps every drop,
 * as it must where nothing else would.
 */
export function attachDropBoxWith(
  root: HTMLElement,
  latest: { readonly current: DropBox },
  register: (target: { readonly current: PageTarget | null }) => () => void,
): DropEngine {
  const takes = () =>
    latest.current.target?.takes ?? byAccept(latest.current.accept);
  const fits = (kinds: readonly FileKind[]) =>
    (kinds.length === 0 || kinds.some(takes())) &&
    (latest.current.target?.canReceive?.() ?? true);

  // Over the box: null, or whether what is held fits it.
  let over: "fits" | "refuses" | null = null;
  let verdict: "fits" | "refuses" = "fits";
  // Armed by the page: a file is held anywhere, and this is where it lands.
  let armed = false;
  const paint = () => {
    root.toggleAttribute("data-over", over === "fits");
    root.toggleAttribute("data-armed", armed || over === "fits");
  };
  const depth = createDragDepth((inside) => {
    over = inside ? verdict : null;
    if (!inside) root.removeAttribute("data-drop-refuses");
    paint();
  });

  const onEnter = (e: DragEvent) => {
    if (!carriesFiles(e)) return;
    if (depth.depth === 0) {
      verdict = fits(describeDrag(e.dataTransfer)) ? "fits" : "refuses";
      // Said on the element now, for the drop layer's listener after this
      // one; cleared when the drag leaves the box or ends.
      root.toggleAttribute("data-drop-refuses", verdict === "refuses");
      if (verdict === "fits" && !armed) latest.current.intent?.();
    }
    depth.enter();
  };
  const onLeave = (e: DragEvent) => {
    if (carriesFiles(e)) depth.leave();
  };
  const onOver = (e: DragEvent) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const take = (files: readonly File[]) => {
    // Not this box's: left to the page, which routes it — when there is a
    // page listening.
    if (!fits(files) && layerListening()) return false;
    latest.current.emit(files, "drop");
    return true;
  };
  const onDrop = (e: DragEvent) => {
    depth.reset();
    // Not a file, or a box inside this one took it.
    if (!carriesFiles(e) || e.defaultPrevented) return;
    // Claimed here, so the page's drop layer knows a box took it.
    if (take(Array.from(e.dataTransfer?.files ?? []))) e.preventDefault();
  };

  const listeners = {
    dragenter: onEnter,
    dragleave: onLeave,
    dragover: onOver,
    drop: onDrop,
  } as Record<string, (e: DragEvent) => void>;
  for (const type in listeners)
    root.addEventListener(type, listeners[type] as EventListener);
  root.setAttribute(DROP_ENGINE_MARK, "");

  const off = latest.current.target
    ? register({
        // Built at each question from the box's latest render, so a new
        // name or busy state is what the page sees — registered ONCE, so a
        // re-render never moves it above a target that came after it.
        get current(): PageTarget | null {
          const box = latest.current;
          const target = box.target;
          if (!target) return null;
          return {
            name: target.name ?? toolNameAt(root) ?? "this tool",
            verb: target.verb,
            current: target.current,
            canReceive: () => target.canReceive?.() ?? true,
            takes: takes(),
            receive: (files, via) => box.emit(files, via),
            pick: box.pick,
            arm: (on) => {
              armed = on;
              paint();
              if (on) box.intent?.();
            },
            element: () => root,
          };
        },
      })
    : () => {};

  return {
    take,
    detach() {
      for (const type in listeners)
        root.removeEventListener(type, listeners[type] as EventListener);
      off();
      over = null;
      armed = false;
      paint();
      root.removeAttribute("data-drop-refuses");
      root.removeAttribute(DROP_ENGINE_MARK);
    },
  };
}
