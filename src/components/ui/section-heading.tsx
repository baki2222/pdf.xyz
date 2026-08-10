import { cn } from "@/lib/utils";

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  as: Heading = "h2",
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "left";
  /** Heading level. Defaults to h2; use h1 when this is the page's main title. */
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        align === "center" ? "items-center text-center" : "items-start",
        className,
      )}
    >
      {eyebrow && (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold tracking-widest text-violet-200 uppercase">
          {eyebrow}
        </span>
      )}
      <Heading className="max-w-3xl text-3xl font-bold tracking-tight text-balance text-white sm:text-4xl md:text-[2.75rem] md:leading-[1.1]">
        {title}
      </Heading>
      {description && (
        <p
          className={cn(
            "max-w-2xl text-base leading-relaxed text-pretty text-slate-400 sm:text-lg",
            align === "center" && "mx-auto",
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}
