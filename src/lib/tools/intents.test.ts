// @vitest-environment node
/**
 * The intent data resolves against the catalogue, both ways where there are
 * two ways. Whether each synonym group EARNS its place is the corpus's job
 * (`tools.test.ts`); this file holds the data to the things it names.
 */
import { describe, expect, it } from "vitest";
import { UNSUPPORTED_FORMATS } from "@/lib/intent/formats";
import { wordsOf } from "@/lib/intent/search";
import { getToolBySlug, tools } from "./index";
import {
  HERO_TASKS,
  SYNONYM_GROUPS,
  TASKS,
  UNSUPPORTED_ANSWERS,
} from "./intents";

describe("tasks", () => {
  it("every task names a real tool (health: a list worth the name)", () => {
    expect(TASKS.length).toBeGreaterThanOrEqual(20);
    expect(TASKS.filter((task) => !getToolBySlug(task.slug))).toEqual([]);
  });

  it("no two tasks share a label", () => {
    const labels = TASKS.map((task) => task.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
  });

  // The glyph each hero task carried retired with the desk's task list
  // (2026-10-21); the six jobs stay first among the search's aliases.
  it("the six hero tasks are tasks, each with its own tool", () => {
    expect(HERO_TASKS).toHaveLength(6);
    expect(new Set(HERO_TASKS.map((t) => t.slug)).size).toBe(6);
    for (const hero of HERO_TASKS) {
      expect(TASKS).toContainEqual({ label: hero.label, slug: hero.slug });
    }
  });
});

describe("synonym groups", () => {
  const nameWords = new Set(tools.flatMap((tool) => wordsOf(tool.name)));

  it("every group's head is a word of some tool's name", () => {
    // A multi-word synonym collapses to the head, so a head no name holds
    // would turn "remove password" into a word that finds nothing.
    const orphans = SYNONYM_GROUPS.map((group) => group[0]!).filter(
      (head) => !wordsOf(head).every((word) => nameWords.has(word)),
    );
    expect(orphans).toEqual([]);
  });

  it("no word belongs to two groups — a word means one job", () => {
    const owner = new Map<string, string>();
    const twice: string[] = [];
    for (const group of SYNONYM_GROUPS) {
      for (const term of group) {
        const key = wordsOf(term).join(" ");
        const head = group[0]!;
        if (owner.has(key) && owner.get(key) !== head) {
          twice.push(`${term}: ${owner.get(key)} and ${head}`);
        }
        owner.set(key, head);
      }
    }
    expect(twice).toEqual([]);
  });
});

describe("unsupported answers", () => {
  it("answers exactly the unsupported formats", () => {
    expect(Object.keys(UNSUPPORTED_ANSWERS).sort()).toEqual(
      [...UNSUPPORTED_FORMATS].sort(),
    );
  });

  it("no answer suggests saving as a format that is itself unsupported", () => {
    const bad = Object.entries(UNSUPPORTED_ANSWERS).filter(
      ([, answer]) =>
        answer.becomes !== null &&
        (UNSUPPORTED_FORMATS as readonly string[]).includes(answer.becomes),
    );
    expect(bad).toEqual([]);
  });

  it("an answer with nowhere to go gives no instruction", () => {
    for (const [format, answer] of Object.entries(UNSUPPORTED_ANSWERS)) {
      expect(answer.becomes === null, format).toBe(answer.how === null);
    }
  });
});
