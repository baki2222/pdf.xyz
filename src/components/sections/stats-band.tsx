import { categories, toolCount } from "@/lib/tools";
import { processingSplit } from "@/lib/tools/processing-split";
import { Container } from "@/components/ui/container";

/**
 * A spec strip, not a stats band: the same four true numbers, set in mono
 * against hairlines like a data sheet. The gradient-filled 5xl numerals in
 * boxed cells were the funding-round version of this information.
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
        <dl className="grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className={
                "border-line-strong/50 flex flex-col gap-1 py-7 " +
                (i > 0 ? "lg:border-l lg:pl-8 " : "") +
                (i % 2 === 1 ? "max-lg:border-l max-lg:pl-6" : "")
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
