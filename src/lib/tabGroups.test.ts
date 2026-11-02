import { describe, expect, it } from "vitest";
import {
  contiguous,
  dropGroup,
  dropTab,
  groupUnits,
  isVisible,
  nextColor,
  normalizeGroups,
  stripItems,
} from "./tabGroups";
import type { TabGroup } from "./types";

function g(id: string, members: string[], collapsed = false): TabGroup {
  return { id, name: id, color: "blue", collapsed, members };
}

describe("normalizeGroups", () => {
  it("garde un dépôt dans le premier groupe qui le cite et écarte les groupes vides", () => {
    const got = normalizeGroups([
      g("pro", ["a", "b"]),
      g("perso", ["b"]),
      { ...g("x", ["c"]), color: "fuchsia", name: "  x  " },
    ]);
    expect(got.map((x) => x.id)).toEqual(["pro", "x"]);
    expect(got[1].color).toBe("blue");
    expect(got[1].name).toBe("x");
  });
});

describe("nextColor", () => {
  it("prend la première couleur libre, gris exclu", () => {
    expect(nextColor([])).toBe("blue");
    expect(nextColor([g("a", ["x"])])).toBe("red");
  });
});

describe("contiguous", () => {
  it("rassemble les membres à la place du premier", () => {
    expect(contiguous(["a", "x", "b", "y", "c"], [g("G", ["a", "b", "c"])])).toEqual([
      "a",
      "b",
      "c",
      "x",
      "y",
    ]);
  });
  it("un nouveau venu rejoint la queue de son groupe", () => {
    expect(contiguous(["a", "x", "b"], [g("G", ["a", "b"])])).toEqual(["a", "b", "x"]);
  });
});

describe("stripItems", () => {
  it("pose la pastille devant le premier membre", () => {
    const items = stripItems(["x", "a", "b"], [g("G", ["a", "b"])], "x");
    expect(items.map((i) => (i.kind === "group" ? `[${i.group.id}]` : i.id))).toEqual([
      "x",
      "[G]",
      "a",
      "b",
    ]);
  });
  it("un groupe replié ne garde que l'onglet affiché", () => {
    const groups = [g("G", ["a", "b", "c"], true)];
    const items = stripItems(["a", "b", "c", "x"], groups, "b");
    expect(items.map((i) => (i.kind === "group" ? `[${i.group.id}]` : i.id))).toEqual([
      "[G]",
      "b",
      "x",
    ]);
    expect(isVisible("a", groups, "b")).toBe(false);
    expect(isVisible("b", groups, "b")).toBe(true);
  });
});

describe("dropTab", () => {
  // Barre : x [G] a b y
  const groups = [g("G", ["a", "b"])];
  const ids = ["x", "a", "b", "y"];
  const items = stripItems(ids, groups, null);

  it("posé juste après la pastille, il entre en tête du groupe", () => {
    expect(dropTab(ids, groups, items, 2, "y", true)).toEqual({
      order: ["x", "y", "a", "b"],
      group: "G",
    });
  });
  it("entre deux membres, il entre dans le groupe", () => {
    expect(dropTab(ids, groups, items, 3, "x", true)).toEqual({
      order: ["a", "x", "b", "y"],
      group: "G",
    });
  });
  it("après le dernier membre, un étranger reste dehors", () => {
    expect(dropTab(ids, groups, items, 4, "x", true)).toEqual({
      order: ["a", "b", "x", "y"],
      group: null,
    });
  });
  it("après le dernier membre, un membre passe en queue", () => {
    expect(dropTab(ids, groups, items, 4, "a", true)).toEqual({
      order: ["x", "b", "a", "y"],
      group: "G",
    });
  });
  it("sorti à gauche de la pastille, il quitte le groupe", () => {
    expect(dropTab(ids, groups, items, 0, "b", true)).toEqual({
      order: ["b", "x", "a", "y"],
      group: null,
    });
  });
  it("un onglet non groupable lâché au milieu se pose après le groupe", () => {
    expect(dropTab(ids, groups, items, 3, "x", false)).toEqual({
      order: ["a", "b", "x", "y"],
      group: null,
    });
  });
  it("un groupe replié n'accueille personne et garde ses membres cachés ensemble", () => {
    const folded = [g("G", ["a", "b"], true)];
    const its = stripItems(ids, folded, "x");
    // Éléments : x [G] y — lâché juste après la pastille.
    expect(dropTab(ids, folded, its, 2, "x", true)).toEqual({
      order: ["a", "b", "x", "y"],
      group: null,
    });
  });
});

describe("dropGroup", () => {
  it("déplace le groupe entier, membres cachés compris", () => {
    const groups = [g("G", ["a", "b"], true)];
    const ids = ["x", "a", "b", "y"];
    const items = stripItems(ids, groups, "x");
    expect(groupUnits(items)).toHaveLength(3);
    // Unités : x [G] y — le groupe passe en fin.
    expect(dropGroup(ids, items, 3, "G")).toEqual(["x", "y", "a", "b"]);
    // Puis en tête.
    expect(dropGroup(ids, items, 0, "G")).toEqual(["a", "b", "x", "y"]);
  });
});
