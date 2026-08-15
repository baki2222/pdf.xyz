import { categories, tools, toolCount } from "@/lib/tools";
import { Container } from "@/components/ui/container";

/**
 * A spec strip, not a stats band: the same four true numbers, set in mono
 * against hairlines like a data sheet. The gradient-filled 5xl numerals in
 * boxed cells were the funding-round version of this information.
 */
export function StatsBand() {
  const inBrowser = tools.filter(
    (t) => t.processing === "client" || t.processing === "hybrid",
  ).length;

  const stats = [
    { value: String(toolCount), label: "PDF tools in one place" },
    { value: String(categories.length), label: "Focused categories" },
    { value: String(inBrowser), label: "Tools that run in-browser" },
    { value: "0", label: "Files stored after processing" },
  ];

  return (
    <section className="border-line border-b">
      <Container>
        <dl className="grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className={
                "border-line flex flex-col gap-1 py-7 " +
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
