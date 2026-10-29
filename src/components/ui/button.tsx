import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";
type Weight = "medium" | "semibold";

// `aria-disabled` is styled identically to `disabled` on purpose: a control that
// stays focusable while it is unavailable (see `RunButton`) must still LOOK
// unavailable, and the two must not drift apart. 65, not 60: a dimmed
// primary's label is still read (every run's busy label, "Merging…"), and at
// 60 it fell to 4.46:1 on the white panel (`design-tokens.test.ts`).
const base =
  "inline-flex items-center justify-center gap-2 rounded-ctl whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-65 aria-disabled:cursor-not-allowed aria-disabled:opacity-65";

/**
 * Token-driven, theme-scoped. `primary` is the inverted ground of whatever
 * theme it sits in — ink-on-paper renders a near-black button, the legacy
 * dark routes render a light one — which is also what took the white-on-
 * gradient CTA from 3.9:1 to 16:1. No gradients, no glow, no pill.
 */
const variants: Record<Variant, string> = {
  primary: "bg-invert text-fg-invert hover:bg-invert/85",
  secondary: "border border-line-strong bg-transparent text-fg hover:bg-wash",
  outline: "border border-line-strong bg-transparent text-fg hover:bg-wash",
  ghost: "bg-transparent text-muted hover:bg-wash hover:text-fg",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

/**
 * An option rather than a `className` override: cn() joins and does not merge
 * (src/tests/class-conflicts.ts), so a caller's `font-semibold` beside the
 * base's `font-medium` would be decided by Tailwind's emit order.
 */
const weights: Record<Weight, string> = {
  medium: "font-medium",
  semibold: "font-semibold",
};

export function buttonVariants({
  variant = "primary",
  size = "md",
  weight = "medium",
  className,
}: {
  variant?: Variant;
  size?: Size;
  weight?: Weight;
  className?: string;
} = {}) {
  return cn(base, weights[weight], variants[variant], sizes[size], className);
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  weight?: Weight;
};

export function Button({
  variant,
  size,
  weight,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonVariants({ variant, size, weight, className })}
      {...props}
    />
  );
}
