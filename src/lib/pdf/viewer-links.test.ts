import { describe, expect, it } from "vitest";
import {
  VIEWER_LINK_REL,
  VIEWER_LINK_SCHEMES,
  VIEWER_MAX_OUTLINE_TITLE,
  VIEWER_MAX_URL,
  safeExternalHref,
  walkOutline,
} from "./viewer-links";

describe("safeExternalHref: only web and e-mail addresses are followed", () => {
  it("keeps http, https and mailto", () => {
    expect(safeExternalHref("https://example.com/a?b=1")).toBe(
      "https://example.com/a?b=1",
    );
    expect(safeExternalHref("http://example.com")).toBe("http://example.com/");
    expect(safeExternalHref("mailto:a@example.com")).toBe(
      "mailto:a@example.com",
    );
    expect(VIEWER_LINK_SCHEMES).toEqual(["http:", "https:", "mailto:"]);
  });

  it("drops every other scheme, and disguised ones", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>1</script>",
      "file:///etc/passwd",
      "vbscript:x",
      "ftp://example.com/x",
      "tel:+15551234",
      "intent://x#Intent;end",
      "blob:https://example.com/x",
      "https://exa mple.com",
      "/relative/path",
      "example.com",
      "",
    ]) {
      expect(safeExternalHref(bad), bad).toBeNull();
    }
    for (const notString of [null, undefined, 42, { href: "https://x.y" }]) {
      expect(safeExternalHref(notString)).toBeNull();
    }
  });

  it("drops an address past the length limit (and keeps one at it)", () => {
    const base = "https://example.com/";
    const at = base + "a".repeat(VIEWER_MAX_URL - base.length);
    expect(safeExternalHref(at)).toBe(at);
    expect(safeExternalHref(at + "a")).toBeNull();
  });

  it("the rel every followed link carries names no opener, no referrer, no endorsement", () => {
    expect(VIEWER_LINK_REL.split(" ").sort()).toEqual([
      "nofollow",
      "noopener",
      "noreferrer",
    ]);
  });
});

describe("walkOutline: the bookmark tree, flat and bounded", () => {
  const node = (
    title: string,
    items: unknown[] = [],
    dest: unknown = title,
  ) => ({
    title,
    dest,
    url: null,
    items,
  });

  it("flattens in reading order with depths", () => {
    const tree = [
      node("1", [node("1.1"), node("1.2", [node("1.2.1")])]),
      node("2"),
    ];
    const { entries, truncated } = walkOutline(tree);
    expect(entries.map((e) => [e.title, e.depth])).toEqual([
      ["1", 0],
      ["1.1", 1],
      ["1.2", 1],
      ["1.2.1", 2],
      ["2", 0],
    ]);
    expect(truncated).toBe(false);
  });

  it("stops at the item cap and says so", () => {
    const wide = Array.from({ length: 50 }, (_, i) => node(String(i)));
    const r = walkOutline(wide, { items: 10, depth: 32 });
    expect(r.entries).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it("stops at the depth cap and says so, without recursing (a 100,000-deep chain)", () => {
    let deep: ReturnType<typeof node> = node("leaf");
    for (let i = 0; i < 100_000; i++) deep = node(`n${i}`, [deep]);
    const r = walkOutline([deep], { items: 2_000, depth: 32 });
    expect(r.entries).toHaveLength(32);
    expect(Math.max(...r.entries.map((e) => e.depth))).toBe(31);
    expect(r.truncated).toBe(true);
  });

  it("reads a node named twice once (a shared or cyclic tree)", () => {
    const shared = node("shared");
    const cyclic = node("cycle");
    cyclic.items.push(cyclic);
    const r = walkOutline([shared, shared, cyclic]);
    expect(r.entries.map((e) => e.title)).toEqual(["shared", "cycle"]);
  });

  it("filters a bookmark's address the way links are, and names an untitled one", () => {
    const r = walkOutline([
      { title: "", url: "javascript:alert(1)", items: [] },
      { title: "Web", url: "https://example.com", items: [] },
      { title: "x".repeat(VIEWER_MAX_OUTLINE_TITLE + 10) },
    ]);
    expect(r.entries[0]).toMatchObject({
      title: "Untitled bookmark",
      href: null,
    });
    expect(r.entries[1]!.href).toBe("https://example.com/");
    expect(r.entries[2]!.title).toHaveLength(VIEWER_MAX_OUTLINE_TITLE);
  });

  it("reads nothing from something that is not a list", () => {
    expect(walkOutline(null).entries).toEqual([]);
    expect(walkOutline({ items: [] }).entries).toEqual([]);
  });
});
