import { ChooseFilesLink } from "@/components/intent/choose-files-link";
import { UPLOAD_ANCHOR } from "./hero";

const steps = [
  {
    title: "Choose your files",
    body: "Pick them or drop them on this page. Most tools open them right in your browser.",
  },
  {
    title: "Pick a tool",
    body: "We suggest the tools that fit your files, or you can choose any tool from the list.",
  },
  {
    title: "Download the result",
    body: "Save your new file when it is ready. No sign-up needed.",
  },
];

/**
 * Three steps, in a visitor's words — what the desk and the tool pages
 * already do. WAS the workflow narrative (WP-13): a chain of five tool
 * stations with scroll-lit hooks under "One file, many tools, without
 * picking it again." Retired with the owner's brief of 2026-10-21; the
 * step that starts is a link to the desk that also opens its picker.
 *
 * A column, not a section: the page sets it beside "Why pdf.xyz" in one
 * band (`HowAndWhy`), so the two short answers share a screen.
 */
export function HowItWorks() {
  return (
    <div>
      <h2 className="font-display text-fg text-display-2 font-medium text-balance">
        How it works
      </h2>
      <ol className="mt-6 flex flex-col gap-5">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-4">
            <span
              aria-hidden
              className="bg-invert text-fg-invert rounded-tag grid size-8 shrink-0 place-items-center text-sm font-semibold"
            >
              {i + 1}
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="text-fg text-base font-medium">{step.title}</h3>
              <p className="text-muted text-sm leading-relaxed">{step.body}</p>
              {i === 0 && (
                <ChooseFilesLink
                  target={UPLOAD_ANCHOR}
                  className="text-accent mt-1 text-sm font-medium underline-offset-4 hover:underline"
                >
                  Choose files
                </ChooseFilesLink>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
