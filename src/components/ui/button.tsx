import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

// `aria-disabled` is styled identically to `disabled` on purpose: a control that
// stays focusable while it is unavailable (see `RunButton`) must still LOOK
// unavailable, and the two must not drift apart.
const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary:
    "bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 text-white shadow-lg shadow-violet-500/25 hover:shadow-xl hover:shadow-violet-500/40 hover:brightness-110",
  secondary: "glass text-white hover:bg-white/10 hover:border-white/20",
  outline:
    "border border-white/15 bg-transparent text-slate-100 hover:bg-white/5 hover:border-white/25",
  ghost: "bg-transparent text-slate-200 hover:bg-white/5 hover:text-white",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-13 px-7 text-base",
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
