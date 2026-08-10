import { Container } from "@/components/ui/container";

/**
 * Top-level loading UI shown while a route segment streams in. Kept lightweight
 * and accessible: an animated ring plus a polite status message so assistive
 * tech announces the wait without stealing focus.
 */
export default function Loading() {
  return (
    <div
      className="grid min-h-[60vh] place-items-center py-20"
      role="status"
      aria-live="polite"
    >
      <Container className="flex flex-col items-center gap-4">
        <span
          className="size-8 animate-spin rounded-full border-2 border-white/15 border-t-violet-400"
          aria-hidden
        />
        <span className="text-sm text-slate-400">Loading…</span>
      </Container>
    </div>
  );
}
