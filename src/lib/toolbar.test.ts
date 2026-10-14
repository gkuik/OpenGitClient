import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOOLBAR,
  insertItem,
  insertionIndex,
  moveItem,
  normalizeToolbar,
  removeAt,
  visibleToolbar,
  type ToolbarItem,
} from "./toolbar";

describe("normalizeToolbar", () => {
  it("donne la barre par défaut tant qu'elle n'a jamais été personnalisée", () => {
    expect(normalizeToolbar(null)).toEqual(DEFAULT_TOOLBAR);
  });

  it("garde une barre vide : c'est un choix, pas une erreur", () => {
    expect(normalizeToolbar([])).toEqual([]);
  });

  it("écarte l'inconnu et les actions en double, garde les séparateurs répétés", () => {
    expect(
      normalizeToolbar(["push", "rebase", "separator", "push", 4, "separator", "space"]),
    ).toEqual(["push", "separator", "separator", "space"]);
  });
});

describe("visibleToolbar", () => {
  it("rend la barre par défaut telle qu'avant quand Git Flow est actif", () => {
    expect(visibleToolbar(DEFAULT_TOOLBAR, true)).toEqual(DEFAULT_TOOLBAR);
  });

  it("ne laisse pas pendre le séparateur de Git Flow quand il est désactivé", () => {
    expect(visibleToolbar(DEFAULT_TOOLBAR, false)).toEqual([
      "pull",
      "push",
      "fetch",
      "separator",
      "branch",
      "stash",
    ]);
  });

  it("ne garde un séparateur qu'entre deux actions, et un seul", () => {
    const items: ToolbarItem[] = [
      "separator",
      "pull",
      "separator",
      "space",
      "separator",
      "push",
      "separator",
      "space",
    ];
    expect(visibleToolbar(items, true)).toEqual(["pull", "separator", "space", "push", "space"]);
  });
});

describe("insertItem", () => {
  it("insère un élément de mise en page sans toucher au reste", () => {
    expect(insertItem(["pull", "push"], "separator", 1)).toEqual(["pull", "separator", "push"]);
  });

  it("déplace une action déjà présente au lieu de la dupliquer", () => {
    expect(insertItem(["pull", "push", "fetch"], "pull", 3)).toEqual(["push", "fetch", "pull"]);
  });

  it("remplit une barre vide", () => {
    expect(insertItem([], "stash", 0)).toEqual(["stash"]);
  });
});

describe("moveItem", () => {
  const items: ToolbarItem[] = ["pull", "push", "fetch"];

  it("compte l'index d'insertion avec l'élément encore en place", () => {
    expect(moveItem(items, 0, 2)).toEqual(["push", "pull", "fetch"]);
    expect(moveItem(items, 2, 0)).toEqual(["fetch", "pull", "push"]);
  });

  it("ne bouge rien quand l'élément retombe à sa place", () => {
    expect(moveItem(items, 1, 1)).toEqual(items);
    expect(moveItem(items, 1, 2)).toEqual(items);
  });
});

describe("removeAt", () => {
  it("retire un seul des séparateurs identiques", () => {
    expect(removeAt(["separator", "pull", "separator"], 2)).toEqual(["separator", "pull"]);
  });
});

describe("insertionIndex", () => {
  it("compte les milieux à gauche du curseur", () => {
    const mids = [10, 50, 90];
    expect(insertionIndex(mids, 0)).toBe(0);
    expect(insertionIndex(mids, 49)).toBe(1);
    expect(insertionIndex(mids, 200)).toBe(3);
    expect(insertionIndex([], 42)).toBe(0);
  });
});
