import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

// `aria-disabled` is styled identically to `disabled` on purpose: a control that
// stays focusable while it is unavailable (see `RunButton`) must still LOOK
// unavailable, and the two must not drift apart.
const base =
  "inline-flex items-center justify-center gap-2 rounded-[3px] font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

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

export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
} = {}) {
  return cn(base, variants[variant], sizes[size], className);
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return (
    <button
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}
