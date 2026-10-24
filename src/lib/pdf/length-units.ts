/**
 * Lengths a person types, in the unit they chose, against the points every
 * PDF box is measured in (1 pt = 1/72 in = 25.4/72 mm). Values are STORED in
 * points; a unit only changes how one is shown and read.
 */

export type LengthUnit = "pt" | "mm" | "in";

export const LENGTH_UNITS: readonly LengthUnit[] = ["pt", "mm", "in"];

/** Points in one of each unit. */
export const POINTS_PER: Record<LengthUnit, number> = {
  pt: 1,
  mm: 72 / 25.4,
  in: 72,
};

/** Decimal places shown: about a quarter-point of precision in each. */
export const UNIT_DECIMALS: Record<LengthUnit, number> = {
  pt: 1,
  mm: 1,
  in: 2,
};

/** A length in points, shown in `unit` and rounded for display. */
export function fromPoints(points: number, unit: LengthUnit): number {
  const value = points / POINTS_PER[unit];
  return Number(value.toFixed(UNIT_DECIMALS[unit]));
}

/** A length typed in `unit`, in points. Non-numbers read as 0. */
export function toPoints(value: number, unit: LengthUnit): number {
  return Number.isFinite(value) ? value * POINTS_PER[unit] : 0;
}

/** "24 pt", "8.5 mm", "0.33 in". */
export function formatLength(points: number, unit: LengthUnit): string {
  return `${fromPoints(points, unit)} ${unit}`;
}
