"use client";

import { useEffect, useRef, useState } from "react";
import type { EditorPdf } from "@/lib/pdf/editor/page-render";
import { cn } from "@/lib/utils";

const THUMB_WIDTH = 88;

function Thumb({
  doc,
  index,
  size,
  current,
  count,
  onJump,
}: {
  doc: EditorPdf | null;
  index: number;
  size: { width: number; height: number };
  current: boolean;
  count: number;
  onJump: (index: number) => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const scale = THUMB_WIDTH / size.width;

  useEffect(() => {
    const node = host.current;
    if (!node || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true);
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    const node = host.current;
    if (!seen || !doc || !node) return;
    const controller = new AbortController();
    void doc
      .render(index, scale, window.devicePixelRatio || 1, controller.signal)
      .then((canvas) => {
        if (!canvas || controller.signal.aborted) return;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        node.replaceChildren(canvas);
      });
    return () => controller.abort();
  }, [seen, doc, index, scale]);

  return (
    <li>
      <button
        type="button"
        onClick={() => onJump(index)}
        aria-label={`Go to page ${index + 1} of ${count}`}
        aria-current={current ? "page" : undefined}
        className={cn(
          "rounded-ctl flex w-full flex-col items-center gap-1 p-1.5 transition",
          current ? "bg-accent/10 ring-accent/40 ring-1" : "hover:bg-wash",
        )}
      >
        <span
          ref={host}
          className="block overflow-hidden bg-white shadow-sm ring-1 ring-black/10"
          style={{ width: THUMB_WIDTH, height: size.height * scale }}
        />
        <span className="text-muted text-[11px] tabular-nums">{index + 1}</span>
      </button>
    </li>
  );
}

export function ThumbnailRail({
  doc,
  sizes,
  current,
  onJump,
}: {
  doc: EditorPdf | null;
  sizes: readonly { width: number; height: number }[];
  current: number;
  onJump: (index: number) => void;
}) {
  return (
    <nav aria-label="Pages" className="h-full overflow-y-auto pr-1">
      <ol className="flex flex-col gap-1">
        {sizes.map((size, index) => (
          <Thumb
            key={index}
            doc={doc}
            index={index}
            size={size}
            current={current === index}
            count={sizes.length}
            onJump={onJump}
          />
        ))}
      </ol>
    </nav>
  );
}
