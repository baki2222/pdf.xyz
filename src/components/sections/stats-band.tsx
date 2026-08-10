import { categories, tools, toolCount } from "@/lib/tools";
import { Container } from "@/components/ui/container";

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
    <section className="py-14">
      <Container>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/5 lg:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-ink flex flex-col items-center gap-1 px-6 py-8 text-center"
            >
              <dt className="order-2 text-sm text-slate-400">{stat.label}</dt>
              <dd className="order-1 bg-gradient-to-br from-white to-slate-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}
