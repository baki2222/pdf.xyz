import { categories, toolCount } from "@/lib/tools";
import { processingSplit } from "@/lib/tools/processing-split";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { Container } from "@/components/ui/container";

/**
 * A spec strip set like a measured drawing: four true numbers on one rule,
 * each with a dimension end-cap at its origin. The counts are DERIVED from
 * the catalogue, so a figure that was measured also reads as measured. The
 * gradient-filled 5xl numerals in boxed cells were the funding-round
 * version of this information; the hairline-cell data sheet was the
 * broadsheet version. This is the drawing-office version.
 */
export function StatsBand() {
  /**
   * WAS `client + hybrid` counted here, labelled "Tools that run in-browser" —
   * 30, one more than the 29 `/privacy` and `/status` state, because the one
   * hybrid tool has a local path AND an upload path. Read in a strip whose
   * next cell is "0 files stored after processing", "run in-browser" is a
   * privacy claim, so it takes the privacy partition. The label now names the
   * property the number actually has rather than leaving the reader to guess
   * which of the two questions this cell answered.
   */
  /**
   * WAS `{ value: "0", label: "Files stored after processing" }` — the largest
   * privacy claim on the site, in the largest type, and untrue.
   *
   * `src/lib/faq.ts` had already walked this exact sentence back, and left the
   * reason in the file: the FAQ once said "permanently deleted within minutes
   * ... nothing is retained", which was "three separate untruths the privacy
   * page already corrects - the link dying and the bytes dying are different
   * events, and a job record (the file's name, never its contents) is kept for
   * about a day." Files ARE stored after processing. The output sits in
   * storage until the link expires, and the stored copy is erased by a daily
   * rule AFTER that.
   *
   * The correction never reached this strip because of HOW the claim was
   * written. The three cells beside it are derived (`toolCount`,
   * `categories.length`, `processingSplit()`), and the JSX comment below still
   * says "the counts are derived from the catalogue" - true of three of four.
   * A typed "0" has no constant to bind to, so no numbers census, no honesty
   * guard and no interpolation could ever see it: CLAUDE.md rule 3's last
   * bullet, a constant has no relationships to constrain.
   *
   * It now states the retention window itself, from the same
   * `DEFAULT_RETENTION` the FAQ and all eleven guides interpolate. Change the
   * policy and this cell moves with it; `stats-band.test.ts` fails if any cell
   * goes back to a literal.
   */
  const neverUploads = processingSplit().neverUploads.length;

  const stats = [
    { value: String(toolCount), label: "PDF tools in one place" },
    { value: String(categories.length), label: "Focused categories" },
    { value: String(neverUploads), label: "Tools that never upload your file" },
    {
      value: String(DEFAULT_RETENTION.outputTtlMinutes),
      label: "Minutes before a download link expires",
    },
  ];

  return (
    <section className="border-line bg-wash border-b">
      <Container>
        {/* Set like a measured drawing: each figure sits on the strip rule
            with a dimension end-cap at its origin, so a number that WAS
            measured (the counts are derived from the catalogue) also reads
            as measured. The cap is the mark cyan — decoration, never text. */}
        <dl className="border-line-strong/50 grid grid-cols-2 border-t lg:grid-cols-4">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className={
                "dim-cap flex flex-col gap-1 py-7 pl-4 " +
                (i > 0 ? "lg:pl-8 " : "") +
                (i % 2 === 1 ? "max-lg:pl-6" : "")
              }
            >
              <dd className="text-fg order-1 font-mono text-3xl font-medium tracking-tight tabular-nums sm:text-4xl">
                {stat.value}
              </dd>
              <dt className="text-muted order-2 text-[13px]">{stat.label}</dt>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}
