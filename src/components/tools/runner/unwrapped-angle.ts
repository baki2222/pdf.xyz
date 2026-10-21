import { useState } from "react";

/**
 * The angle to DRAW for a stored rotation, given the one drawn now: its
 * nearest equivalent, so a tile turns the short way (M25). A stored 0° after
 * 270° draws at 360°, and a CSS transition then turns a quarter forward
 * instead of three quarters back. A half turn has no short way and goes
 * clockwise.
 */
export function unwrapAngle(shown: number, stored: number): number {
  const delta = ((((stored - shown) % 360) + 540) % 360) - 180;
  return shown + (delta === -180 ? 180 : delta);
}

/** {@link unwrapAngle}, held across renders: the angle a tile draws. */
export function useUnwrappedAngle(stored: number): number {
  const [state, setState] = useState({ stored, shown: stored });
  if (state.stored !== stored) {
    const next = { stored, shown: unwrapAngle(state.shown, stored) };
    setState(next);
    return next.shown;
  }
  return state.shown;
}
