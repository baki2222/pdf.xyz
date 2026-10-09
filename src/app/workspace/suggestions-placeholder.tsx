import { cn } from "@/lib/utils";

/** A word-shaped bar: real text, so it takes exactly a line of its size. */
const BAR = "bg-wash rounded-[2px] text-transparent select-none";

/**
 * The suggestions panel while the files are read: the SAME box as the list
 * that replaces it — heading row, three rows built from the row's own line
 * boxes (a name, a fact, where it runs), and the "More" footer — so the
 * panel keeps its height when the list arrives and nothing below it moves.
 *
 * WAS a heading and "Reading your files…": a ~90px box between a ~570px
 * panel and a ~400px list, so the aside and the batch queue jumped twice on
 * every staging (review, 2026-10-09: CLS 0.0937 at 1280, 0.546 at 390).
 * Shown while the staged files' facts are measured, so the list appears
 * once, in its measured order, and does not reorder under the reader. (Until
 * the suggestions themselves have loaded, the slot keeps the tools panel,
 * which is the same box.)
 */
export function SuggestionsPlaceholder({ className }: { className?: string }) {
  return (
    <section
      aria-busy="true"
      className={cn(
        "bg-panel border-line rounded-panel flex flex-col gap-4 border p-5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="kicker text-muted">Suggested for your files</p>
        {/* As short as "All tools" in the same place: a longer phrase
            wrapped the heading at 390 and made this box 16px taller. */}
        <span className="text-faint text-xs font-medium">Reading…</span>
      </div>
      <div className="flex flex-col gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          // A row's border, padding and three line boxes; its text starts
          // where a row's name does, past the 32px icon and its gap.
          <div
            key={i}
            className="flex flex-col gap-0.5 border border-transparent py-2.5 pr-3 pl-14"
          >
            <span className="text-sm font-medium">
              <span className={BAR}>Tool name</span>
            </span>
            <span className="text-xs leading-relaxed">
              <span className={BAR}>What the files hold</span>
            </span>
            <span className="text-[11px] leading-relaxed">
              <span className={BAR}>Where it runs</span>
            </span>
          </div>
        ))}
      </div>
      <p
        className="border-line text-faint border-t pt-3 text-xs font-medium"
        aria-hidden
      >
        More for these files
      </p>
    </section>
  );
}
