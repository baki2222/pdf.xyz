import { categories, toolCount } from "@/lib/tools";
import { processingSplit } from "@/lib/tools/processing-split";
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
  const neverUploads = processingSplit().neverUploads.length;

  const stats = [
    { value: String(toolCount), label: "PDF tools in one place" },
    { value: String(categories.length), label: "Focused categories" },
    { value: String(neverUploads), label: "Tools that never upload your file" },
    { value: "0", label: "Files stored after processing" },
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
