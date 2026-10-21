import * as React from "react";
import type { FC, ReactNode } from "react";
import { VIEW_TRANSITIONS } from "@/lib/motion/view-transitions";

type ViewTransitionProps = { name?: string; children?: ReactNode };

const PassThrough: FC<ViewTransitionProps> = ({ children }) => <>{children}</>;

/**
 * The sheet that travels between the home desk, a tool's runner and the
 * workspace (M26). Built in only with `PDFXYZ_VIEW_TRANSITIONS=1`, which
 * ships OFF until the view-transition gate in `e2e/motion.spec.ts` is green
 * in CI against a build made with the flag on.
 *
 * React's `<ViewTransition>` when the layer is built in, and a pass-through
 * otherwise — or wherever React has none (vitest). The flag decides as well
 * as the export: Next 16's bundled React canary HAS the component, and every
 * App Router navigation runs in a transition, so an unflagged import would
 * animate every route change. Nothing imports React's canary export but this.
 */
export const ViewTransition: FC<ViewTransitionProps> = VIEW_TRANSITIONS
  ? ((React as unknown as { ViewTransition?: FC<ViewTransitionProps> })
      .ViewTransition ?? PassThrough)
  : PassThrough;
